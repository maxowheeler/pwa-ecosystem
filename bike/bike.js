// bike.js — Bike Log app logic
// Tracks commute rides, clothing, savings vs driving.
// Data: localStorage via storage.js, synced to Pi via sync.js.

import Storage  from '../shared/storage.js';
import Sync     from '../shared/sync.js';
import UI       from '../shared/ui.js';
import VERSIONS from '../shared/versions.js';

const APP = 'bike';
const KEY = 'rides';

// ── App Version History ───────────────────────────────────────────
const APP_HISTORY = [
  {
    number: 'v1.4',
    date:   '2026-05-20',
    notes:  [
      'Renamed CommuteLog → Bike Log',
      'Backpack toggle added (autofills from last matching leg)',
      'Battery % consumed field added to E-Bike section',
      'Savings sparkline with foam animation and break-even goal line',
      'Edit logged rides — opens pre-populated ride modal',
      'Delete moved into edit modal',
    ],
  },
  {
    number: 'v1.3',
    date:   '2026-05-18',
    notes:  [
      'Hotfix to deploy new sync pill modal',
    ],
  },
  {
    number: 'v1.2',
    date:   '2026-05-17',
    notes:  [
      'Two-row sticky header — app name, date, gear, sync pill',
      'Route field added to ride log',
      'E-Bike Class, Mode, Loading autofill from last matching leg',
      'Exertion changed to circle emojis 🟢🟡🔴',
      'Exertion shown in ride history summary line',
      'Ride history Class label fixed',
    ],
  },
  {
    number: 'v1.1',
    date:   '2026-05-16',
    notes:  [
      'E-Bike Class, Mode, Loading, and Exertion fields added',
      'Duration wheel changed to 1-minute intervals',
      'Action bar buttons taller and flush to bottom',
      'Sync pill moved to shared ui.js',
      'Devlog now shows app version history',
    ],
  },
  {
    number: 'v1.0',
    date:   '2026-03-06',
    notes:  [
      'Rebuilt on shared PWA infrastructure',
      'Commute and other ride logging',
      'Weather fetch via OpenWeatherMap',
      'Clothing autocomplete from wardrobe history',
      'Break-even progress bar',
      'Duration scroll wheel',
      'Comfort scale',
      'Gas savings calculation',
    ],
  },
];

// ── Default Settings ──────────────────────────────────────────────
const SETTINGS_DEFAULTS = {
  bikeCost:    1200,
  parkingMo:   50,
  miles:       7.5,
  mpg:         30,
  gasDefault:  3.459,
  zip:         '',
  owmKey:      '',
  piIp:        '192.168.1.216',
};

// ── State ─────────────────────────────────────────────────────────
let _rides            = [];
let _settings         = { ...SETTINGS_DEFAULTS };
let _wardrobe         = { helmet:[], coat:[], shirt:[], pants:[], shoes:[], gloves:[] };
let _selectedComfort  = '';
let _selectedExertion = '';
let _selectedDuration = 30;
let _cachedWeather    = null;
let _isCommute        = true;
let _editingRideId    = null;   // null = new ride, number = editing existing
let _updateSyncPill;

// ── Init ──────────────────────────────────────────────────────────
async function init() {
  loadSettings();
  loadWardrobe();

  UI.setHeaderDate(document.getElementById('header-date'));
  _updateSyncPill = UI.syncPill(document.getElementById('sync-row'), 'bike', 'rides', Sync);

  const pulled = await Sync.pull(APP, KEY);
  _updateSyncPill(pulled ? 'ok' : 'never');
  _rides = Storage.load(APP, KEY);

  updateHomeStats();
  buildDurWheel();
  wireEvents();

  fetchWeather(false);
}

// ── Settings ──────────────────────────────────────────────────────
function loadSettings() {
  const saved = Storage.load('bike', 'settings');
  if (saved && saved.length > 0 && typeof saved[0] === 'object') {
    _settings = { ...SETTINGS_DEFAULTS, ...saved[0] };
  }
}

