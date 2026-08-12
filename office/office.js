// office.js — Office Status app logic
// Pushes status updates directly to a self-hosted BYOS server (Cloud Run).
//
// Deviation from the usual architecture, on purpose:
//   This app does NOT use sync.js for its actual status pushes — those go
//   straight to the Cloud Run webhook via fetch(), since the user needs
//   immediate, visible success/fail feedback, not a background sync pill.
//   It DOES use sync.js for one narrow thing: backing up image usage stats
//   (useCount/lastUsedAt, no image bytes) to the Pi via sync.php, since
//   that's exactly what sync.js's best-effort push/pull is built for. Two
//   separate network destinations for two separate purposes — worth being
//   explicit about so this doesn't look like an accidental inconsistency.

import Storage  from '../shared/storage.js';
import Sync     from '../shared/sync.js';
import UI       from '../shared/ui.js';
import VERSIONS from '../shared/versions.js';

const APP = 'office';

const APP_HISTORY = [
  {
    number: 'v1.4',
    date:   '2026-08-05',
    notes:  [
      'Removed the Current Status preview card — it rendered an old layout that no longer matches the display',
      'Replaced the fixed icon-key picker with a full image library: drop pre-dithered PNGs in office/pics/ on the Pi, picker shows them as a 3-column grid, sortable by Most Used / Least Used / Newest',
      'Image usage counts tracked locally, backed up to the Pi (stats only, no image bytes) via sync.js',
      'Sync pill now matches Journal/Bike style — tapping it opens a push-history modal with a bottom "Refresh App" button that updates the image library, backs up usage stats, then clears cache and reloads',
      'New canned buttons: At Lunch / Side Quest / Focus Mode / in DESIGN HUB — buttons now only set status text, image selection is fully independent',
      'Removed the "Available" clear button — "I\'m Back" already covers that',
      'Added "Out - Back [next weekday]" button — pushes immediately with a fixed 9 AM back-at, resolves to Monday over a weekend so it never goes stale',
    ],
  },
  {
    number: 'v1.3',
    date:   '2026-07-30',
    notes:  [
      'Removed color flair (was from an early test, no longer used)',
      'Removed emoji field — replaced with an icon picker matching BYOS art assets',
      'Back At quick buttons changed to 15m / 30m / 45m (custom entry still uses a time picker)',
      'Settings BYOS Server URL field now wraps instead of requiring horizontal drag-scroll',
    ],
  },
  {
    number: 'v1.2',
    date:   '2026-07-26',
    notes:  [
      'Switched from TRMNL hosted webhook to self-hosted BYOS on Cloud Run',
      'Settings now store BYOS server URL + push secret instead of Plugin UUID',
      'Push authenticates via Bearer token; rendering happens server-side now',
    ],
  },
  {
    number: 'v1.1',
    date:   '2026-07-25',
    notes:  [
      'Emoji field — entered via native keyboard, not a curated picker',
      'Canned statuses carry a default emoji, overridable per push',
      'Emoji shown large in Current Status card and Recent Pushes',
    ],
  },
  {
    number: 'v1.0',
    date:   '2026-07-25',
    notes:  [
      'Canned statuses + custom text entry',
      'Color flair picker (default / red / yellow)',
      'Back-at time via quick-duration buttons or manual time picker',
      'Direct POST to TRMNL Private Plugin webhook',
      'Recent pushes list, TRMNL Plugin UUID stored in settings',
    ],
  },
];

const CANNED_LABELS = ['At Lunch', 'Side Quest', 'Focus Mode', 'in DESIGN HUB'];

const WEBHOOK_TIMEOUT_MS = 5000;
const WEBHOOK_LOG_KEY = 'office:webhookLog';
const MAX_WEBHOOK_LOG = 10;

// ── State ─────────────────────────────────────────────────────────
let _settings      = { serverUrl: '', pushSecret: '' };
let _history       = [];
let _selectedImage = null; // { id, base64 } or null — sticky across pushes on purpose
let _backAtISO     = null;
let _backAtDisp    = '';
let _imageSort     = 'newest';
let _updatePill;

// ── Init ──────────────────────────────────────────────────────────
async function init() {
  UI.setHeaderDate(document.getElementById('header-date'));

  loadSettings();
  loadImageSortPref();
  _history = Storage.load(APP, 'history');

  // Recovers usage stats from the Pi backup on a fresh install. Does NOT
  // pull the image library itself — that only ever comes from an explicit
  // Refresh App tap, since it means fetching every image file over the LAN.
  await Sync.pull(APP, 'imageUsage');

  _updatePill = webhookStatusPill(document.getElementById('webhook-row'));
  _updatePill(_history.length ? 'ok' : 'never');

  renderHistory();
  wireEvents();
}

