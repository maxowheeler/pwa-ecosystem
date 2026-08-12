// ui.js — Shared UI utilities for the PWA ecosystem
// Import what you need: import UI from '../shared/ui.js';
// Never duplicate these in app code — add new helpers here instead.

export const VERSION = '1.4.0';

// ── Toast Notifications ───────────────────────────────────────────
// Centered, larger toast for clear feedback on any screen size.
//
// Usage: UI.toast('Entry saved');
//        UI.toast('Sync failed', 'error');

function toast(message, type = 'default', duration = 2500) {
  const isError = type === 'error';

  const el = document.createElement('div');
  el.textContent = message;
  Object.assign(el.style, {
    position:      'fixed',
    top:           '50%',
    left:          '50%',
    transform:     'translate(-50%, -50%)',
    zIndex:        '9999',
    padding:       '16px 28px',
    borderRadius:  '6px',
    fontFamily:    "'JetBrains Mono', monospace",
    fontSize:      '13px',
    fontWeight:    '500',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color:         isError ? '#f97316' : '#c9a96e',
    background:    isError ? 'rgba(20,10,0,0.92)' : 'rgba(20,16,8,0.92)',
    border:        isError ? '1px solid rgba(249,115,22,0.5)' : '1px solid rgba(201,169,110,0.5)',
    boxShadow:     '0 8px 32px rgba(0,0,0,0.6)',
    opacity:       '0',
    transition:    'opacity 0.2s',
    pointerEvents: 'none',
    whiteSpace:    'nowrap',
  });

  document.body.appendChild(el);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => { el.style.opacity = '1'; });
  });

  setTimeout(() => {
    el.style.opacity = '0';
    el.addEventListener('transitionend', () => el.remove(), { once: true });
  }, duration);
}

// ── Confirm Dialog ────────────────────────────────────────────────
// Lightweight confirm that matches the terminal aesthetic.
// Returns a Promise<boolean> — true if confirmed, false if cancelled.
// zBase is configurable so callers inside modals can layer correctly.
// Default zBase 500 works for standalone use; pass 620 when inside
// the sync modal (which sits at z-index 601) to render on top.
//
// Usage: const ok = await UI.confirm('Delete this entry?');
//        const ok = await UI.confirm('Are you sure?', 620);

function confirm(message, zBase = 500) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    Object.assign(backdrop.style, {
      position:   'fixed',
      inset:      '0',
      zIndex:     String(zBase),
      background: 'rgba(0,0,0,0.5)',
    });

    const dialog = document.createElement('div');
    Object.assign(dialog.style, {
      position:     'fixed',
      top:          '50%',
      left:         '50%',
      transform:    'translate(-50%, -50%)',
      background:   '#222222',
      border:       '1px solid #333333',
      borderRadius: '6px',
      padding:      '24px',
      zIndex:       String(zBase + 1),
      width:        'min(320px, 88vw)',
      fontFamily:   "'JetBrains Mono', monospace",
    });

    const msg = document.createElement('p');
    msg.textContent = message;
    Object.assign(msg.style, {
      fontSize:      '13px',
      lineHeight:    '1.6',
      color:         '#e8e8e8',
      marginBottom:  '20px',
      letterSpacing: '0.03em',
    });

    const row = document.createElement('div');
    Object.assign(row.style, {
      display:        'flex',
      justifyContent: 'flex-end',
      gap:            '10px',
    });

    const makeBtn = (label, primary) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      Object.assign(btn.style, {
        padding:       '7px 18px',
        fontFamily:    "'JetBrains Mono', monospace",
        fontSize:      '11px',
        fontWeight:    '500',
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        cursor:        'pointer',
        borderRadius:  '4px',
        border:        primary ? '1px solid rgba(201,169,110,0.3)' : '1px solid #333333',
        background:    primary ? 'rgba(201,169,110,0.12)' : 'transparent',
        color:         primary ? '#c9a96e' : '#777777',
      });
      return btn;
    };

    const cancelBtn  = makeBtn('Cancel', false);
    const confirmBtn = makeBtn('Confirm', true);

    const cleanup = () => { backdrop.remove(); dialog.remove(); };

    cancelBtn.addEventListener('click',  () => { cleanup(); resolve(false); });
    confirmBtn.addEventListener('click', () => { cleanup(); resolve(true); });
    backdrop.addEventListener('click',   () => { cleanup(); resolve(false); });

    row.append(cancelBtn, confirmBtn);
    dialog.append(msg, row);
    document.body.append(backdrop, dialog);
  });
}