function saveSettings() {
  _settings.bikeCost   = parseFloat(document.getElementById('s-cost').value)    || SETTINGS_DEFAULTS.bikeCost;
  _settings.parkingMo  = parseFloat(document.getElementById('s-parking').value) || 0;
  _settings.miles      = parseFloat(document.getElementById('s-miles').value)   || SETTINGS_DEFAULTS.miles;
  _settings.mpg        = parseFloat(document.getElementById('s-mpg').value)     || SETTINGS_DEFAULTS.mpg;
  _settings.gasDefault = parseFloat(document.getElementById('s-gas').value)     || SETTINGS_DEFAULTS.gasDefault;
  _settings.zip        = document.getElementById('s-zip').value.trim();
  _settings.owmKey     = document.getElementById('s-owm').value.trim();
  _settings.piIp       = document.getElementById('s-pi').value.trim();

  Storage.save('bike', 'settings', [_settings]);
  closeModal('modal-settings');
  updateHomeStats();
  UI.toast('Settings saved');
}

function populateSettingsForm() {
  document.getElementById('s-cost').value    = _settings.bikeCost;
  document.getElementById('s-parking').value = _settings.parkingMo;
  document.getElementById('s-miles').value   = _settings.miles;
  document.getElementById('s-mpg').value     = _settings.mpg;
  document.getElementById('s-gas').value     = _settings.gasDefault;
  document.getElementById('s-zip').value     = _settings.zip;
  document.getElementById('s-owm').value     = _settings.owmKey;
  document.getElementById('s-pi').value      = _settings.piIp;
}

// ── Wardrobe ──────────────────────────────────────────────────────
function loadWardrobe() {
  const saved = Storage.load('bike', 'wardrobe');
  if (saved && saved.length > 0 && typeof saved[0] === 'object') {
    _wardrobe = { ..._wardrobe, ...saved[0] };
  }
}

function saveWardrobe() {
  Storage.save('bike', 'wardrobe', [_wardrobe]);
}

function addToWardrobe(slot, val) {
  if (!val || !_wardrobe[slot]) return;
  if (!_wardrobe[slot].includes(val)) {
    _wardrobe[slot].push(val);
    saveWardrobe();
  }
}

// ── Screens ───────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  const footer = document.getElementById('app-footer');
  if (id === 'screen-history') {
    footer.classList.add('hidden');
    renderHistory();
  } else {
    footer.classList.remove('hidden');
  }
}

// ── Modals ────────────────────────────────────────────────────────
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ── Log Ride (new) ────────────────────────────────────────────────
function openLogRide(isCommute) {
  _isCommute    = isCommute;
  _editingRideId = null;

  const header = document.getElementById('modal-ride-header');
  const title  = document.getElementById('modal-ride-title');
  header.className  = isCommute ? 'modal-header rainbow' : 'modal-header plain';
  title.textContent = isCommute ? '🚲 Log Commute' : 'Log Other Ride';

  document.getElementById('btn-save-ride').textContent   = 'Save Entry';
  document.getElementById('btn-delete-ride').style.display = 'none';

  resetRideForm();
  if (isCommute) autoFillCommute();

  openModal('modal-ride');
}

// ── Edit Ride (existing) ──────────────────────────────────────────
function openEditRide(ride) {
  _editingRideId = ride.id;
  _isCommute     = ride.type === 'Commute';

  const header = document.getElementById('modal-ride-header');
  const title  = document.getElementById('modal-ride-title');
  // Use rainbow for commutes, plain for others — same as log ride
  header.className  = _isCommute ? 'modal-header rainbow' : 'modal-header plain';
  title.textContent = _isCommute ? '✏️ Edit Commute' : '✏️ Edit Ride';

  document.getElementById('btn-save-ride').textContent     = 'Save Changes';
  document.getElementById('btn-delete-ride').style.display = '';

  resetRideForm();
  populateRideForm(ride);

  openModal('modal-ride');
}