// ── Settings ──────────────────────────────────────────────────────
function loadSettings() {
  const saved = Storage.load(APP, 'settings');
  if (saved && saved.length > 0 && typeof saved[0] === 'object') {
    _settings = { ..._settings, ...saved[0] };
  }
}

function saveSettings() {
  _settings.serverUrl  = document.getElementById('s-server-url').value.trim().replace(/\/+$/, '');
  _settings.pushSecret = document.getElementById('s-push-secret').value.trim();
  Storage.save(APP, 'settings', [_settings]);
  closeSettings();
  UI.toast('Settings saved');
}

function openSettings() {
  document.getElementById('s-server-url').value  = _settings.serverUrl;
  document.getElementById('s-push-secret').value = _settings.pushSecret;
  document.getElementById('settings-backdrop').classList.add('open');
}

function closeSettings() {
  document.getElementById('settings-backdrop').classList.remove('open');
}

// ── Image library ─────────────────────────────────────────────────
// Master files live on the Pi at /apps/office/pics/, dropped in directly
// via Finder (like shared/icons/) — no staging/deploy.sh step. Refresh App
// pulls the current file list + bytes down into local storage as base64,
// so the picker works without hitting the network on every open.

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function loadUsageMap() {
  const usage = Storage.load(APP, 'imageUsage'); // [{id, useCount, lastUsedAt}]
  return Object.fromEntries(usage.map(u => [u.id, u]));
}

