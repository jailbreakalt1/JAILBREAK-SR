/**
 * brain/checkIn.js
 *
 * Autonomous "friend initiative" engine.
 *
 * After a DM user has been quiet for longer than config.checkIn.thresholdHours,
 * JB opens an initiative WINDOW at a configurable cadence (every
 * config.checkIn.intervalMinutes). In that window it runs the FULL brain —
 * tool-calling enabled — so the model can act like a real friend: fire a
 * terminal tool (e.g. send a fitting song), pull live data, or just send a
 * short line. This is the "actually agentic" tier: the scheduler only opens
 * the window and trusts the model's judgement.
 *
 * Guardrails: DMs only, quiet hours respected, threshold + cooldown gates
 * persisted, ONE real send per scheduler cycle, and a global daily send cap
 * (config.checkIn.dailyCeil) so freedom never becomes spam.
 *
 * Wiring (handled by handler.js):
 *   checkIn.updateLastSeen(jid, pushName) — call on every incoming DM
 *   checkIn.init(sock, config, commands)  — called lazily on first DM; the
 *                                           command registry unlocks real tools
 */

const fs   = require('fs');
const path = require('path');

const DATA_FILE      = path.join(__dirname, '../database/checkInLastSeen.json');
const INITIATIVE_TIMEOUT_MS = 75000; // cap each autonomous think() so the scheduler never hangs

let _sock      = null;
let _config    = null;
let _commands  = null;
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

// ── Autonomous initiative via brain.think() ─────────────────────────────────
// Routing through think() means the initiative is saved to memory as
// assistant: "..." — so when the user replies, JB already knows it reached
// out and can continue the thread naturally. Tools are LIVE here (sock, msg
// and commands are passed), so the model can decide to do something real on
// its own — fire a terminal tool (e.g. send a fitting song) rather than just
// text. This is the "actually agentic" part: the model owns the judgement,
// the scheduler just gives it a window.

async function runInitiative(jid, pushName, hoursAway) {
    const { think } = require('./ai');
    const memory    = require('./memory');

    const name = pushName ? pushName : 'the user';
    const note =
        `[AUTONOMOUS INITIATIVE] It's been ${hoursAway} hours since ${name} last messaged you, ` +
        `no conversation is active, and this is your window to act like a real friend. ` +
        `You are completely free to use any tool you genuinely want — check the weather, ` +
        `look something up, send a song that fits the vibe. ${name}'s mood and your history ` +
        `are yours to read. Judgement call, yours: keep it brief and thoughtful. ` +
        `If nothing is worth saying, a simple short line is still fine. Text replies ` +
        `should be under 18 words. One terminal tool max (the engine enforces it).`;

    // Synthetic message context so tool calls (owner gate, chatId, quoted)
    // work exactly like a real turn's.
    const msg = {
        key: { remoteJid: jid, participant: jid, fromMe: false, id: `autonomous_${Date.now()}` },
        pushName,
    };
    const brainExtra = {
        from: jid,
        sender: jid,
        pushName,
        getCommands: () => _commands,
        reply: async (text, extraContent = {}) => {
            await _sock.sendMessage(jid, { text: String(text), ...extraContent }, { __skipStyle: true });
        },
        react: async () => {},
    };

    const promise = think(jid, note, {
        pushName,
        sock: _sock,
        msg,
        commands: _commands,
        brainExtra,
        autonomous: true,
        onTool: (name) => console.log(`[AUTONOMY] tool "${name}" fired for ${jid.split('@')[0]}`),
    });

    // Hard ceiling — never let a flaky model block the scheduler.
    const result = await Promise.race([
        promise,
        new Promise((resolve) => setTimeout(() => resolve({ type: 'text', reply: null }), INITIATIVE_TIMEOUT_MS)),
    ]);

    return result?.reply || null;
}

// Persisted global daily cap — how many autonomous initiatives we may actually
// send in one day, so the bot can be free with ideas but never spammy.
function dailyBudget() {
    const cfg  = _config?.checkIn || {};
    const ceil = cfg.dailyCeil || 3;
    const today = require('../tools/timezone').nowInConfiguredTimezone().format('YYYY-MM-DD');
    const data = readData();
    if (data._day !== today) {
        data._day = today;
        data._sends = 0;
        writeData(data);
    }
    return { ceil, used: data._sends || 0 };
}