function populateRideForm(ride) {
  document.getElementById('r-date').value    = ride.date    || '';
  document.getElementById('r-endtime').value = ride.endTime || '';
  document.getElementById('r-leg').value     = ride.leg     || 'Morning';
  document.getElementById('r-miles').value   = ride.miles   || _settings.miles;
  document.getElementById('r-gas').value     = ride.gasPrice || _settings.gasDefault;
  document.getElementById('r-route').value   = ride.route   || '';
  document.getElementById('r-temp').value       = ride.temp       || '';
  document.getElementById('r-conditions').value = ride.conditions || '';
  document.getElementById('r-wind').value        = ride.wind      || '';
  if (ride.wind) updateWindArrow(ride.wind);

  ['helmet','coat','shirt','pants','shoes','gloves'].forEach(slot => {
    document.getElementById('c-' + slot).value = ride[slot] || '';
  });

  if (ride.rain)     document.getElementById('rain-toggle').classList.add('on');
  if (ride.backpack) document.getElementById('backpack-toggle').classList.add('on');

  if (ride.ebikeClass) document.getElementById('r-ebike-class').value = ride.ebikeClass;
  if (ride.mode)       document.getElementById('r-mode').value        = ride.mode;
  if (ride.loading)    document.getElementById('r-loading').value     = ride.loading;
  if (ride.battery != null) document.getElementById('r-battery').value = ride.battery;

  if (ride.duration) setDuration(parseInt(ride.duration));

  // Restore comfort selection
  if (ride.comfort) {
    document.querySelectorAll('.comfort-opt').forEach(o => {
      o.classList.toggle('selected', o.dataset.val === ride.comfort);
    });
    _selectedComfort = ride.comfort;
  }

  // Restore exertion selection
  if (ride.exertion) {
    document.querySelectorAll('.exertion-opt').forEach(o => {
      o.classList.toggle('selected', o.dataset.val === ride.exertion);
    });
    _selectedExertion = ride.exertion;
  }

  document.getElementById('r-notes').value = ride.notes || '';
}

function autoFillCommute() {
  const now  = new Date();
  const hour = now.getHours();
  const leg  = hour < 12 ? 'Morning' : 'Evening';

  document.getElementById('r-date').value    = toDateVal(now);
  document.getElementById('r-endtime').value = toTimeVal(now);
  document.getElementById('r-leg').value     = leg;
  document.getElementById('r-miles').value   = _settings.miles;
  document.getElementById('r-gas').value     = _settings.gasDefault;

  if (_cachedWeather) applyWeatherToForm(_cachedWeather);

  const match = getMostRecentRideForLeg(leg);
  if (match) {
    ['helmet','coat','shirt','pants','shoes','gloves'].forEach(slot => {
      if (match[slot]) document.getElementById('c-' + slot).value = match[slot];
    });
    if (match.duration)   setDuration(parseInt(match.duration));
    if (match.ebikeClass) document.getElementById('r-ebike-class').value = match.ebikeClass;
    if (match.mode)       document.getElementById('r-mode').value        = match.mode;
    if (match.loading)    document.getElementById('r-loading').value     = match.loading;
    if (match.route)      document.getElementById('r-route').value       = match.route;
    if (match.backpack)   document.getElementById('backpack-toggle').classList.add('on');
  }
}

function getMostRecentRideForLeg(leg) {
  const commutes = [..._rides].reverse().filter(r => r.type === 'Commute' && r.leg === leg);
  return commutes.length > 0 ? commutes[0] : null;
}