async function refreshImageLibrary() {
  const res = await fetch('./list-pics.php', { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { files } = await res.json();

  const existing = Storage.load(APP, 'images');
  const existingMap = Object.fromEntries(existing.map(img => [img.id, img]));
  const usageMap = loadUsageMap();

  const updated = [];
  for (const filename of files) {
    const imgRes = await fetch('./pics/' + encodeURIComponent(filename), { cache: 'no-store' });
    if (!imgRes.ok) continue; // skip individual failures rather than aborting the whole sync

    const blob = await imgRes.blob();
    // Guard against blank cells: an empty body or non-image content-type
    // (e.g. a misrouted response) shouldn't get stored as a "real" image.
    if (!blob || blob.size === 0 || !blob.type.startsWith('image/')) {
      console.warn('[office] skipped invalid image data for', filename, blob && blob.type, blob && blob.size);
      continue;
    }

    const base64 = await blobToBase64(blob);
    const prior = existingMap[filename] || usageMap[filename];

    updated.push({
      id:         filename,
      base64,
      useCount:   prior?.useCount || 0,
      lastUsedAt: prior?.lastUsedAt || null,
      addedAt:    existingMap[filename]?.addedAt || new Date().toISOString(),
    });
  }

  Storage.save(APP, 'images', updated);

  // A selected image may have just been refreshed with the same bytes —
  // keep the selection alive by id rather than clearing it.
  if (_selectedImage) {
    const stillThere = updated.find(img => img.id === _selectedImage.id);
    if (stillThere) _selectedImage = { id: stillThere.id, base64: stillThere.base64 };
  }

  return updated.length;
}

async function backupImageUsage() {
  const images = Storage.load(APP, 'images');
  const usageOnly = images.map(img => ({
    id: img.id,
    useCount: img.useCount || 0,
    lastUsedAt: img.lastUsedAt || null,
  }));
  Storage.save(APP, 'imageUsage', usageOnly);
  await Sync.push(APP, 'imageUsage'); // best-effort, fails silently per sync.js
}

function incrementImageUsage() {
  if (!_selectedImage) return;
  const images = Storage.load(APP, 'images');
  const idx = images.findIndex(img => img.id === _selectedImage.id);
  if (idx !== -1) {
    images[idx].useCount = (images[idx].useCount || 0) + 1;
    images[idx].lastUsedAt = new Date().toISOString();
    Storage.save(APP, 'images', images);
  }
}

function loadImageSortPref() {
  const saved = Storage.load(APP, 'imageSortPref');
  if (saved && saved.length > 0 && typeof saved[0] === 'string') {
    _imageSort = saved[0];
  }
}

function saveImageSortPref(sort) {
  _imageSort = sort;
  Storage.save(APP, 'imageSortPref', [sort]);
}

function sortedImages() {
  const images = [...Storage.load(APP, 'images')];
  if (_imageSort === 'most') {
    images.sort((a, b) => (b.useCount || 0) - (a.useCount || 0));
  } else if (_imageSort === 'least') {
    images.sort((a, b) => (a.useCount || 0) - (b.useCount || 0));
  } else {
    images.sort((a, b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0));
  }
  return images;
}

function updateImagePreview() {
  const box = document.getElementById('image-preview-box');
  if (_selectedImage) {
    box.innerHTML = '';
    box.style.backgroundImage = `url(data:image/png;base64,${_selectedImage.base64})`;
  } else {
    box.style.backgroundImage = '';
    box.innerHTML = '<span class="image-preview-empty">No image</span>';
  }
}

// ── Image Picker Modal ────────────────────────────────────────────
function openImagePicker() {
  const backdrop = document.createElement('div');
  Object.assign(backdrop.style, { position: 'fixed', inset: '0', zIndex: '500', background: 'rgba(0,0,0,0.6)' });

  const modal = document.createElement('div');
  Object.assign(modal.style, {
    position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
    width: 'min(420px, 92vw)', maxHeight: '82vh', background: '#222222', border: '1px solid #333333',
    borderRadius: '6px', zIndex: '501', display: 'flex', flexDirection: 'column',
    fontFamily: "'JetBrains Mono', monospace", boxShadow: '0 8px 32px rgba(0,0,0,0.6)', overflow: 'hidden',
  });

  const header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 14px', background: '#2a2a2a', borderBottom: '1px solid #2e2e2e', flexShrink: '0',
  });
  const titleEl = document.createElement('span');
  titleEl.textContent = 'Choose Image';
  Object.assign(titleEl.style, { fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#777777' });
  const closeBtn = document.createElement('span');
  closeBtn.textContent = '✕';
  Object.assign(closeBtn.style, { fontSize: '14px', color: '#777777', cursor: 'pointer', padding: '2px 4px' });
  closeBtn.addEventListener('click', cleanup);
  backdrop.addEventListener('click', cleanup);
  header.append(titleEl, closeBtn);

  const sortBar = document.createElement('div');
  sortBar.className = 'image-picker-sortbar';
  [['newest', 'Newest'], ['most', 'Most Used'], ['least', 'Least Used']].forEach(([key, label]) => {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.className = 'filter-btn' + (_imageSort === key ? ' active' : '');
    btn.addEventListener('click', () => {
      saveImageSortPref(key);
      sortBar.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderGrid();
    });
    sortBar.appendChild(btn);
  });

  const gridWrap = document.createElement('div');
  Object.assign(gridWrap.style, { overflowY: 'auto', flex: '1', padding: '12px' });
  const grid = document.createElement('div');
  grid.className = 'image-picker-grid';
  gridWrap.appendChild(grid);

  function renderGrid() {
    const images = sortedImages();
    grid.innerHTML = '';
    if (images.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.style.gridColumn = '1 / -1';
      empty.textContent = 'No images yet — tap the push-history pill above, then Refresh App to pull images from the Pi.';
      grid.appendChild(empty);
      return;
    }
    images.forEach(img => {
      const cell = document.createElement('button');
      cell.className = 'image-picker-cell';
      cell.style.backgroundImage = `url(data:image/png;base64,${img.base64})`;
      cell.title = img.id;
      cell.addEventListener('click', () => {
        _selectedImage = { id: img.id, base64: img.base64 };
        updateImagePreview();
        cleanup();
      });
      grid.appendChild(cell);
    });
  }

  renderGrid();

  modal.append(header, sortBar, gridWrap);
  document.body.append(backdrop, modal);

  function cleanup() {
    backdrop.remove();
    modal.remove();
  }
}

// ── Webhook Push-History Modal ────────────────────────────────────
// Deliberately NOT built on top of UI.showSyncModal — that modal's button
// labels/semantics ("Push iPhone → Pi" / "Pull iPhone ← Pi") are specific
// to sync.js's Pi-sync model, which doesn't match what Office actually
// does (push a status to a Cloud Run webhook, refresh an image library).
// This copies the same visual construction for consistency, but is kept
// office-local rather than generalizing ui.js for a pattern only one app
// needs so far — worth revisiting if a fourth app ever wants this too.

function writeWebhookLog(entry) {
  const raw = localStorage.getItem(WEBHOOK_LOG_KEY);
  const existing = raw ? JSON.parse(raw) : [];
  existing.push(entry);
  if (existing.length > MAX_WEBHOOK_LOG) existing.splice(0, existing.length - MAX_WEBHOOK_LOG);
  localStorage.setItem(WEBHOOK_LOG_KEY, JSON.stringify(existing));
}

function readWebhookLog() {
  const raw = localStorage.getItem(WEBHOOK_LOG_KEY);
  return raw ? JSON.parse(raw) : [];
}

function webhookStatusPill(containerEl) {
  containerEl.innerHTML = `
    <div class="sync-pill" id="wh-pill" style="cursor:pointer;" title="Tap to view push history">
      <div class="sync-dot" id="wh-dot"></div>
      <span id="wh-label">not pushed yet</span>
    </div>
  `;
  const pill  = containerEl.querySelector('#wh-pill');
  const dot   = containerEl.querySelector('#wh-dot');
  const label = containerEl.querySelector('#wh-label');

  function update(state) {
    dot.className = 'sync-dot' + (state === 'ok' ? ' ok' : state === 'fail' ? ' fail' : '');
    label.textContent =
      state === 'ok'      ? 'pushed to server' :
      state === 'fail'    ? 'push failed'      :
      state === 'pushing' ? 'pushing…'         :
                             'not pushed yet';
  }

  pill.addEventListener('click', showWebhookHistoryModal);
  return update;
}

function showWebhookHistoryModal() {
  const backdrop = document.createElement('div');
  Object.assign(backdrop.style, { position: 'fixed', inset: '0', zIndex: '600', background: 'rgba(0,0,0,0.6)' });

  const modal = document.createElement('div');
  Object.assign(modal.style, {
    position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
    width: 'min(420px, 92vw)', maxHeight: '82vh', background: '#222222', border: '1px solid #333333',
    borderRadius: '6px', zIndex: '601', display: 'flex', flexDirection: 'column',
    fontFamily: "'JetBrains Mono', monospace", boxShadow: '0 8px 32px rgba(0,0,0,0.6)', overflow: 'hidden',
  });

  const header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 14px', background: '#2a2a2a', borderBottom: '1px solid #2e2e2e', flexShrink: '0',
  });
  const titleEl = document.createElement('span');
  titleEl.textContent = 'Push History — Office';
  Object.assign(titleEl.style, { fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#777777' });
  const closeBtn = document.createElement('span');
  closeBtn.textContent = '✕';
  Object.assign(closeBtn.style, { fontSize: '14px', color: '#777777', cursor: 'pointer', padding: '2px 4px' });
  closeBtn.addEventListener('click', cleanup);
  backdrop.addEventListener('click', cleanup);
  header.append(titleEl, closeBtn);

  const historyWrap = document.createElement('div');
  Object.assign(historyWrap.style, { overflowY: 'auto', flex: '1' });

  function renderLog() {
    historyWrap.innerHTML = '';
    const secLabel = document.createElement('div');
    secLabel.textContent = 'Recent Attempts';
    Object.assign(secLabel.style, {
      fontSize: '9px', letterSpacing: '0.14em', textTransform: 'uppercase',
      color: '#555', padding: '8px 14px 4px', borderBottom: '1px solid #2e2e2e',
    });
    historyWrap.appendChild(secLabel);

    const log = readWebhookLog();
    if (log.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'No push attempts recorded yet.';
      Object.assign(empty.style, {
        fontSize: '12px', color: '#555', padding: '20px 14px',
        letterSpacing: '0.05em', textAlign: 'center',
      });
      historyWrap.appendChild(empty);
      return;
    }

    [...log].reverse().forEach(entry => {
      const row = document.createElement('div');
      Object.assign(row.style, {
        padding: '10px 14px', borderBottom: '1px solid #2a2a2a',
        background: entry.success ? 'transparent' : 'rgba(224,92,92,0.04)',
      });

      const topLine = document.createElement('div');
      Object.assign(topLine.style, { display: 'flex', alignItems: 'center', gap: '8px' });

      const ts = document.createElement('span');
      const d = new Date(entry.timestamp);
      ts.textContent = d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }) +
        ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
      Object.assign(ts.style, { fontSize: '11px', color: '#777777', flex: '1' });

      const status = document.createElement('span');
      status.textContent = entry.success ? '✓ ok' : '✗ failed';
      Object.assign(status.style, { fontSize: '11px', fontWeight: '500', color: entry.success ? '#5ecf8a' : '#e05c5c' });

      topLine.append(ts, status);
      row.appendChild(topLine);

      if (entry.error) {
        const err = document.createElement('div');
        err.textContent = entry.error;
        Object.assign(err.style, { fontSize: '10px', color: '#e05c5c', marginTop: '4px', letterSpacing: '0.03em' });
        row.appendChild(err);
      }

      historyWrap.appendChild(row);
    });
  }

  renderLog();

  const updateWrap = document.createElement('div');
  Object.assign(updateWrap.style, {
    padding: '10px 14px', borderTop: '1px solid #3a3a3a', background: '#1e1e1e', flexShrink: '0',
  });

  const updateLabel = document.createElement('div');
  updateLabel.textContent = 'App Maintenance';
  Object.assign(updateLabel.style, {
    fontSize: '9px', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#444444', marginBottom: '8px',
  });

  const refreshBtn = document.createElement('button');
  refreshBtn.textContent = '⟳  Refresh App — Update Images & Cache';
  Object.assign(refreshBtn.style, {
    width: '100%', padding: '9px 6px',
    fontFamily: "'JetBrains Mono', monospace", fontSize: '10px', fontWeight: '500',
    letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer',
    borderRadius: '4px', border: '1px solid rgba(160,160,160,0.2)',
    background: 'rgba(160,160,160,0.06)', color: '#888888', transition: 'opacity 0.15s',
  });

  refreshBtn.addEventListener('click', async () => {
    const ok = await UI.confirm(
      'This pulls fresh images from the Pi, backs up your image usage stats there, then clears the app cache and reloads to install any updates.\n\nYour push history is not affected.\n\nProceed?',
      620
    );
    if (!ok) return;

    refreshBtn.textContent = 'Syncing images…';
    refreshBtn.style.opacity = '0.6';
    refreshBtn.disabled = true;

    try {
      const count = await refreshImageLibrary();
      await backupImageUsage();
      UI.toast(`Synced ${count} image(s) from Pi`);
    } catch (e) {
      console.error('[office] image library refresh failed', e);
      UI.toast('Could not reach Pi for image sync — updating app anyway', 'error');
    }

    await UI.refreshApp();
  });

  updateWrap.append(updateLabel, refreshBtn);

  modal.append(header, historyWrap, updateWrap);
  document.body.append(backdrop, modal);

  function cleanup() {
    backdrop.remove();
    modal.remove();
  }
}