// ── No Settings Modal ─────────────────────────────────────────────
// Shows a simple "No settings for this page" modal.
// Used when a page has a gear icon but no settings to show.
//
// Usage: UI.noSettings();

function noSettings() {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    Object.assign(backdrop.style, {
      position:   'fixed',
      inset:      '0',
      zIndex:     '500',
      background: 'rgba(0,0,0,0.5)',
    });

    const dialog = document.createElement('div');
    Object.assign(dialog.style, {
      position:     'fixed',
      top:          '50%',
      left:         '50%',
      transform:    'translate(-50%, -50%)',
      background:   '#222222',
      border:       '1px solid #333333',
      borderRadius: '6px',
      padding:      '24px',
      zIndex:       '501',
      width:        'min(280px, 88vw)',
      fontFamily:   "'JetBrains Mono', monospace",
      textAlign:    'center',
    });

    const msg = document.createElement('p');
    msg.textContent = 'No settings for this page.';
    Object.assign(msg.style, {
      fontSize:      '12px',
      lineHeight:    '1.6',
      color:         '#777777',
      marginBottom:  '20px',
      letterSpacing: '0.05em',
      textTransform: 'uppercase',
    });

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    Object.assign(closeBtn.style, {
      padding:       '7px 24px',
      fontFamily:    "'JetBrains Mono', monospace",
      fontSize:      '11px',
      fontWeight:    '500',
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      cursor:        'pointer',
      borderRadius:  '4px',
      border:        '1px solid #333333',
      background:    'transparent',
      color:         '#777777',
    });

    const cleanup = () => { backdrop.remove(); dialog.remove(); resolve(); };
    closeBtn.addEventListener('click', cleanup);
    backdrop.addEventListener('click', cleanup);

    dialog.append(msg, closeBtn);
    document.body.append(backdrop, dialog);
  });
}

// ── Auto-growing Textarea ─────────────────────────────────────────
// Usage: UI.autoGrow(document.getElementById('entry-textarea'));

function autoGrow(textarea) {
  if (!textarea) return;
  const grow = () => {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
  };
  textarea.addEventListener('input', grow);
  grow();
}

// ── Header Date ───────────────────────────────────────────────────
// Writes a formatted date string into an element.
// Usage: UI.setHeaderDate(document.getElementById('header-date'));

function setHeaderDate(el) {
  if (!el) return;
  el.textContent = new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    day:     '2-digit',
    month:   'short',
    year:    'numeric',
  });
}

// ── Foam Popup ────────────────────────────────────────────────────
// Shows a random entry from a provided array in a rainbow modal.
// Entries should be objects with: { time, body, title? }
//
// Usage: UI.showFoamPopup(entries);

let _foamBackdrop = null;
let _foamModal    = null;