function resetRideForm() {
  ['r-date','r-endtime','r-temp','r-conditions','r-wind','r-notes','r-route'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('r-miles').value       = _settings.miles;
  document.getElementById('r-gas').value         = _settings.gasDefault;
  document.getElementById('r-leg').value         = 'Morning';
  document.getElementById('r-ebike-class').value = '';
  document.getElementById('r-mode').value        = '';
  document.getElementById('r-loading').value     = '';
  document.getElementById('r-battery').value     = '';
  ['helmet','coat','shirt','pants','shoes','gloves'].forEach(slot => {
    document.getElementById('c-' + slot).value = '';
  });
  document.getElementById('rain-toggle').classList.remove('on');
  document.getElementById('backpack-toggle').classList.remove('on');
  document.querySelectorAll('.comfort-opt').forEach(o => o.classList.remove('selected'));
  document.querySelectorAll('.exertion-opt').forEach(o => o.classList.remove('selected'));
  document.getElementById('wind-arrow').style.transform = 'rotate(0deg)';
  document.getElementById('weather-status').textContent = '';
  document.getElementById('weather-status').className   = 'weather-status';
  _selectedComfort  = '';
  _selectedExertion = '';
  setDuration(30);
}

// ── Save Ride ─────────────────────────────────────────────────────
function saveRide() {
  const miles    = parseFloat(document.getElementById('r-miles').value) || _settings.miles;
  const gasPrice = parseFloat(document.getElementById('r-gas').value)   || _settings.gasDefault;
  const gasSaved = (miles / _settings.mpg) * gasPrice;

  ['helmet','coat','shirt','pants','shoes','gloves'].forEach(slot => {
    addToWardrobe(slot, document.getElementById('c-' + slot).value.trim());
  });

  const batteryVal = document.getElementById('r-battery').value;

  const rideData = {
    type:       _isCommute ? 'Commute' : 'Other',
    leg:        document.getElementById('r-leg').value,
    date:       document.getElementById('r-date').value || toDateVal(new Date()),
    endTime:    document.getElementById('r-endtime').value,
    duration:   _selectedDuration,
    miles:      miles,
    route:      document.getElementById('r-route').value.trim(),
    temp:       document.getElementById('r-temp').value.trim(),
    conditions: document.getElementById('r-conditions').value.trim(),
    wind:       document.getElementById('r-wind').value.trim(),
    gasPrice:   gasPrice,
    gasSaved:   parseFloat(gasSaved.toFixed(3)),
    helmet:     document.getElementById('c-helmet').value.trim(),
    coat:       document.getElementById('c-coat').value.trim(),
    shirt:      document.getElementById('c-shirt').value.trim(),
    pants:      document.getElementById('c-pants').value.trim(),
    shoes:      document.getElementById('c-shoes').value.trim(),
    gloves:     document.getElementById('c-gloves').value.trim(),
    rain:       document.getElementById('rain-toggle').classList.contains('on'),
    backpack:   document.getElementById('backpack-toggle').classList.contains('on'),
    comfort:    _selectedComfort,
    exertion:   _selectedExertion,
    ebikeClass: document.getElementById('r-ebike-class').value,
    mode:       document.getElementById('r-mode').value,
    loading:    document.getElementById('r-loading').value,
    battery:    batteryVal !== '' ? parseFloat(batteryVal) : null,
    notes:      document.getElementById('r-notes').value.trim(),
  };

  if (_editingRideId !== null) {
    // Edit existing ride — preserve id and createdAt
    Storage.update(APP, KEY, { id: _editingRideId, ...rideData });
    _rides = Storage.load(APP, KEY);
    closeModal('modal-ride');
    updateHomeStats();
    renderHistory();
    UI.toast(`Updated — $${gasSaved.toFixed(2)} gas saved 🚲`);
  } else {
    // New ride
    Storage.append(APP, KEY, rideData);
    _rides = Storage.load(APP, KEY);
    closeModal('modal-ride');
    updateHomeStats();
    UI.toast(`Saved — $${gasSaved.toFixed(2)} gas saved 🚲`);
  }

  Sync.push(APP, KEY).then(ok => _updateSyncPill(ok ? 'ok' : 'fail'));
}

// ── Delete Ride (from edit modal) ─────────────────────────────────
async function deleteRide() {
  const ok = await UI.confirm('Delete this ride? This cannot be undone.');
  if (!ok) return;
  Storage.remove(APP, KEY, _editingRideId);
  _rides = Storage.load(APP, KEY);
  closeModal('modal-ride');
  updateHomeStats();
  renderHistory();
  Sync.push(APP, KEY).then(ok => _updateSyncPill(ok ? 'ok' : 'fail'));
  UI.toast('Ride deleted');
}

// ── Stats + Sparkline ─────────────────────────────────────────────
function updateHomeStats() {
  let totalGas   = 0;
  let totalMiles = 0;
  const months   = new Set();

  _rides.forEach(r => {
    totalGas   += r.gasSaved  || 0;
    totalMiles += r.miles     || 0;
    if (r.date) months.add(r.date.substring(0, 7));
  });

  const parkingSaved = months.size * _settings.parkingMo;
  const totalSaved   = totalGas + parkingSaved;
  const pct          = Math.min(100, (totalSaved / Math.max(1, _settings.bikeCost)) * 100);
  const remaining    = Math.max(0, _settings.bikeCost - totalSaved);

  document.getElementById('stat-rides').textContent = _rides.length;
  document.getElementById('stat-miles').textContent = Math.round(totalMiles);
  document.getElementById('stat-gas').textContent   = '$' + totalGas.toFixed(2);
  document.getElementById('stat-total').textContent = '$' + totalSaved.toFixed(2);
  document.getElementById('be-pct').textContent     = pct.toFixed(1) + '%';
  document.getElementById('be-bar').style.width     = pct + '%';
  document.getElementById('hist-sub').textContent   = _rides.length + (_rides.length === 1 ? ' ride' : ' rides') + ' logged';

  document.getElementById('be-sub').innerHTML =
    `<span>$${totalSaved.toFixed(2)}</span> saved of <span>$${_settings.bikeCost.toFixed(2)}</span> &nbsp;·&nbsp; ` +
    `<span>$${remaining.toFixed(2)}</span> to go &nbsp;·&nbsp; ` +
    `parking <span>$${parkingSaved.toFixed(2)}</span> (${months.size} mo)`;

  renderSparkline(totalSaved);
}

// ── Sparkline ─────────────────────────────────────────────────────
function renderSparkline(currentTotalSaved) {
  const svg = document.getElementById('spark-svg');
  if (!svg) return;

  const sorted = [..._rides]
    .filter(r => r.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (sorted.length === 0) {
    svg.innerHTML = '';
    return;
  }

  // Accumulate cumulative savings, adding parking when a new month appears
  const seenMonths = new Set();
  let cumulative   = 0;
  const points     = [];

  sorted.forEach(r => {
    const month = r.date.substring(0, 7);
    if (!seenMonths.has(month)) {
      seenMonths.add(month);
      cumulative += _settings.parkingMo;
    }
    cumulative += (r.gasSaved || 0);
    points.push({ date: r.date, value: cumulative });
  });

  const bikeCost  = Math.max(1, _settings.bikeCost);

  // X axis: first ride date → first ride date + 24 months
  const firstDate = new Date(points[0].date + 'T00:00:00');
  const xMinMs    = firstDate.getTime();
  const xMaxDate  = new Date(firstDate);
  xMaxDate.setMonth(xMaxDate.getMonth() + 24);
  const xMaxMs    = xMaxDate.getTime();
  const xRangeMs  = xMaxMs - xMinMs;

  // Y axis: 0–105%
  const yMax = 105;

  const W     = 500;
  const H     = 100;
  const PAD_L = 36;  // room for y-axis labels
  const PAD_R = 10;
  const PAD_T = 10;
  const PAD_B = 20;  // room for x-axis labels

  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  function xPos(dateStr) {
    const ms = new Date(dateStr + 'T00:00:00').getTime();
    return PAD_L + ((ms - xMinMs) / xRangeMs) * plotW;
  }

  function yPos(val) {
    const pct = (val / bikeCost) * 100;
    return PAD_T + plotH - (Math.min(pct, yMax) / yMax) * plotH;
  }

  function yPosFromPct(pct) {
    return PAD_T + plotH - (pct / yMax) * plotH;
  }

  // Line + area paths
  const linePoints = points.map(p => `${xPos(p.date).toFixed(1)},${yPos(p.value).toFixed(1)}`);
  const linePath   = 'M' + linePoints.join(' L');
  const baseY      = (PAD_T + plotH).toFixed(1);
  const areaPath   = linePath +
    ` L${xPos(points[points.length-1].date).toFixed(1)},${baseY}` +
    ` L${xPos(points[0].date).toFixed(1)},${baseY} Z`;

  // Y gridlines at 0, 25, 50, 75, 100%
  const yGridLines = [0, 25, 50, 75, 100].map(pct => {
    const y = yPosFromPct(pct).toFixed(1);
    return `
      <line x1="${PAD_L}" y1="${y}" x2="${W - PAD_R}" y2="${y}"
            stroke="var(--border)" stroke-width="1" opacity="${pct === 100 ? 0 : 0.6}"/>
      <text x="${PAD_L - 4}" y="${y}" text-anchor="end" dominant-baseline="middle"
            class="spark-tick">${pct}%</text>
    `;
  }).join('');

  // X gridlines — one per month over 24 months
  const xGridLines = [];
  const xTicks     = [];
  const cur = new Date(firstDate);
  for (let i = 0; i <= 24; i++) {
    const dateStr = cur.toISOString().substring(0, 10);
    const x       = xPos(dateStr).toFixed(1);
    const isFirst = i === 0;
    xGridLines.push(
      `<line x1="${x}" y1="${PAD_T}" x2="${x}" y2="${PAD_T + plotH}"
             stroke="var(--border)" stroke-width="1" opacity="0.6"/>`
    );
    // Label every 3 months (quarterly) to avoid crowding
    if (i % 3 === 0) {
      const label = cur.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      xTicks.push(`<text class="spark-tick" x="${x}" y="${H - 4}" text-anchor="${isFirst ? 'start' : 'middle'}">${label}</text>`);
    }
    cur.setMonth(cur.getMonth() + 1);
  }

  // Goal line at 100%
  const goalY = yPosFromPct(100).toFixed(1);

  // Current % label
  const currentPct = Math.min(((currentTotalSaved / bikeCost) * 100), 105).toFixed(1);

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = `
    <defs>
      <linearGradient id="sparkFoamGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%"   stop-color="#ff6b6b"/>
        <stop offset="20%"  stop-color="#ffd93d"/>
        <stop offset="40%"  stop-color="#6bff8e"/>
        <stop offset="60%"  stop-color="#48dbfb"/>
        <stop offset="80%"  stop-color="#a29bfe"/>
        <stop offset="100%" stop-color="#ff6b9d"/>
      </linearGradient>
      <linearGradient id="sparkAreaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%"   stop-color="#48dbfb" stop-opacity="0.18"/>
        <stop offset="100%" stop-color="#48dbfb" stop-opacity="0"/>
      </linearGradient>
    </defs>

    ${xGridLines.join('')}
    ${yGridLines}

    <path class="spark-area" d="${areaPath}"/>

    <line class="spark-goal" x1="${PAD_L}" y1="${goalY}" x2="${W - PAD_R}" y2="${goalY}"/>
    <text class="spark-goal-label" x="${W - PAD_R - 2}" y="${parseFloat(goalY) - 3}"
          text-anchor="end">${currentPct}%</text>

    <path class="spark-line" d="${linePath}"/>

    ${xTicks.join('')}
  `;
}

// ── Weather ───────────────────────────────────────────────────────
async function fetchWeather(showFeedback = true) {
  if (!_settings.owmKey || !_settings.zip) {
    if (showFeedback) UI.toast('Add ZIP and OWM API key in Settings', 'error');
    return;
  }

  const url = `https://api.openweathermap.org/data/2.5/weather?zip=${_settings.zip},US&appid=${_settings.owmKey}&units=imperial`;

  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 5000);
    const response   = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const d = await response.json();
    if (!d.main) throw new Error('No data');

    const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
    const dir  = dirs[Math.round((d.wind?.deg || 0) / 22.5) % 16];

    _cachedWeather = {
      temp:       Math.round(d.main.temp) + '°F',
      conditions: d.weather[0].description,
      wind:       Math.round(d.wind?.speed || 0) + ' mph ' + dir,
      fetchedAt:  Date.now(),
    };

    if (document.getElementById('modal-ride').classList.contains('open')) {
      applyWeatherToForm(_cachedWeather);
      setWeatherStatus('Fetched just now', 'ok');
    }

    if (showFeedback) UI.toast('Weather updated');

  } catch (e) {
    if (showFeedback) {
      setWeatherStatus('Fetch failed', 'fail');
      UI.toast('Weather fetch failed', 'error');
    }
  }
}