// ── Back-At helpers ────────────────────────────────────────────────
function formatBackAt(d) {
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = formatTime(d);
  return sameDay ? time : `${time} ${d.toLocaleDateString('en-US', { weekday: 'short' })}`;
}

function setBackAtFromMinutes(min) {
  const d = new Date(Date.now() + min * 60000);
  _backAtISO  = d.toISOString();
  _backAtDisp = formatBackAt(d);
  document.getElementById('backat-time').value = '';
  renderBackAt();
}

function setBackAtFromTimeInput(hhmm) {
  if (!hhmm) return;
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1); // rolled past — assume tomorrow
  _backAtISO  = d.toISOString();
  _backAtDisp = formatBackAt(d);
  renderBackAt();
}

function clearBackAt() {
  _backAtISO  = null;
  _backAtDisp = '';
  document.getElementById('backat-time').value = '';
  renderBackAt();
}

function renderBackAt() {
  document.getElementById('backat-display').textContent =
    _backAtDisp ? `Back at ${_backAtDisp}` : 'No back-at time set';
}

// ── "Out for the day" ──────────────────────────────────────────────
// Always resolves to the next weekday at 9 AM, so it never goes stale
// over a weekend. Genuinely multi-day absences (vacation, etc.) should
// use a custom status with an explicit back-at instead.
function nextWeekday() {
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const d = new Date();
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + 1);
  }
  d.setHours(9, 0, 0, 0);
  return { date: d, label: names[d.getDay()] };
}

