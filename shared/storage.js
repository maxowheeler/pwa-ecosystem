// storage.js — Shared local storage module for the PWA ecosystem
// All apps read/write through here. Never call localStorage directly in app code.
// Uses namespaced keys (e.g. "journal:entries") to avoid collisions between apps.

import CONFIG from './config.js';

export const VERSION = '1.0.0';

const log = (...args) => CONFIG.FEATURES.debugLogging && console.log('[storage]', ...args);

// --- Internal Helpers ---

function makeKey(app, key) {
  return `${app}:${key}`;
}

// --- Core API ---

/**
 * Save a full list of records for an app.
 * Overwrites whatever was there before.
 *
 * Usage: Storage.save('journal', 'entries', [ ...entries ]);
 */
function save(app, key, data) {
  const storageKey = makeKey(app, key);
  try {
    localStorage.setItem(storageKey, JSON.stringify(data));
    log(`saved ${storageKey}`, data);
  } catch (e) {
    console.error('[storage] save failed:', storageKey, e);
  }
}

/**
 * Load a list of records for an app.
 * Returns an empty array if nothing is stored yet.
 *
 * Usage: const entries = Storage.load('journal', 'entries');
 */
function load(app, key) {
  const storageKey = makeKey(app, key);
  try {
    const raw = localStorage.getItem(storageKey);
    const data = raw ? JSON.parse(raw) : [];
    log(`loaded ${storageKey}`, data);
    return data;
  } catch (e) {
    console.error('[storage] load failed:', storageKey, e);
    return [];
  }
}

/**
 * Append a single record to an existing list.
 * Generates a simple timestamp-based ID if the record doesn't have one.
 *
 * Usage: Storage.append('journal', 'entries', { text: '...' });
 */
function append(app, key, record) {
  const existing = load(app, key);
  const newRecord = {
    id: record.id ?? Date.now(),
    createdAt: record.createdAt ?? new Date().toISOString(),
    ...record,
  };
  existing.push(newRecord);
  save(app, key, existing);
  return newRecord; // returned so sync.js or app code can use it
}

/**
 * Remove a single record by its id.
 *
 * Usage: Storage.remove('journal', 'entries', id);
 */
function remove(app, key, id) {
  const existing = load(app, key);
  const updated = existing.filter(r => r.id !== id);
  save(app, key, updated);
  log(`removed id ${id} from ${makeKey(app, key)}`);
}

/**
 * Replace a single record by its id.
 * Use this for edits.
 *
 * Usage: Storage.update('journal', 'entries', { id: 123, text: '...' });
 */
function update(app, key, updatedRecord) {
  const existing = load(app, key);
  const index = existing.findIndex(r => r.id === updatedRecord.id);
  if (index === -1) {
    console.warn('[storage] update: record not found', updatedRecord.id);
    return;
  }
  existing[index] = { ...existing[index], ...updatedRecord };
  save(app, key, existing);
  log(`updated id ${updatedRecord.id} in ${makeKey(app, key)}`);
}

/**
 * Wipe all records for an app+key.
 * Useful for a full re-sync from the server.
 *
 * Usage: Storage.clear('journal', 'entries');
 */
function clear(app, key) {
  const storageKey = makeKey(app, key);
  localStorage.removeItem(storageKey);
  log(`cleared ${storageKey}`);
}

// --- Export ---

const Storage = { save, load, append, remove, update, clear };
export default Storage;