function applyWeatherToForm(w) {
  document.getElementById('r-temp').value       = w.temp       || '';
  document.getElementById('r-conditions').value = w.conditions || '';
  document.getElementById('r-wind').value       = w.wind       || '';
  if (w.wind) updateWindArrow(w.wind);
  setWeatherStatus('Fetched just now', 'ok');
}

function setWeatherStatus(msg, state) {
  const el = document.getElementById('weather-status');
  el.textContent = msg;
  el.className   = 'weather-status' + (state ? ' ' + state : '');
}

// ── Wind Arrow ────────────────────────────────────────────────────
const WIND_DEGS = {
  N:0, NNE:22, NE:45, ENE:67, E:90, ESE:112, SE:135, SSE:157,
  S:180, SSW:202, SW:225, WSW:247, W:270, WNW:292, NW:315, NNW:337,
};

function updateWindArrow(val) {
  const parts = val.trim().toUpperCase().split(/\s+/);
  const dir   = parts[parts.length - 1];
  const deg   = WIND_DEGS[dir];
  if (deg !== undefined) {
    document.getElementById('wind-arrow').style.transform = `rotate(${deg}deg)`;
  }
}

// ── Duration Wheel ────────────────────────────────────────────────
function buildDurWheel() {
  const wheel = document.getElementById('dur-wheel');
  let html = '<div style="height:52px"></div>';
  for (let m = 1; m <= 180; m++) {
    html += `<div class="dur-item" data-val="${m}">${m} min</div>`;
  }
  html += '<div style="height:52px"></div>';
  wheel.innerHTML = html;

  wheel.addEventListener('scroll', () => {
    const idx = Math.round(wheel.scrollTop / 38);
    wheel.querySelectorAll('.dur-item[data-val]').forEach((el, i) => {
      el.classList.toggle('active', i === idx);
    });
    const sel = wheel.querySelectorAll('.dur-item[data-val]')[idx];
    if (sel) {
      _selectedDuration = parseInt(sel.dataset.val);
      document.getElementById('dur-display').textContent = _selectedDuration;
    }
  });

  setDuration(30);
}