function pushOutForDay() {
  const { date, label } = nextWeekday();
  document.getElementById('status-input').value = `Out - back ${label}`;
  _backAtISO  = date.toISOString();
  _backAtDisp = formatBackAt(date);
  renderBackAt();
  pushStatus();
}

// ── Push ──────────────────────────────────────────────────────────
async function pushStatus() {
  if (!_settings.serverUrl || !_settings.pushSecret) {
    UI.toast('Add your BYOS server URL and push secret in settings first', 'error');
    openSettings();
    return;
  }

  const statusText   = document.getElementById('status-input').value.trim() || 'Available';
  const pushedAtDisp = formatTime(new Date());

  const payload = {
    statusText,
    icon:       _selectedImage ? _selectedImage.id : '',
    iconImage:  _selectedImage ? _selectedImage.base64 : null,
    backAt:     _backAtDisp || '',
    backAtISO:  _backAtISO || null,
    pushedAt:   pushedAtDisp,
  };

  _updatePill('pushing');

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

    const response = await fetch(`${_settings.serverUrl}/status`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${_settings.pushSecret}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    Storage.append(APP, 'history', {
      statusText,
      icon:        payload.icon,
      iconImage:   payload.iconImage,
      backAt:      _backAtDisp || '',
      backAtISO:   _backAtISO,
      pushedAt:    pushedAtDisp,
      pushedAtISO: new Date().toISOString(),
    });
    _history = Storage.load(APP, 'history');

    incrementImageUsage();
    writeWebhookLog({ timestamp: new Date().toISOString(), success: true, error: null });

    _updatePill('ok');
    UI.toast('Status pushed');
    resetCompose();
    renderHistory();

  } catch (e) {
    writeWebhookLog({ timestamp: new Date().toISOString(), success: false, error: e.message });
    _updatePill('fail');
    UI.toast(`Push failed — ${e.message || 'check server URL and secret'}`, 'error');
    console.error('[office] push failed', e);
  }
}

