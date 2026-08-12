// viewall.js — All entries page logic
// Renders full entry list with filter bar.
// Edit modal with Save / Delete / Cancel — each with confirmation.
// Data source: localStorage via storage.js (same store as journal.js)

import Storage  from '../shared/storage.js';
import Sync     from '../shared/sync.js';
import UI       from '../shared/ui.js';
import VERSIONS from '../shared/versions.js';

const APP = 'journal';
const KEY = 'entries';

// App history reused from journal.js — just show devlog for context
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
      'Two-row sticky header',
      'Edit modal with Save / Delete / Cancel + confirmation',
      'Foam entry actions bar has rainbow animation',
      'Entry card gap increased for breathing room',
    ],
  },
  {
    number: 'v1.0',
    date:   '2026-03-06',
    notes:  [
      'All entries view with filter bar',
      'Delete button per entry with confirmation',
      'Followup badge removal',
    ],
  },
];

// Expose to window for HTML onclick handlers
window.setFilter = setFilter;

let _currentFilter  = 'all';
let _allEntries     = [];
let _updateSyncPill;

// ── Init ──────────────────────────────────────────────────────────
async function init() {
  UI.setHeaderDate(document.getElementById('header-date'));

  // Sync pill
_updateSyncPill = UI.syncPill(document.getElementById('sync-row'), 'journal', 'entries', Sync);
  // App name → devlog
  document.getElementById('btn-devlog')
    .addEventListener('click', () => UI.showDevlog(VERSIONS, APP_HISTORY, 'All Entries'));

  // Gear → no settings
  document.getElementById('btn-settings')
    .addEventListener('click', () => UI.noSettings());

  // Pull from Pi only if local storage is empty
  const pulled = await Sync.pull(APP, KEY);
  _updateSyncPill(pulled ? 'ok' : 'never');

  _allEntries = [...Storage.load(APP, KEY)].reverse();
  updateCounts();
  renderEntries();
}

// ── Counts ────────────────────────────────────────────────────────
function updateCounts() {
  document.getElementById('count-all').textContent      = _allEntries.length;
  document.getElementById('count-journal').textContent  = _allEntries.filter(e => e.type === 'Journal').length;
  document.getElementById('count-foam').textContent     = _allEntries.filter(e => e.type === 'Foam').length;
  document.getElementById('count-followup').textContent = _allEntries.filter(e => e.followup).length;
}

// ── Filter ────────────────────────────────────────────────────────
function setFilter(filter) {
  _currentFilter = filter;

  ['all', 'journal', 'foam', 'followup'].forEach(f => {
    const btn = document.getElementById('filter-' + f);
    btn.className = 'filter-btn' +
      (f === filter ? (f === 'followup' ? ' active-followup' : ' active') : '');
  });

  renderEntries();
}

// ── Render ────────────────────────────────────────────────────────
function renderEntries() {
  const filtered = _allEntries.filter(e => {
    if (_currentFilter === 'all')      return true;
    if (_currentFilter === 'journal')  return e.type === 'Journal';
    if (_currentFilter === 'foam')     return e.type === 'Foam';
    if (_currentFilter === 'followup') return e.followup === true;
    return true;
  });

  const list = document.getElementById('entries-list');
  list.innerHTML = '';

  const vc = document.getElementById('visible-count');
  vc.textContent = _currentFilter !== 'all' ? `${filtered.length} shown` : '';

  if (filtered.length === 0) {
    list.innerHTML = '<div class="empty">No entries match this filter.</div>';
    return;
  }

  filtered.forEach(entry => list.appendChild(buildCard(entry)));
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

  // Actions bar — Edit button
  // Foam entries get the rainbow class on the actions bar
  const actions = document.createElement('div');
  actions.className = isFoam ? 'entry-actions entry-actions-foam' : 'entry-actions';

  const editBtn = document.createElement('button');
  editBtn.className   = isFoam ? 'entry-edit-btn entry-edit-btn-foam' : 'entry-edit-btn';
  editBtn.textContent = 'Edit';
  editBtn.addEventListener('click', () => openEditModal(entry));
  actions.appendChild(editBtn);

  wrap.append(header, body, actions);
  return wrap;
}