function setDuration(min) {
  _selectedDuration = min;
  document.getElementById('dur-display').textContent = min;
  const wheel = document.getElementById('dur-wheel');
  const idx   = min - 1;
  setTimeout(() => {
    wheel.scrollTop = idx * 38;
    wheel.querySelectorAll('.dur-item[data-val]').forEach((el, i) => {
      el.classList.toggle('active', i === idx);
    });
  }, 60);
}

// ── Autocomplete ──────────────────────────────────────────────────
function setupAutocomplete() {
  ['helmet','coat','shirt','pants','shoes','gloves'].forEach(slot => {
    const input = document.getElementById('c-' + slot);
    const list  = document.getElementById('ac-' + slot);
    input.addEventListener('input', () => showAc(slot, input.value, list));
    input.addEventListener('focus', () => showAc(slot, input.value, list));
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.ac-wrap')) {
      document.querySelectorAll('.ac-list').forEach(l => l.classList.remove('open'));
    }
  });
}

function showAc(slot, val, list) {
  const items    = _wardrobe[slot] || [];
  const filtered = val
    ? items.filter(i => i.toLowerCase().startsWith(val.toLowerCase()) && i.toLowerCase() !== val.toLowerCase())
    : items;

  if (!filtered.length) { list.classList.remove('open'); return; }

  list.innerHTML = filtered.map(i => `<div class="ac-item" data-val="${i}">${i}</div>`).join('');

  list.querySelectorAll('.ac-item').forEach(item => {
    item.addEventListener('mousedown', e => {
      e.preventDefault();
      document.getElementById('c-' + slot).value = item.dataset.val;
      list.classList.remove('open');
    });
  });

  list.classList.add('open');
}