function showFoamPopup(entries) {
  if (!entries || entries.length === 0) return;

  const pick = entries[Math.floor(Math.random() * entries.length)];

  if (!_foamBackdrop) {
    _foamBackdrop = document.createElement('div');
    _foamBackdrop.className = 'backdrop-dim';
    _foamBackdrop.addEventListener('click', closeFoamPopup);
    document.body.appendChild(_foamBackdrop);
  }

  if (!_foamModal) {
    _foamModal = document.createElement('div');
    _foamModal.innerHTML = `
      <div class="foam-modal-inner">
        <div class="foam-modal-header foam-bg">
          <div class="foam-modal-header-left">
            <span class="foam-modal-label">✦ Random Foam</span>
            <span class="foam-modal-timestamp"></span>
            <span class="foam-modal-title"></span>
          </div>
          <span class="foam-modal-close">✕</span>
        </div>
        <div class="foam-modal-body"></div>
      </div>
    `;
    Object.assign(_foamModal.style, {
      position:     'fixed',
      top:          '50%',
      left:         '50%',
      transform:    'translate(-50%, -54%)',
      width:        'min(560px, 90vw)',
      zIndex:       '200',
      borderRadius: '8px',
      padding:      '3px',
      display:      'none',
    });
    _foamModal.classList.add('foam-border');

    const inner = _foamModal.querySelector('.foam-modal-inner');
    Object.assign(inner.style, { background: '#1a1a1a', borderRadius: '6px', overflow: 'hidden' });

    const header = _foamModal.querySelector('.foam-modal-header');
    Object.assign(header.style, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px' });

    const headerLeft = _foamModal.querySelector('.foam-modal-header-left');
    Object.assign(headerLeft.style, { display: 'flex', alignItems: 'center', gap: '10px' });

    const label = _foamModal.querySelector('.foam-modal-label');
    Object.assign(label.style, { fontFamily: "'JetBrains Mono', monospace", fontSize: '10px', fontWeight: '500', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#111' });

    const timestamp = _foamModal.querySelector('.foam-modal-timestamp');
    Object.assign(timestamp.style, { fontSize: '10px', color: 'rgba(0,0,0,0.45)', letterSpacing: '0.05em' });

    const title = _foamModal.querySelector('.foam-modal-title');
    Object.assign(title.style, { fontSize: '10px', color: 'rgba(0,0,0,0.55)', letterSpacing: '0.05em' });

    const close = _foamModal.querySelector('.foam-modal-close');
    Object.assign(close.style, { fontSize: '15px', color: 'rgba(0,0,0,0.4)', cursor: 'pointer', padding: '2px 4px', flexShrink: '0' });
    close.addEventListener('click', closeFoamPopup);

    const body = _foamModal.querySelector('.foam-modal-body');
    Object.assign(body.style, { padding: '20px', fontFamily: "'JetBrains Mono', monospace", fontSize: '13.5px', lineHeight: '1.75', color: '#e8e8e8', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '60vh', overflowY: 'auto' });

    document.body.appendChild(_foamModal);
  }

  _foamModal.querySelector('.foam-modal-timestamp').textContent = pick.time || '';
  _foamModal.querySelector('.foam-modal-title').textContent     = pick.title ? '· ' + pick.title : '';
  _foamModal.querySelector('.foam-modal-body').textContent      = pick.body || '';

  _foamModal.style.display = 'block';
  _foamBackdrop.classList.add('visible');
}

function closeFoamPopup() {
  if (_foamModal)    _foamModal.style.display = 'none';
  if (_foamBackdrop) _foamBackdrop.classList.remove('visible');
}

// ── Devlog Panel ──────────────────────────────────────────────────
// Shows shared module versions + app version history.
// Triggered by tapping the app name in the header.
//
// Usage: UI.showDevlog(VERSIONS, APP_HISTORY, 'Journal');

let _devlogBackdrop = null;
let _devlogModal    = null;

function showDevlog(versions, history = [], appName = '') {
  if (!_devlogBackdrop) {
    _devlogBackdrop = document.createElement('div');
    Object.assign(_devlogBackdrop.style, {
      position: 'fixed', inset: '0', zIndex: '500', background: 'rgba(0,0,0,0.5)',
    });
    _devlogBackdrop.addEventListener('click', closeDevlog);
    document.body.appendChild(_devlogBackdrop);
  }

  if (!_devlogModal) {
    _devlogModal = document.createElement('div');
    Object.assign(_devlogModal.style, {
      position:      'fixed',
      top:           '50%',
      left:          '50%',
      transform:     'translate(-50%, -50%)',
      width:         'min(380px, 92vw)',
      maxHeight:     '80vh',
      background:    '#222222',
      border:        '1px solid #333333',
      borderRadius:  '6px',
      zIndex:        '501',
      overflow:      'hidden',
      display:       'flex',
      flexDirection: 'column',
      fontFamily:    "'JetBrains Mono', monospace",
      boxShadow:     '0 8px 32px rgba(0,0,0,0.4)',
    });
    document.body.appendChild(_devlogModal);
  }

  _devlogModal.innerHTML = '';

  const header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 14px', background: '#2a2a2a', borderBottom: '1px solid #2e2e2e', flexShrink: '0',
  });

  const titleEl = document.createElement('span');
  titleEl.textContent = appName ? `${appName} — Devlog` : 'Devlog';
  Object.assign(titleEl.style, { fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#777777' });

  const closeBtn = document.createElement('span');
  closeBtn.textContent = '✕';
  Object.assign(closeBtn.style, { fontSize: '14px', color: '#777777', cursor: 'pointer', padding: '2px 4px' });
  closeBtn.addEventListener('click', closeDevlog);
  header.append(titleEl, closeBtn);

  const body = document.createElement('div');
  Object.assign(body.style, { overflowY: 'auto', flex: '1' });

  const secShared = _devlogSection('Shared Modules');
  [
    { label: 'config.js',  version: versions.config  },
    { label: 'storage.js', version: versions.storage },
    { label: 'sync.js',    version: versions.sync    },
    { label: 'ui.js',      version: versions.ui      },
    { label: 'theme.css',  version: versions.theme   },
  ].forEach(({ label, version }) => secShared.appendChild(_devlogVersionRow(label, version)));
  body.appendChild(secShared);

  if (history && history.length > 0) {
    const secApp = _devlogSection('App History');
    history.forEach(v => {
      const entry = document.createElement('div');
      Object.assign(entry.style, { padding: '10px 14px', borderBottom: '1px solid #2e2e2e' });

      const entryHeader = document.createElement('div');
      Object.assign(entryHeader.style, { display: 'flex', justifyContent: 'space-between', marginBottom: '6px' });

      const num = document.createElement('span');
      num.textContent = v.number;
      Object.assign(num.style, { fontSize: '12px', color: '#c9a96e', letterSpacing: '0.08em' });

      const date = document.createElement('span');
      date.textContent = v.date || '';
      Object.assign(date.style, { fontSize: '10px', color: '#777777' });

      entryHeader.append(num, date);

      const notesList = document.createElement('ul');
      Object.assign(notesList.style, { listStyle: 'none', padding: '0' });
      (v.notes || []).forEach(note => {
        const li = document.createElement('li');
        Object.assign(li.style, { fontSize: '11px', color: '#777777', lineHeight: '1.6', paddingLeft: '12px', position: 'relative' });
        const dash = document.createElement('span');
        dash.textContent = '—';
        Object.assign(dash.style, { position: 'absolute', left: '0', color: '#444' });
        li.prepend(dash);
        li.append(document.createTextNode(note));
        notesList.appendChild(li);
      });

      entry.append(entryHeader, notesList);
      secApp.appendChild(entry);
    });
    body.appendChild(secApp);
  }

  _devlogModal.append(header, body);
  _devlogModal.style.display    = 'flex';
  _devlogBackdrop.style.display = 'block';
}

function _devlogSection(label) {
  const wrap = document.createElement('div');
  const lbl  = document.createElement('div');
  lbl.textContent = label;
  Object.assign(lbl.style, {
    fontSize: '9px', letterSpacing: '0.14em', textTransform: 'uppercase',
    color: '#555', padding: '8px 14px 4px', borderBottom: '1px solid #2e2e2e',
  });
  wrap.appendChild(lbl);
  return wrap;
}

function _devlogVersionRow(label, version) {
  const row = document.createElement('div');
  Object.assign(row.style, {
    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
    padding: '7px 14px', borderBottom: '1px solid #2e2e2e',
  });
  const name = document.createElement('span');
  name.textContent = label;
  Object.assign(name.style, { fontSize: '12px', color: '#e8e8e8', letterSpacing: '0.04em' });
  const ver = document.createElement('span');
  ver.textContent = version ?? 'unknown';
  Object.assign(ver.style, { fontSize: '11px', color: version ? '#c9a96e' : '#555', letterSpacing: '0.08em' });
  row.append(name, ver);
  return row;
}

function closeDevlog() {
  if (_devlogModal)    _devlogModal.style.display    = 'none';
  if (_devlogBackdrop) _devlogBackdrop.style.display = 'none';
}

// ── App Update Helper ─────────────────────────────────────────────
// Unregisters all service workers, clears all SW asset caches,
// then reloads the page to fetch freshly deployed files.
// Does NOT touch localStorage — app data, settings, and sync log
// are completely unaffected.

async function _clearAndUpdate() {
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map(r => r.unregister()));
  }

  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
  }

  window.location.reload(true);
}

