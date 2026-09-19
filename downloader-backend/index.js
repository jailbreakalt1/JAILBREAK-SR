'use strict';

// Entry point for hosts whose egg invokes `node index.js` with default
// startup variables (e.g. Pterodactyl git eggs where variable saves don't
// persist). Delegates to the real boot script.
require('./scripts/start.js');