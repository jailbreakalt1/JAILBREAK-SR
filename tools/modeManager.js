const config = require('../config');
const database = require('../database');

const MODE_FILE = 'botMode';

function getMode() {
  return database.getGlobalSetting(MODE_FILE) || config.mode || 'public';
}

function setMode(mode) {
  database.updateGlobalSetting(MODE_FILE, mode);
}

module.exports = { getMode, setMode };
