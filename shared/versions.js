// versions.js — Aggregates version constants from all shared modules.
// Import this wherever you need to display the devlog panel.
//
// Usage:
//   import VERSIONS from '../shared/versions.js';
//   UI.showDevlog(VERSIONS, APP_HISTORY, 'AppName');
//
// When adding a new shared module:
//   1. Add a VERSION constant to that module
//   2. Add a matching export line here
//
// When deploying a new theme.css:
//   1. Update THEME_VERSION in config.js — that's the only change needed.

export { VERSION as config        } from './config.js';
export { THEME_VERSION as theme   } from './config.js';
export { VERSION as storage       } from './storage.js';
export { VERSION as sync          } from './sync.js';
export { VERSION as ui            } from './ui.js';

// Re-export as a default object for convenience
import { VERSION as config        } from './config.js';
import { THEME_VERSION as theme   } from './config.js';
import { VERSION as storage       } from './storage.js';
import { VERSION as sync          } from './sync.js';
import { VERSION as ui            } from './ui.js';

const VERSIONS = { config, theme, storage, sync, ui };
export default VERSIONS;
