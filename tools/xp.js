/**
 * tools/xp.js
 *
 * Lightweight per-user XP / levels / streaks. Points accrue on human
 * messages (wired in handler.js), rate-limited to 1/min per user.
 *
 * Level curve: each level k costs 500·k² cumulative points.
 */

const fs   = require('fs');
const path = require('path');
const { nowInConfiguredTimezone } = require('./timezone');

const FILE = path.join(__dirname, '..', 'database', 'xp.json');

const RATE_LIMIT_MS = 60 * 1000; // one point per minute per user

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
        console.error(`[XP] write failed: ${err.message}`);
    }
}

function todayStr() {
    return nowInConfiguredTimezone().format('YYYY-MM-DD');
}

function yesterdayStr() {
    return nowInConfiguredTimezone().subtract(1, 'day').format('YYYY-MM-DD');
}

function levelInfo(xp) {
    let level = 1, remain = xp;
    while (true) {
        const need = 500 * level * level;
        if (remain < need) return { level, current: remain, next: need };
        remain -= need;
        level += 1;
    }
}

/**
 * Record activity for a user. Returns their new stats object or null when
 * rate-limited.
 */
function bump(phone, pushName) {
    const now = Date.now();
    const state = read();
    const rec = state[phone] || { xp: 0, last: '', streak: 0, dayCount: 0, name: pushName || '', lastBump: 0 };

    if (rec.lastBump && now - rec.lastBump < RATE_LIMIT_MS) return levelInfo(rec.xp);

    const today  = todayStr();
    const yester = yesterdayStr();

    if (rec.last === today) {
        rec.dayCount += 1;
    } else if (rec.last === yester) {
        rec.streak = (rec.streak || 0) + 1;
        rec.dayCount = 1;
    } else {
        rec.streak = 1;
        rec.dayCount = 1;
    }

    rec.xp = (rec.xp || 0) + 1;
    rec.last = today;
    rec.lastBump = now;
    if (pushName) rec.name = pushName.slice(0, 40);

    state[phone] = rec;
    write(state);
    return { level: levelInfo(rec.xp), streak: rec.streak, dayCount: rec.dayCount, xp: rec.xp, name: rec.name };
}

function get(phone) {
    const rec = read()[phone];
    if (!rec) return null;
    return { level: levelInfo(rec.xp), streak: rec.streak, dayCount: rec.dayCount, xp: rec.xp, name: rec.name };
}

function rank(phone) {
    const entries = Object.entries(read());
    const sorted = entries.sort((a, b) => (b[1].xp || 0) - (a[1].xp || 0));
    const idx = sorted.findIndex(([p]) => p === phone);
    return idx === -1 ? null : idx + 1;
}

function top(n = 10) {
    const entries = Object.entries(read());
    return entries
        .sort((a, b) => (b[1].xp || 0) - (a[1].xp || 0))
        .slice(0, n)
        .map(([phone, rec]) => ({ phone, ...levelInfo(rec.xp), ...rec }));
}

module.exports = { bump, get, rank, top, levelInfo };