// sync.js — Best-effort sync module for the PWA ecosystem
// Handles push (iPhone → Pi) and pull (Pi → iPhone).
// Apps never call fetch() directly — they use Sync.push() and Sync.pull().
// All failures are silent. User workflow is never interrupted.
//
// Both push() and pull() return a boolean:
//   true  = operation succeeded
//   false = operation failed or was skipped
// Apps can use this to update sync status UI.

import CONFIG from './config.js';
import Storage from './storage.js';

export const VERSION = '1.2.0';

const log = (...args) => CONFIG.FEATURES.debugLogging && console.log('[sync]', ...args);

// --- Internal Helpers ---

function endpoint(app) {
  return CONFIG.BASE_URL + CONFIG.ENDPOINTS[app];
}

function isEnabled() {
  return CONFIG.FEATURES.syncEnabled;
}

// --- Sync Log ---
// Stores the last 10 actual network attempts per app in localStorage.
// Key: {app}:syncLog — array of { timestamp, direction, success, error }
// Never stored through storage.js — this is sync infrastructure, not app data.

const MAX_LOG = 10;

function writeLog(app, entry) {
  const key      = `${app}:syncLog`;
  const raw      = localStorage.getItem(key);
  const existing = raw ? JSON.parse(raw) : [];
  existing.push(entry);
  if (existing.length > MAX_LOG) existing.splice(0, existing.length - MAX_LOG);
  localStorage.setItem(key, JSON.stringify(existing));
}

/**
 * Read the sync log for an app.
 * Returns an array of up to 10 entries, oldest first.
 * Each entry: { timestamp, direction: 'push'|'pull', success: bool, error: string|null }
 *
 * Usage: const history = Sync.readLog('journal');
 */
function readLog(app) {
  const raw = localStorage.getItem(`${app}:syncLog`);
  return raw ? JSON.parse(raw) : [];
}

// --- Push (iPhone → Pi) ---

/**
 * Push all local records for an app to the Pi.
 * Called after a record is saved locally.
 * Fails silently — local data is always the source of truth.
 * Returns true if push succeeded, false if disabled or failed.
 *
 * Usage: const ok = await Sync.push('journal', 'entries');
 */
async function push(app, key) {
  if (!isEnabled()) { log('sync disabled, skipping push'); return false; }

  const data = Storage.load(app, key);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.SYNC.timeoutMs);

    const response = await fetch(endpoint(app), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, data }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    log(`push ok — ${app}:${key}`, data);
    writeLog(app, { timestamp: new Date().toISOString(), direction: 'push', success: true, error: null });
    return true;

  } catch (e) {
    log(`push failed — ${app}:${key}`, e.message);
    writeLog(app, { timestamp: new Date().toISOString(), direction: 'push', success: false, error: e.message });
    return false;
  }
}

// --- Pull (Pi → iPhone) ---

/**
 * Pull records from the Pi and overwrite local storage.
 * Called on app load. If pull fails, local data is left untouched.
 * If the Pi has no data yet, local data is also left untouched.
 * Returns true if data was pulled, false if skipped or failed.
 *
 * Usage: const ok = await Sync.pull('journal', 'entries');
 */
async function pull(app, key) {
  if (!isEnabled()) { log('sync disabled, skipping pull'); return false; }

  // Only pull if local storage is empty (e.g. fresh install or cleared storage).
  // This prevents the Pi from overwriting newer local data on the iPhone.
  const existing = Storage.load(app, key);
  if (existing.length > 0) { log(`pull skipped — local data exists for ${app}:${key}`); return false; }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.SYNC.timeoutMs);

    const url = `${endpoint(app)}&key=${encodeURIComponent(key)}`;
    const response = await fetch(url, { signal: controller.signal });

    clearTimeout(timeout);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const json = await response.json();

    // Only overwrite local data if the Pi actually returned records.
    // An empty response means the Pi has nothing yet — don't wipe local data.
    if (Array.isArray(json.data) && json.data.length > 0) {
      Storage.save(app, key, json.data);
      log(`pull ok — ${app}:${key}`, json.data);
      writeLog(app, { timestamp: new Date().toISOString(), direction: 'pull', success: true, error: null });
      return true;
    } else {
      log(`pull skipped (no data on Pi) — ${app}:${key}`);
      return false;
    }

  } catch (e) {
    // Fail silently. Local data is untouched.
    log(`pull failed — ${app}:${key}`, e.message);
    writeLog(app, { timestamp: new Date().toISOString(), direction: 'pull', success: false, error: e.message });
    return false;
  }
}

// --- Force Pull (Pi → iPhone, bypasses local-data guard) ---

/**
 * Pull records from the Pi and overwrite local storage unconditionally.
 * Used only by the manual Pull button in the sync history modal.
 * WARNING: this overwrites all local data for the app+key.
 * Returns true if data was pulled, false if failed.
 *
 * Usage: const ok = await Sync.forcePull('journal', 'entries');
 */
async function forcePull(app, key) {
  if (!isEnabled()) { log('sync disabled, skipping forcePull'); return false; }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.SYNC.timeoutMs);

    const url = `${endpoint(app)}&key=${encodeURIComponent(key)}`;
    const response = await fetch(url, { signal: controller.signal });

    clearTimeout(timeout);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const json = await response.json();

    if (Array.isArray(json.data) && json.data.length > 0) {
      Storage.save(app, key, json.data);
      log(`forcePull ok — ${app}:${key}`, json.data);
      writeLog(app, { timestamp: new Date().toISOString(), direction: 'pull', success: true, error: null });
      return true;
    } else {
      log(`forcePull — no data on Pi for ${app}:${key}`);
      writeLog(app, { timestamp: new Date().toISOString(), direction: 'pull', success: false, error: 'No data on Pi' });
      return false;
    }

  } catch (e) {
    log(`forcePull failed — ${app}:${key}`, e.message);
    writeLog(app, { timestamp: new Date().toISOString(), direction: 'pull', success: false, error: e.message });
    return false;
  }
}

// --- Export ---

const Sync = { push, pull, forcePull, readLog };
export default Sync;
