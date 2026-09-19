const moment = require('moment-timezone');
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'database', 'dailyQuota.json');
const DEFAULT_LIMIT = 10;

const pending = new Map();

function todayDate() {
    return moment().tz('Africa/Harare').format('YYYY-MM-DD');
}

function phone(jid) {
    return (jid || '').split('@')[0];
}

function readAll() {
    try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
    catch (_) { return {}; }
}

function writeAll(data) {
    const dir = path.dirname(FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

function ensureEntry(jid) {
    const p = phone(jid);
    if (!p) return { date: todayDate(), used: 0, artists: [] };
    const data = readAll();
    const date = todayDate();
    if (!data[p] || data[p].date !== date) {
        data[p] = { date, used: 0, artists: [] };
        writeAll(data);
    }
    if (!Array.isArray(data[p].artists)) data[p].artists = [];
    return data[p];
}

function getQuota(jid) {
    const p = phone(jid);
    if (!p) return { used: 0, total: DEFAULT_LIMIT, remaining: DEFAULT_LIMIT, allowed: true };
    const entry = ensureEntry(jid);
    const inFlight = pending.get(p) || 0;
    const used = entry.used + inFlight;
    const remaining = DEFAULT_LIMIT - used;
    return { used: entry.used, total: DEFAULT_LIMIT, remaining, allowed: remaining > 0 };
}

function useQuota(jid) {
    const p = phone(jid);
    if (!p) return getQuota(jid);
    pending.set(p, (pending.get(p) || 0) + 1);
    try {
        const data = readAll();
        const date = todayDate();
        if (!data[p] || data[p].date !== date) {
            data[p] = { date, used: 0 };
        }
        if (data[p].used < DEFAULT_LIMIT) data[p].used += 1;
        writeAll(data);
    } finally {
        const c = (pending.get(p) || 1) - 1;
        if (c <= 0) pending.delete(p);
        else pending.set(p, c);
    }
    return getQuota(jid);
}

function recordArtist(jid, artistName) {
    const p = phone(jid);
    if (!p || !artistName) return;
    const entry = ensureEntry(jid);
    const name = artistName.trim();
    if (!name) return;
    if (!entry.artists.includes(name)) {
        entry.artists.push(name);
        const data = readAll();
        if (data[p]) data[p].artists = entry.artists;
        writeAll(data);
    }
}

function getArtists(jid) {
    const p = phone(jid);
    if (!p) return [];
    const entry = ensureEntry(jid);
    return Array.isArray(entry.artists) ? entry.artists : [];
}

function timeUntilReset() {
    const now = moment().tz('Africa/Harare');
    const midnight = now.clone().startOf('day').add(1, 'day');
    const diff = midnight.diff(now);
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

module.exports = { getQuota, useQuota, recordArtist, getArtists, timeUntilReset, DEFAULT_LIMIT };