// ── Sync History Modal ────────────────────────────────────────────
// Shows the last 10 sync attempts for an app, with Push, Pull, and
// App Update buttons. Opened by tapping the sync pill.
//
// Requires Sync to be passed in — avoids a circular import between
// ui.js and sync.js by receiving it as an argument at call time.

const ERROR_HINTS = {
  'AbortError':      'The request timed out — Pi may be slow or unreachable.',
  'Failed to fetch': 'Could not reach the Pi. You may be off the home network.',
  'NetworkError':    'Network error — no connection to the Pi.',
  'HTTP 401':        'Unauthorised — server rejected the request.',
  'HTTP 403':        'Forbidden — server rejected the request.',
  'HTTP 404':        'Endpoint not found on the Pi — check sync.php is deployed.',
  'HTTP 500':        'Server error on the Pi — check Apache/PHP logs.',
  'HTTP 502':        'Bad gateway — Apache may be down.',
  'HTTP 503':        'Pi server is unavailable — it may be overloaded or restarting.',
  'No data on Pi':   'The Pi returned an empty dataset — nothing to pull.',
};

function _friendlyError(raw) {
  if (!raw) return null;
  for (const [key, hint] of Object.entries(ERROR_HINTS)) {
    if (raw.includes(key)) return hint;
  }
  return 'An unexpected error occurred. Check the Pi and your network.';
}

