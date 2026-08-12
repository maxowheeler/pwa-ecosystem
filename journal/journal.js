// journal.js — Journal home page logic
// Handles: init, rendering, saving, followup removal, compose toggle
// Data flows: localStorage (via storage.js) → render → sync.js → Pi

import Storage  from '../shared/storage.js';
import Sync     from '../shared/sync.js';
import UI       from '../shared/ui.js';
import VERSIONS from '../shared/versions.js';

const APP = 'journal';
const KEY = 'entries';

// App version history — shown in devlog modal
const APP_HISTORY = [
  {
    number: 'v1.2',
    date:   '2026-05-18',
    notes:  [
      'Hotfix to deploy new sync pill modal',
    ],
  },
  {
    number: 'v1.1',
    date:   '2026-05-17',
    notes:  [
      'Two-row sticky header — app name, date, gear, sync pill',
      'Gear opens No Settings modal (journal has no settings)',
      'Header persists while scrolling',
    ],
  },
  {
    number: 'v1.0',
    date:   '2026-03-06',
    notes:  [
      'Rebuilt on shared PWA infrastructure',
      'localStorage via storage.js, sync via sync.js',
      'Journal and Foam entry types',
      'Followup flag with badge',
      'View All page with filter bar',
      'Random Foam popup on load',
      'Devlog panel',
      'Sync pill in header',
    ],
  },
];

// Expose to window for HTML onclick handlers
window.setType   = setType;
window.saveEntry = saveEntry;

// ── Init ──────────────────────────────────────────────────────────
let _updateSyncPill;

async function init() {
  UI.setHeaderDate(document.getElementById('header-date'));
  UI.autoGrow(document.getElementById('entry-text'));

  // Sync pill in header row 2
_updateSyncPill = UI.syncPill(document.getElementById('sync-row'), 'journal', 'entries', Sync);
  // App name → devlog
  document.getElementById('btn-devlog')
    .addEventListener('click', () => UI.showDevlog(VERSIONS, APP_HISTORY, 'Journal'));

  // Gear → no settings
  document.getElementById('btn-settings')
    .addEventListener('click', () => UI.noSettings());

  // Pull from Pi on first load (skipped if local data exists)
  const pulled = await Sync.pull(APP, KEY);
  _updateSyncPill(pulled ? 'ok' : 'never');

  renderEntries();

  // Show random Foam popup if any Foam entries exist
  const all  = Storage.load(APP, KEY);
  const foam = all.filter(e => e.type === 'Foam');
  if (foam.length > 0) UI.showFoamPopup(foam);
}

// ── Render ────────────────────────────────────────────────────────
function renderEntries() {
  const all    = Storage.load(APP, KEY);
  const recent = [...all].reverse().slice(0, 10); // newest first, max 10
  const list   = document.getElementById('entries-list');
  list.innerHTML = '';

  if (recent.length === 0) {
    list.innerHTML = '<div class="empty">No entries yet.</div>';
    return;
  }

  recent.forEach(entry => list.appendChild(buildCard(entry)));
}

// ── Build Entry Card ──────────────────────────────────────────────
function buildCard(entry) {
  const isFoam = entry.type === 'Foam';
  const wrap   = document.createElement('div');
  wrap.className  = `entry entry-${isFoam ? 'foam' : 'journal'}`;
  wrap.dataset.id = entry.id;

  // Header
  const header = document.createElement('div');
  header.className = 'entry-header';

  const left = document.createElement('div');
  left.className = 'entry-header-left';

  const time = document.createElement('span');
  time.textContent = entry.time || entry.createdAt || '';

  const typeTag = document.createElement('span');
  typeTag.className   = 'entry-type-tag';
  typeTag.textContent = entry.type;

  left.append(time, typeTag);

  const right = document.createElement('div');
  right.className = 'entry-header-right';

  if (entry.followup) {
    const badge = document.createElement('button');
    badge.className   = 'followup-badge';
    badge.textContent = '↩ Followup';
    badge.title       = 'Click to clear followup';
    badge.addEventListener('click', () => removeFollowup(entry.id));
    right.appendChild(badge);
  }

  if (entry.title) {
    const title = document.createElement('span');
    title.className   = 'entry-title';
    title.textContent = entry.title;
    right.appendChild(title);
  }

  header.append(left, right);

  // Body
  const body = document.createElement('div');
  body.className   = 'entry-body';
  body.textContent = entry.body;

  wrap.append(header, body);
  return wrap;
}

// ── Save Entry ────────────────────────────────────────────────────
function saveEntry() {
  const text     = document.getElementById('entry-text').value.trim();
  const title    = document.getElementById('entry-title').value.trim();
  const followup = document.getElementById('followup-check').checked;
  const type     = document.getElementById('toggle-wrap').dataset.type || 'Journal';

  if (!text) {
    UI.toast('Nothing to save', 'error');
    return;
  }

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const time = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const record = { type, followup, title, body: text, time };

  try {
    Storage.append(APP, KEY, record);
    UI.toast('Entry saved');
    resetCompose();
    renderEntries();
    Sync.push(APP, KEY).then(ok => _updateSyncPill(ok ? 'ok' : 'fail'));
  } catch (e) {
    document.getElementById('save-error').classList.remove('hidden');
    UI.toast('Save failed', 'error');
    console.error('[journal] save failed', e);
  }
}

// ── Remove Followup ───────────────────────────────────────────────
function removeFollowup(id) {
  Storage.update(APP, KEY, { id, followup: false });
  renderEntries();
  Sync.push(APP, KEY).then(ok => _updateSyncPill(ok ? 'ok' : 'fail'));
}

// ── Compose Helpers ───────────────────────────────────────────────
function setType(type) {
  const wrap    = document.getElementById('toggle-wrap');
  const compose = document.getElementById('compose-box');
  const tJ      = document.getElementById('toggle-journal');
  const tF      = document.getElementById('toggle-foam');

  wrap.dataset.type = type;
  tJ.className = 'toggle-opt' + (type === 'Journal' ? ' active-journal' : '');
  tF.className = 'toggle-opt' + (type === 'Foam'    ? ' active-foam'    : '');
  compose.classList.toggle('foam-mode', type === 'Foam');
  wrap.classList.toggle('foam-mode',    type === 'Foam');
}

function resetCompose() {
  document.getElementById('entry-text').value       = '';
  document.getElementById('entry-title').value      = '';
  document.getElementById('followup-check').checked = false;
  document.getElementById('save-error').classList.add('hidden');
  UI.autoGrow(document.getElementById('entry-text'));
  setType('Journal');
}

// ── Start ─────────────────────────────────────────────────────────
init();
