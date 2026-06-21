const fs = require('fs');
const path = require('path');

const DB_DIR = path.join(__dirname, 'database');
const GROUP_SETTINGS_FILE = path.join(DB_DIR, 'groupSettings.json');
const SUDO_ALLOW_FILE = path.join(DB_DIR, 'sudoAllow.json');
const GLOBAL_SETTINGS_FILE = path.join(DB_DIR, 'globalSettings.json');

function ensureDbDir() {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
}

function readJson(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (_) {}
  return fallback;
}

function writeJson(filePath, data) {
  ensureDbDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function getGroupSettings(jid) {
  const all = readJson(GROUP_SETTINGS_FILE, {});
  return all[jid] || {};
}

function updateGroupSettings(jid, updates) {
  const all = readJson(GROUP_SETTINGS_FILE, {});
  all[jid] = { ...(all[jid] || {}), ...updates };
  writeJson(GROUP_SETTINGS_FILE, all);
}

function addGroupCommandAllow(jid, commandName) {
  const all = readJson(SUDO_ALLOW_FILE, {});
  if (!all[jid]) all[jid] = [];
  if (!all[jid].includes(commandName)) {
    all[jid].push(commandName);
  }
  writeJson(SUDO_ALLOW_FILE, all);
}

function removeGroupCommandAllow(jid, commandName) {
  const all = readJson(SUDO_ALLOW_FILE, {});
  if (!all[jid]) return false;
  const idx = all[jid].indexOf(commandName);
  if (idx === -1) return false;
  all[jid].splice(idx, 1);
  if (all[jid].length === 0) delete all[jid];
  writeJson(SUDO_ALLOW_FILE, all);
  return true;
}

function getAllowedCommandsForGroup(jid) {
  const all = readJson(SUDO_ALLOW_FILE, {});
  return all[jid] || [];
}

function getGlobalSetting(key) {
  const all = readJson(GLOBAL_SETTINGS_FILE, {});
  return all[key];
}

function updateGlobalSetting(key, value) {
  const all = readJson(GLOBAL_SETTINGS_FILE, {});
  all[key] = value;
  writeJson(GLOBAL_SETTINGS_FILE, all);
}

module.exports = {
  getGroupSettings,
  updateGroupSettings,
  addGroupCommandAllow,
  removeGroupCommandAllow,
  getAllowedCommandsForGroup,
  getGlobalSetting,
  updateGlobalSetting,
};