function _formatTimestamp(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function showSyncModal(app, key, Sync, updatePill) {
  const backdrop = document.createElement('div');
  Object.assign(backdrop.style, {
    position: 'fixed', inset: '0', zIndex: '600', background: 'rgba(0,0,0,0.6)',
  });

  const modal = document.createElement('div');
  Object.assign(modal.style, {
    position:      'fixed',
    top:           '50%',
    left:          '50%',
    transform:     'translate(-50%, -50%)',
    width:         'min(420px, 92vw)',
    maxHeight:     '82vh',
    background:    '#222222',
    border:        '1px solid #333333',
    borderRadius:  '6px',
    zIndex:        '601',
    display:       'flex',
    flexDirection: 'column',
    fontFamily:    "'JetBrains Mono', monospace",
    boxShadow:     '0 8px 32px rgba(0,0,0,0.6)',
    overflow:      'hidden',
  });

  // Header
  const header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 14px', background: '#2a2a2a',
    borderBottom: '1px solid #2e2e2e', flexShrink: '0',
  });

  const titleEl = document.createElement('span');
  titleEl.textContent = `Sync — ${app}`;
  Object.assign(titleEl.style, { fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#777777' });

  const closeBtn = document.createElement('span');
  closeBtn.textContent = '✕';
  Object.assign(closeBtn.style, { fontSize: '14px', color: '#777777', cursor: 'pointer', padding: '2px 4px' });
  closeBtn.addEventListener('click', cleanup);
  backdrop.addEventListener('click', cleanup);
  header.append(titleEl, closeBtn);

  // History list
  const historyWrap = document.createElement('div');
  Object.assign(historyWrap.style, { overflowY: 'auto', flex: '1' });

  function renderHistory() {
    historyWrap.innerHTML = '';

    const secLabel = document.createElement('div');
    secLabel.textContent = 'Recent Attempts';
    Object.assign(secLabel.style, {
      fontSize: '9px', letterSpacing: '0.14em', textTransform: 'uppercase',
      color: '#555', padding: '8px 14px 4px', borderBottom: '1px solid #2e2e2e',
    });
    historyWrap.appendChild(secLabel);

    const log = Sync.readLog(app);

    if (log.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'No sync attempts recorded yet.';
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
      Object.assign(topLine.style, {
        display: 'flex', alignItems: 'center', gap: '8px',
        marginBottom: entry.error ? '5px' : '0',
      });

      const badge = document.createElement('span');
      const isPush = entry.direction === 'push';
      badge.textContent = isPush ? 'Push ↑' : 'Pull ↓';
      Object.assign(badge.style, {
        fontSize: '9px', fontWeight: '500', letterSpacing: '0.1em',
        textTransform: 'uppercase', padding: '2px 6px', borderRadius: '3px', flexShrink: '0',
        background: isPush ? 'rgba(201,169,110,0.1)'           : 'rgba(72,219,251,0.1)',
        color:      isPush ? '#c9a96e'                          : '#48dbfb',
        border:     isPush ? '1px solid rgba(201,169,110,0.25)' : '1px solid rgba(72,219,251,0.25)',
      });

      const ts = document.createElement('span');
      ts.textContent = _formatTimestamp(entry.timestamp);
      Object.assign(ts.style, { fontSize: '11px', color: '#777777', flex: '1' });

      const status = document.createElement('span');
      status.textContent = entry.success ? '✓ ok' : '✗ failed';
      Object.assign(status.style, {
        fontSize: '11px', fontWeight: '500', flexShrink: '0',
        color: entry.success ? '#5ecf8a' : '#e05c5c',
      });

      topLine.append(badge, ts, status);
      row.appendChild(topLine);

      if (entry.error) {
        const errWrap = document.createElement('div');
        Object.assign(errWrap.style, { paddingLeft: '4px' });

        const errRaw = document.createElement('div');
        errRaw.textContent = entry.error;
        Object.assign(errRaw.style, {
          fontSize: '10px', color: '#e05c5c', letterSpacing: '0.04em',
          marginBottom: '2px', fontFamily: 'monospace',
        });

        const errHint = document.createElement('div');
        errHint.textContent = _friendlyError(entry.error) || '';
        Object.assign(errHint.style, {
          fontSize: '10px', color: '#666666', letterSpacing: '0.03em', lineHeight: '1.5',
        });

        errWrap.append(errRaw, errHint);
        row.appendChild(errWrap);
      }

      historyWrap.appendChild(row);
    });
  }

  renderHistory();

  // ── Sync action buttons (Push / Pull) ─────────────────────────
  const actionWrap = document.createElement('div');
  Object.assign(actionWrap.style, {
    display: 'flex', gap: '8px', padding: '12px 14px',
    borderTop: '1px solid #2e2e2e', background: '#2a2a2a', flexShrink: '0',
  });

  const makeActionBtn = (label, color, bgColor, borderColor) => {
    const btn = document.createElement('button');
    btn.textContent = label;
    Object.assign(btn.style, {
      flex: '1', padding: '9px 6px',
      fontFamily: "'JetBrains Mono', monospace", fontSize: '10px', fontWeight: '500',
      letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer',
      borderRadius: '4px', border: `1px solid ${borderColor}`,
      background: bgColor, color: color, transition: 'opacity 0.15s',
    });
    btn.addEventListener('mousedown', () => { btn.style.opacity = '0.7'; });
    btn.addEventListener('mouseup',   () => { btn.style.opacity = '1'; });
    return btn;
  };

  const pushBtn = makeActionBtn('Push iPhone → Pi', '#c9a96e', 'rgba(201,169,110,0.1)', 'rgba(201,169,110,0.3)');
  pushBtn.addEventListener('click', async () => {
    pushBtn.textContent = 'Pushing…';
    pushBtn.style.opacity = '0.6';
    pushBtn.disabled = true;
    const ok = await Sync.push(app, key);
    updatePill(ok ? 'ok' : 'fail');
    renderHistory();
    pushBtn.textContent = ok ? '✓ Push done' : '✗ Push failed';
    pushBtn.style.opacity = '1';
    setTimeout(() => { pushBtn.textContent = 'Push iPhone → Pi'; pushBtn.disabled = false; }, 2000);
  });

  const pullBtn = makeActionBtn('Pull iPhone ← Pi', '#48dbfb', 'rgba(72,219,251,0.08)', 'rgba(72,219,251,0.25)');
  pullBtn.addEventListener('click', async () => {
    // zBase 620 renders the confirm dialog above this modal (z-index 601)
    const ok = await confirm(
      '⚠ Pull will overwrite all local data with whatever is on the Pi.\n\nOnly use this to restore data on a fresh install or after clearing storage.\n\nAre you sure?',
      620
    );
    if (!ok) return;
    pullBtn.textContent = 'Pulling…';
    pullBtn.style.opacity = '0.6';
    pullBtn.disabled = true;
    const pulled = await Sync.forcePull(app, key);
    updatePill(pulled ? 'ok' : 'fail');
    renderHistory();
    pullBtn.textContent = pulled ? '✓ Pull done' : '✗ Pull failed';
    pullBtn.style.opacity = '1';
    setTimeout(() => { pullBtn.textContent = 'Pull iPhone ← Pi'; pullBtn.disabled = false; }, 2000);
  });

  actionWrap.append(pushBtn, pullBtn);

  // ── App Update section (visually distinct) ────────────────────
  // Separated from data sync buttons — this is app maintenance,
  // not data management. Darker bg + stronger border signals the
  // category change. Clears SW caches and reloads; data is safe.
  const updateWrap = document.createElement('div');
  Object.assign(updateWrap.style, {
    padding:    '10px 14px',
    borderTop:  '1px solid #3a3a3a',
    background: '#1e1e1e',
    flexShrink: '0',
  });

  const updateLabel = document.createElement('div');
  updateLabel.textContent = 'App Maintenance';
  Object.assign(updateLabel.style, {
    fontSize: '9px', letterSpacing: '0.14em', textTransform: 'uppercase',
    color: '#444444', marginBottom: '8px',
  });

  const updateBtn = document.createElement('button');
  updateBtn.textContent = '⟳  App Update — Clear Cache & Reload';
  Object.assign(updateBtn.style, {
    width: '100%', padding: '9px 6px',
    fontFamily: "'JetBrains Mono', monospace", fontSize: '10px', fontWeight: '500',
    letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer',
    borderRadius: '4px', border: '1px solid rgba(160,160,160,0.2)',
    background: 'rgba(160,160,160,0.06)', color: '#888888', transition: 'opacity 0.15s',
  });

  updateBtn.addEventListener('click', async () => {
    const ok = await confirm(
      'This will clear the app cache and reload the page to install any newly deployed updates.\n\nYour journal entries and app data will NOT be affected.\n\nProceed?',
      620
    );
    if (!ok) return;
    updateBtn.textContent  = 'Clearing cache…';
    updateBtn.style.opacity = '0.6';
    updateBtn.disabled = true;
    await _clearAndUpdate();
  });

  updateWrap.append(updateLabel, updateBtn);

  modal.append(header, historyWrap, actionWrap, updateWrap);
  document.body.append(backdrop, modal);

  function cleanup() {
    backdrop.remove();
    modal.remove();
  }
}