function clearToAvailable() {
  document.getElementById('status-input').value = '';
  clearBackAt();
}

function resetCompose() {
  document.getElementById('status-input').value = '';
  clearBackAt();
  // _selectedImage intentionally NOT cleared — most pushes (Focus Mode,
  // Side Quest, etc.) likely reuse the same image repeatedly.
}

// ── Render History ────────────────────────────────────────────────
function renderHistory() {
  const list = document.getElementById('history-list');
  const recent = [..._history].reverse().slice(0, 5);

  if (recent.length === 0) {
    list.innerHTML = '<div class="empty">Nothing pushed yet.</div>';
    return;
  }

  list.innerHTML = recent.map(h => `
    <div class="entry history-entry">
      <div class="entry-header">
        <div class="entry-header-left">
          ${h.iconImage ? `<img class="entry-thumb" src="data:image/png;base64,${h.iconImage}" alt="">` : ''}
          <span>${escapeHtml(h.statusText)}</span>
        </div>
        <div class="entry-header-right">
          <span class="entry-type-tag">${escapeHtml(h.pushedAt)}</span>
        </div>
      </div>
      ${h.backAt ? `<div class="entry-body">Back at ${escapeHtml(h.backAt)}</div>` : ''}
    </div>
  `).join('');

  // Tap a recent entry to refill the compose form (does not auto-push)
  list.querySelectorAll('.history-entry').forEach((el, i) => {
    el.addEventListener('click', () => {
      const record = recent[i];
      document.getElementById('status-input').value = record.statusText;
      if (record.iconImage) {
        _selectedImage = { id: record.icon || 'unknown', base64: record.iconImage };
        updateImagePreview();
      }
      if (record.backAt) {
        UI.toast('Status refilled — set a new back-at time');
      } else {
        clearBackAt();
      }
    });
  });
}

// ── Utils ─────────────────────────────────────────────────────────
function formatTime(d) {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// ── Wire Events ───────────────────────────────────────────────────
function wireEvents() {
  document.getElementById('btn-devlog')
    .addEventListener('click', () => UI.showDevlog(VERSIONS, APP_HISTORY, 'Office Status'));

  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.getElementById('btn-settings-close').addEventListener('click', closeSettings);
  document.getElementById('btn-settings-save').addEventListener('click', saveSettings);
  document.getElementById('settings-backdrop').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeSettings();
  });

  document.querySelectorAll('.canned-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('status-input').value = btn.dataset.label;
    });
  });

  document.getElementById('btn-choose-image').addEventListener('click', openImagePicker);

  document.querySelectorAll('.backat-btn').forEach(btn => {
    btn.addEventListener('click', () => setBackAtFromMinutes(parseInt(btn.dataset.min)));
  });
  document.getElementById('backat-time')
    .addEventListener('change', e => setBackAtFromTimeInput(e.target.value));
  document.getElementById('btn-clear-backat').addEventListener('click', clearBackAt);

  document.getElementById('btn-push').addEventListener('click', pushStatus);
  document.getElementById('btn-im-back').addEventListener('click', () => {
    clearToAvailable();
    pushStatus();
  });
  document.getElementById('btn-out-day').addEventListener('click', pushOutForDay);
}

// ── Start ─────────────────────────────────────────────────────────
init();
