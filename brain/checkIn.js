/**
 * brain/checkIn.js
 *
 * Autonomous "miss you" check-in feature.
 *
 * JB tracks the last time each DM user sent a message. If they've been quiet
 * for longer than config.checkIn.thresholdHours (default: 24h), JB sends them
 * a casual, short check-in message — the way a friend would. Only in DMs, only
 * for users who have talked before, and with a cooldown so it never spams.
 *
 * Wiring (handled by handler.js):
 *   checkIn.updateLastSeen(jid, pushName) — call on every incoming DM
 *   checkIn.markReplied(jid)              — call when JB sends a check-in
 *   checkIn.init(sock, config)            — called lazily on first DM
 */

const fs   = require('fs');
const path = require('path');

const DATA_FILE      = path.join(__dirname, '../database/checkInLastSeen.json');
const CHECK_INTERVAL = 30 * 60 * 1000; // run checks every 30 minutes

let _sock      = null;
let _config    = null;
let _interval  = null;
let _initialized = false;

// ── Persistence ───────────────────────────────────────────────────────────────

function readData() {
    try   { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
    catch (_) { return {}; }
}

function writeData(data) {
    try {
        const dir = path.dirname(DATA_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('[CHECKIN] write error:', e.message);
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Call this every time a DM message comes in.
 * Tracks the timestamp for future check-in scheduling.
 */
function updateLastSeen(jid, pushName) {
    if (!jid || jid.endsWith('@g.us')) return;
    const data = readData();
    data[jid] = {
        ...data[jid],
        ts:       Date.now(),
        pushName: pushName || data[jid]?.pushName || '',
    };
    writeData(data);
}

/**
 * Call this after JB sends a check-in to prevent rapid re-sends.
 */
function markCheckedIn(jid) {
    const data = readData();
    if (data[jid]) {
        data[jid].lastCheckin = Date.now();
        writeData(data);
    }
}

function isInitialized() { return _initialized; }

/**
 * Return the timestamp of the user's last INCOMING message (not check-ins or bot replies).
 * Returns 0 if the user has never messaged.
 */
function getLastSeen(jid) {
    const data = readData();
    return data[jid]?.ts || 0;
}

// ── Check-in via brain.think() ───────────────────────────────────────────────
// Routing through think() means the check-in is saved to memory as
// assistant: "hey been a minute" — so when the user replies, JB already
// knows it reached out and can continue the thread naturally.

async function sendCheckIn(jid, pushName, hoursAway) {
    // Lazy-require to avoid circular dependency at module load time
    const { think } = require('./ai');
    const memory    = require('./memory');

    const name = pushName ? pushName : 'the user';
    const note =
        `[CHECKIN] ${name} last chatted with you ${hoursAway} hours ago. ` +
        `Send a short casual check-up — something like "hey been a minute" or ` +
        `"safe, how you been?". Under 12 words. Plain text only. No tools.`;

    // No sock/msg/commands → tools disabled, model just replies in text.
    // think() adds the note as 'user' and the reply as 'assistant' to memory,
    // so the next real message from this user sees the check-in in history.
    const result = await think(jid, note, { pushName });
    return result?.reply || null;
}

// ── Scheduler ────────────────────────────────────────────────────────────────

async function runChecks() {
    if (!_sock || !_config?.checkIn?.enabled) return;

    const cfg          = _config.checkIn;
    const thresholdMs  = (cfg.thresholdHours || 24) * 3600000;
    const cooldownMs   = (cfg.cooldownHours  || 48) * 3600000;
    const now          = Date.now();
    const data         = readData();

    for (const [jid, entry] of Object.entries(data)) {
        if (jid.endsWith('@g.us')) continue;

        const sinceMessage  = now - (entry.ts || 0);
        const sinceCheckin  = entry.lastCheckin ? now - entry.lastCheckin : Infinity;

        if (sinceMessage  < thresholdMs) continue;  // still active
        if (sinceCheckin  < cooldownMs)  continue;  // already checked in recently

        const hoursAway = Math.round(sinceMessage / 3600000);
        console.log(`[CHECKIN] ${jid.split('@')[0]} silent ${hoursAway}h — generating check-in`);

        try {
            const text = await sendCheckIn(jid, entry.pushName, hoursAway);
            if (!text) continue;

            await _sock.sendMessage(jid, { text });
            markCheckedIn(jid);
            console.log(`[CHECKIN] ✓ sent to ${jid.split('@')[0]}: "${text}"`);

            // Small pause between messages to avoid bursting
            await new Promise(r => setTimeout(r, 4000));
        } catch (err) {
            console.error(`[CHECKIN] failed for ${jid}:`, err.message);
        }
    }
}

// ── Init ─────────────────────────────────────────────────────────────────────

/**
 * Initialize the check-in scheduler. Called lazily on the first DM message
 * so we always have a live sock reference without needing index.js changes.
 */
function init(sock, config) {
    if (_initialized) {
        _sock   = sock;   // update sock reference if reconnected
        _config = config;
        return;
    }

    _sock        = sock;
    _config      = config;
    _initialized = true;

    if (!config?.checkIn?.enabled) {
        console.log('[CHECKIN] disabled in config');
        return;
    }

    if (_interval) clearInterval(_interval);
    _interval = setInterval(runChecks, CHECK_INTERVAL);

    const cfg = config.checkIn;
    console.log(
        `[CHECKIN] scheduler started — ` +
        `threshold: ${cfg.thresholdHours}h, cooldown: ${cfg.cooldownHours}h, ` +
        `checking every 30min`
    );
}

module.exports = { init, isInitialized, updateLastSeen, markCheckedIn, getLastSeen };