// ── Edit Modal ────────────────────────────────────────────────────
function openEditModal(entry) {
  // Backdrop
  const backdrop = document.createElement('div');
  Object.assign(backdrop.style, {
    position:   'fixed',
    inset:      '0',
    zIndex:     '500',
    background: 'rgba(0,0,0,0.6)',
  });

  // Modal
  const modal = document.createElement('div');
  Object.assign(modal.style, {
    position:      'fixed',
    top:           '50%',
    left:          '50%',
    transform:     'translate(-50%, -50%)',
    width:         'min(560px, 92vw)',
    maxHeight:     '80vh',
    background:    '#222222',
    border:        '1px solid #333333',
    borderRadius:  '6px',
    zIndex:        '501',
    display:       'flex',
    flexDirection: 'column',
    fontFamily:    "'JetBrains Mono', monospace",
    boxShadow:     '0 8px 32px rgba(0,0,0,0.6)',
    overflow:      'hidden',
  });

  // Modal header
  const mHeader = document.createElement('div');
  Object.assign(mHeader.style, {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    padding:        '10px 16px',
    background:     '#2a2a2a',
    borderBottom:   '1px solid #2e2e2e',
    flexShrink:     '0',
  });

  const mTitle = document.createElement('span');
  mTitle.textContent = 'Edit Entry';
  Object.assign(mTitle.style, { fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#777777' });

  const mClose = document.createElement('span');
  mClose.textContent = '✕';
  Object.assign(mClose.style, { fontSize: '14px', color: '#777777', cursor: 'pointer', padding: '2px 4px' });
  mClose.addEventListener('click', cleanup);

  mHeader.append(mTitle, mClose);

  // Modal body
  const mBody = document.createElement('div');
  Object.assign(mBody.style, { padding: '16px', overflowY: 'auto', flex: '1', display: 'flex', flexDirection: 'column', gap: '10px' });

  // Title field
  const titleInput = document.createElement('input');
  titleInput.type        = 'text';
  titleInput.value       = entry.title || '';
  titleInput.placeholder = 'Title (optional)';
  titleInput.maxLength   = 80;
  Object.assign(titleInput.style, {
    width:         '100%',
    background:    '#2a2a2a',
    border:        '1px solid #333333',
    borderRadius:  '4px',
    color:         '#e8e8e8',
    fontFamily:    "'JetBrains Mono', monospace",
    fontSize:      '16px',
    padding:       '9px 12px',
    outline:       'none',
  });

  // Body textarea
  const bodyTA = document.createElement('textarea');
  bodyTA.value       = entry.body || '';
  bodyTA.placeholder = 'Entry text...';
  Object.assign(bodyTA.style, {
    width:       '100%',
    minHeight:   '160px',
    background:  '#2a2a2a',
    border:      '1px solid #333333',
    borderRadius:'4px',
    color:       '#e8e8e8',
    fontFamily:  "'JetBrains Mono', monospace",
    fontSize:    '16px',
    padding:     '12px',
    outline:     'none',
    resize:      'vertical',
    lineHeight:  '1.75',
  });

  mBody.append(titleInput, bodyTA);

  // Button row
  const btnRow = document.createElement('div');
  Object.assign(btnRow.style, {
    display:        'flex',
    justifyContent: 'space-between',
    alignItems:     'center',
    padding:        '12px 16px',
    borderTop:      '1px solid #2e2e2e',
    background:     '#2a2a2a',
    flexShrink:     '0',
    gap:            '10px',
  });

  const makeBtn = (label, color, bgColor) => {
    const btn = document.createElement('button');
    btn.textContent = label;
    Object.assign(btn.style, {
      padding:       '8px 20px',
      fontFamily:    "'JetBrains Mono', monospace",
      fontSize:      '11px',
      fontWeight:    '500',
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      cursor:        'pointer',
      borderRadius:  '4px',
      border:        `1px solid ${color}`,
      background:    bgColor,
      color:         color,
      transition:    'opacity 0.15s',
    });
    return btn;
  };

  const deleteBtn = makeBtn('Delete', '#e05c5c', 'rgba(224,92,92,0.08)');
  const cancelBtn = makeBtn('Cancel', '#777777', 'transparent');
  const saveBtn   = makeBtn('Save',   '#c9a96e', 'rgba(201,169,110,0.12)');

  // Delete
  deleteBtn.addEventListener('click', async () => {
    const ok = await UI.confirm('Delete this entry? This cannot be undone.');
    if (!ok) return;
    Storage.remove(APP, KEY, entry.id);
    _allEntries = [...Storage.load(APP, KEY)].reverse();
    updateCounts();
    renderEntries();
    Sync.push(APP, KEY).then(r => _updateSyncPill(r ? 'ok' : 'fail'));
    cleanup();
  });

  // Cancel
  cancelBtn.addEventListener('click', async () => {
    const changed = bodyTA.value.trim() !== (entry.body || '') ||
                    titleInput.value.trim() !== (entry.title || '');
    if (changed) {
      const ok = await UI.confirm('Discard changes?');
      if (!ok) return;
    }
    cleanup();
  });

  // Save
  saveBtn.addEventListener('click', async () => {
    const newBody  = bodyTA.value.trim();
    const newTitle = titleInput.value.trim();
    if (!newBody) { UI.toast('Entry cannot be empty', 'error'); return; }
    const ok = await UI.confirm('Save changes to this entry?');
    if (!ok) return;
    Storage.update(APP, KEY, { id: entry.id, body: newBody, title: newTitle });
    _allEntries = [...Storage.load(APP, KEY)].reverse();
    updateCounts();
    renderEntries();
    Sync.push(APP, KEY).then(r => _updateSyncPill(r ? 'ok' : 'fail'));
    UI.toast('Entry updated');
    cleanup();
  });

  btnRow.append(deleteBtn, cancelBtn, saveBtn);

  modal.append(mHeader, mBody, btnRow);
  document.body.append(backdrop, modal);

  // Focus textarea
  setTimeout(() => bodyTA.focus(), 50);

  function cleanup() {
    backdrop.remove();
    modal.remove();
  }

  // Backdrop tap = cancel (no confirm if unchanged)
  backdrop.addEventListener('click', async () => {
    const changed = bodyTA.value.trim() !== (entry.body || '') ||
                    titleInput.value.trim() !== (entry.title || '');
    if (changed) {
      const ok = await UI.confirm('Discard changes?');
      if (!ok) return;
    }
    cleanup();
  });
}

// ── Remove Followup ───────────────────────────────────────────────
function removeFollowup(id) {
  Storage.update(APP, KEY, { id, followup: false });
  _allEntries = [...Storage.load(APP, KEY)].reverse();
  updateCounts();
  renderEntries();
  Sync.push(APP, KEY).then(ok => _updateSyncPill(ok ? 'ok' : 'fail'));
}

// ── Start ─────────────────────────────────────────────────────────
init();