// ── Sync Pill ─────────────────────────────────────────────────────
// Creates and manages a sync status pill inside a container element.
// Returns an updater function — call it with 'ok', 'fail', or 'never'.
// Tapping the pill opens the sync history modal.
//
// Requires app, key, and Sync to wire up the modal.
//
// Usage:
//   import Sync from '../shared/sync.js';
//   const updateSync = UI.syncPill(document.getElementById('sync-row'), 'journal', 'entries', Sync);
//   updateSync('ok');

function syncPill(containerEl, app, key, Sync) {
  if (!containerEl) return () => {};

  containerEl.innerHTML = `
    <div class="sync-pill" id="ui-sync-pill" style="cursor:pointer;" title="Tap to view sync history">
      <div class="sync-dot" id="ui-sync-dot"></div>
      <span id="ui-sync-label">never synced</span>
    </div>
  `;

  const pill  = containerEl.querySelector('#ui-sync-pill');
  const dot   = containerEl.querySelector('#ui-sync-dot');
  const label = containerEl.querySelector('#ui-sync-label');

  function update(state) {
    dot.className     = 'sync-dot' + (state === 'ok' ? ' ok' : state === 'fail' ? ' fail' : '');
    label.textContent = state === 'ok'   ? 'synced just now'
                      : state === 'fail' ? 'sync failed'
                      : 'never synced';
  }

  if (app && key && Sync) {
    pill.addEventListener('click', () => {
      showSyncModal(app, key, Sync, update);
    });
  }

  return update;
}

// ── Export ────────────────────────────────────────────────────────
const UI = {
  toast,
  confirm,
  noSettings,
  autoGrow,
  setHeaderDate,
  showFoamPopup,
  closeFoamPopup,
  showDevlog,
  closeDevlog,
  syncPill,
  showSyncModal,
  // Public alias for _clearAndUpdate — unregisters service workers, clears
  // SW caches, reloads. Used by journal/bike's built-in sync modal, and by
  // office.js's own webhook-history modal (which needs to run its own
  // image-library refresh first, then hand off to this for the rest).
  refreshApp: _clearAndUpdate,
};
export default UI;