// ── Comfort ───────────────────────────────────────────────────────
function setupComfort() {
  document.querySelectorAll('.comfort-opt').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.comfort-opt').forEach(o => o.classList.remove('selected'));
      el.classList.add('selected');
      _selectedComfort = el.dataset.val;
    });
  });
}

// ── Exertion ──────────────────────────────────────────────────────
function setupExertion() {
  document.querySelectorAll('.exertion-opt').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.exertion-opt').forEach(o => o.classList.remove('selected'));
      el.classList.add('selected');
      _selectedExertion = el.dataset.val;
    });
  });
}

// ── History ───────────────────────────────────────────────────────
const COMFORT_EMOJI  = { Freezing:'🥶', Cold:'😬', Good:'😊', Hot:'😓', Burning:'🥵' };
const EXERTION_EMOJI = { Easy:'🟢', Medium:'🟡', Hard:'🔴' };

function renderHistory() {
  const el     = document.getElementById('history-list');
  const sorted = [..._rides].reverse();

  if (!sorted.length) {
    el.innerHTML = '<div class="empty">No rides logged yet.</div>';
    return;
  }

  el.innerHTML = sorted.map(r => {
    const ce = COMFORT_EMOJI[r.comfort]   || '—';
    const xe = EXERTION_EMOJI[r.exertion] || '';

    const gear = [
      ['⛑️', r.helmet], ['🧥', r.coat], ['👕', r.shirt],
      ['👖', r.pants],  ['👟', r.shoes], ['🧤', r.gloves],
    ].filter(g => g[1]);

    const gearHtml = gear.length
      ? `<div class="clothing-mini">
          ${gear.map(g => `<div class="clothing-mini-row"><span>${g[0]}</span>${g[1]}</div>`).join('')}
          ${r.rain     ? '<div class="clothing-mini-row"><span>🌧️</span>Rain gear used</div>' : ''}
          ${r.backpack ? '<div class="clothing-mini-row"><span>🎒</span>Backpack</div>'       : ''}
        </div>`
      : '';

    const detailItems = [
      ['Miles',      r.miles + ' mi'],
      ['Gas/gal',    '$' + r.gasPrice],
      r.route        ? ['Route',      r.route]                           : null,
      r.temp         ? ['Temp',       r.temp]                            : null,
      r.conditions   ? ['Conditions', r.conditions]                      : null,
      r.wind         ? ['Wind',       r.wind]                            : null,
      r.comfort      ? ['Comfort',    ce + ' ' + r.comfort]              : null,
      r.exertion     ? ['Exertion',   xe + ' ' + r.exertion]             : null,
      r.ebikeClass   ? ['Class',      r.ebikeClass]                      : null,
      r.mode         ? ['Mode',       r.mode]                            : null,
      r.loading      ? ['Loading',    r.loading]                         : null,
      r.battery != null ? ['Battery', r.battery + '%']                   : null,
    ].filter(Boolean);

    return `
      <div class="ride-card" data-id="${r.id}">
        <div class="ride-card-head">
          <div>
            <div class="ride-date">${r.date || '—'}</div>
            <div class="ride-leg">${r.type} · ${r.leg}${r.endTime ? ' · ends ' + r.endTime : ''}${r.duration ? ' · ' + r.duration + ' min' : ''}</div>
          </div>
          <div class="ride-quick">
            <span class="ride-savings">+$${r.gasSaved?.toFixed(2) || '0.00'}</span>
            ${xe ? `<span style="font-size:15px">${xe}</span>` : ''}
            <span style="font-size:15px">${ce}</span>
            <span class="ride-chevron">▾</span>
          </div>
        </div>
        <div class="ride-detail">
          <div class="ride-detail-grid">
            ${detailItems.map(([l,v]) => `<div class="rd-item"><div class="rd-lbl">${l}</div><div class="rd-val">${v}</div></div>`).join('')}
          </div>
          ${gearHtml}
          ${r.notes ? `<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">${r.notes}</div>` : ''}
          <div class="ride-detail-actions">
            <button class="edit-ride-btn" data-id="${r.id}">Edit</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Expand/collapse
  el.querySelectorAll('.ride-card-head').forEach(head => {
    head.addEventListener('click', () => {
      const detail  = head.nextElementSibling;
      const chevron = head.querySelector('.ride-chevron');
      detail.classList.toggle('open');
      chevron.classList.toggle('open');
    });
  });

  // Edit button
  el.querySelectorAll('.edit-ride-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id   = parseInt(btn.dataset.id);
      const ride = _rides.find(r => r.id === id);
      if (ride) openEditRide(ride);
    });
  });
}

