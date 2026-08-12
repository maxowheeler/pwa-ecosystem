// config.js — Central configuration for the PWA ecosystem
// Edit this file when: IP changes, adding new apps, toggling features,
// or deploying a new theme.css version.
// All other modules import from here. Never hardcode these values elsewhere.

export const VERSION = '1.2.0';

// theme.css version — update this whenever theme.css is deployed.
// This lives here because CSS files cannot export JS constants.
export const THEME_VERSION = '1.2.0';

const CONFIG = {

  // --- Server ---
  // Update PI_IP if your router assigns a new address.
  // Consider setting a DHCP reservation on your router to keep this stable.
  PI_IP: '192.168.1.216',
  PORT: 8443,

  // Derived base URL — other modules use this, not PI_IP directly.
  get BASE_URL() {
  return `https://${this.PI_IP}:${this.PORT}`;
  },

  // --- API Endpoints ---
  // Each app's sync endpoint on the Pi. Maps to files in /server/.
  ENDPOINTS: {
    journal: '/server/sync.php?app=journal',
    bike:    '/server/sync.php?app=bike',
  },

  // --- Feature Flags ---
  // Flip these to disable features without deleting code.
  FEATURES: {
    syncEnabled: true,   // Set false to run fully offline (e.g. during Pi maintenance)
    debugLogging: false, // Set true to see sync/storage activity in the browser console
  },

  // --- Sync Behavior ---
  SYNC: {
    timeoutMs: 5000,     // How long to wait before treating a sync attempt as failed
    retryDelayMs: 30000, // How long to wait before retrying a failed sync
  },

};

export default CONFIG;