// Record one sent initiative: stamps the user's lastCheckin AND bumps the
// daily counter in one atomic read-modify-write (no stale-snapshot clobbers).
function recordSent(jid) {
    const data = readData();
    if (data[jid]) data[jid].lastCheckin = Date.now();
    if (!data._sends) data._sends = 0;
    data._sends += 1;
    writeData(data);
}

// ── Scheduler ────────────────────────────────────────────────────────────────

async function runChecks() {
    if (!_sock || !_config?.checkIn?.enabled) return;

    // Quiet hours: stay 100% silent during the night window (config.quiet)
    const { nowInConfiguredTimezone } = require('../tools/timezone');
    const q = _config.quiet || { start: 22, end: 6 };
    const hour = nowInConfiguredTimezone().hour();
    const quiet = q.start < q.end ? (hour >= q.start && hour < q.end) : (hour >= q.start || hour < q.end);
    if (quiet) {
        console.log(`[CHECKIN] quiet hours (${hour}:00) — skipping proactive checks`);
        return;
    }

    const budget = dailyBudget();
    if (budget.used >= budget.ceil) {
        console.log(`[CHECKIN] daily initiative budget used (${budget.used}/${budget.ceil}) — standing down for today`);
        return;
    }

    const cfg          = _config.checkIn;
    const thresholdMs  = (cfg.thresholdHours || 24) * 3600000;
    const cooldownMs   = (cfg.cooldownHours  || 48) * 3600000;
    const now          = Date.now();
    const data         = readData();

    for (const [jid, entry] of Object.entries(data)) {
        if (jid.startsWith('_')) continue;                       // bookkeeping (_day/_sends), not a jid
        if (!/@/.test(jid) || jid.endsWith('@g.us')) continue;   // DM jids only
        if (!entry || typeof entry !== 'object') continue;

        const sinceMessage  = now - (entry.ts || 0);
        const sinceCheckin  = entry.lastCheckin ? now - entry.lastCheckin : Infinity;

        if (sinceMessage  < thresholdMs) continue;  // still active
        if (sinceCheckin  < cooldownMs)  continue;  // already reached out recently

        const hoursAway = Math.round(sinceMessage / 3600000);
        console.log(`[AUTONOMY] ${jid.split('@')[0]} quiet ${hoursAway}h — opening an initiative window`);

        try {
            const text = await runInitiative(jid, entry.pushName, hoursAway);
            if (!text) {
                console.log(`[AUTONOMY] ${jid.split('@')[0]} — nothing worth sending, skipped`);
                continue;
            }

            await _sock.sendMessage(jid, { text });
            recordSent(jid);
            console.log(`[AUTONOMY] ✓ sent to ${jid.split('@')[0]}: "${text}"`);

            // One real send per cycle — never stack long autonomous turns
            // (a song download could take a while) back to back.
            break;
        } catch (err) {
            console.error(`[AUTONOMY] failed for ${jid}:`, err.message);
        }
    }
}

// ── Init ─────────────────────────────────────────────────────────────────────

/**
 * Initialize the autonomous initiative scheduler. Called lazily on the first
 * DM message so we always have a live sock reference without needing index.js
 * changes. A commands map is required so the model can run real tools during
 * check-ins — pass the handler's command registry.
 */
function init(sock, config, commands) {
    if (_initialized) {
        _sock   = sock;     // update sock reference if reconnected
        _config = config;
        _commands = commands || _commands;
        return;
    }

    _sock        = sock;
    _config      = config;
    _commands    = commands || null;
    _initialized = true;

    if (!config?.checkIn?.enabled) {
        console.log('[CHECKIN] disabled in config');
        return;
    }

    if (_interval) clearInterval(_interval);
    const intervalMs = (config.checkIn.intervalMinutes || 20) * 60 * 1000;
    _interval = setInterval(runChecks, intervalMs);

    const cfg = config.checkIn;
    console.log(
        `[AUTONOMY] scheduler started — ` +
        `initiative every ${cfg.intervalMinutes || 20}min, threshold: ${cfg.thresholdHours}h, ` +
        `cooldown: ${cfg.cooldownHours}h, daily cap: ${cfg.dailyCeil || 3}` +
        (_commands ? ', tools ENABLED' : ', tools DISABLED')
    );
}

module.exports = { init, isInitialized, updateLastSeen, markCheckedIn, getLastSeen };
