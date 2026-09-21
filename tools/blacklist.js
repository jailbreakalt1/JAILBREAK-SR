/**
 * tools/blacklist.js
 *
 * Bot-level ban list. Banned numbers are ignored by handler.js except for
 * `.unban` itself. The owner can never lock themselves out (handler bypasses
 * the ban check for owner numbers).
 */

const fs   = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'database', 'blacklist.json');

function read() {
    try {
        const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
        return typeof raw === 'object' && raw ? raw : {};
    } catch (_) { return {}; }
}

function write(state) {
    const tmp = FILE + '.tmp';
    try {
        fs.mkdirSync(path.dirname(FILE), { recursive: true });
        fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
        fs.renameSync(tmp, FILE);
    } catch (err) {
        try { fs.unlinkSync(tmp); } catch (_) {}
        console.error(`[BLACKLIST] write failed: ${err.message}`);
    }
}

function ban(phone, by = 'owner', reason = '') {
    const state = read();
    state[phone] = { reason: reason || 'no reason given', by, at: Date.now() };
    write(state);
}

function unban(phone) {
    const state = read();
    if (!state[phone]) return false;
    delete state[phone];
    write(state);
    return true;
}

function isBanned(phone) {
    return Boolean(read()[phone]);
}

function list() {
    return Object.entries(read());
}

module.exports = { ban, unban, isBanned, list };