// ── Utils ─────────────────────────────────────────────────────────
function toDateVal(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function toTimeVal(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function pad(n)       { return n < 10 ? '0' + n : String(n); }

// ── Wire Events ───────────────────────────────────────────────────
function wireEvents() {
  // Header
  document.getElementById('btn-devlog').addEventListener('click',   () => UI.showDevlog(VERSIONS, APP_HISTORY, 'Bike Log'));
  document.getElementById('btn-settings').addEventListener('click', () => { populateSettingsForm(); openModal('modal-settings'); });

  // Home screen
  document.getElementById('btn-log-commute').addEventListener('click', () => openLogRide(true));
  document.getElementById('btn-log-other').addEventListener('click',   () => openLogRide(false));
  document.getElementById('btn-history').addEventListener('click',     () => showScreen('screen-history'));

  // History screen
  document.getElementById('btn-back-history').addEventListener('click', () => showScreen('screen-home'));

  // Ride modal
  document.getElementById('modal-ride-close').addEventListener('click',   () => closeModal('modal-ride'));
  document.getElementById('btn-save-ride').addEventListener('click',      saveRide);
  document.getElementById('btn-delete-ride').addEventListener('click',    deleteRide);
  document.getElementById('btn-fetch-weather').addEventListener('click',  () => fetchWeather(true));
  document.getElementById('r-wind').addEventListener('input', e => updateWindArrow(e.target.value));
  document.getElementById('rain-toggle').addEventListener('click',     e => e.currentTarget.classList.toggle('on'));
  document.getElementById('backpack-toggle').addEventListener('click', e => e.currentTarget.classList.toggle('on'));

  // Close modals on backdrop tap
  document.getElementById('modal-ride').addEventListener('click',     e => { if (e.target === e.currentTarget) closeModal('modal-ride'); });
  document.getElementById('modal-settings').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal('modal-settings'); });

  // Settings modal
  document.getElementById('modal-settings-close').addEventListener('click', () => closeModal('modal-settings'));
  document.getElementById('btn-save-settings').addEventListener('click',    saveSettings);

  // Autocomplete, comfort, exertion
  setupAutocomplete();
  setupComfort();
  setupExertion();
}

// ── Start ─────────────────────────────────────────────────────────
init();
