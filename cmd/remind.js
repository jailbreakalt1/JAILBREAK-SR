/**
 * cmd/remind.js
 *
 * Reminders — used by the brain as a tool, and also directly:
 *   .remind <minutes> <text>     (set one)
 *   .remind list                 (active reminders)
 *   .remind cancel <n>           (cancel one)
 *
 * Quiet hours (config.quiet): a reminder due within the quiet window is
 * deferred until the window ends instead of buzzing the user at night.
 * Storage is in-memory (lost on restart) — fine for short-term reminders.
 */

const config = require('../config');

const MAX_MINUTES_AHEAD  = 24 * 60;
const MIN_MINUTES_AHEAD  = 1 / 60;
const MAX_ACTIVE_PER_CHAT = 8;

const activeReminders = new Map();
let idSeq = 1;

function isQuietNow(now = new Date()) {
    const q = config.quiet || { start: 22, end: 6 };
    const h = now.getHours();
    if (q.start < q.end) return h >= q.start && h < q.end;
    return h >= q.start || h < q.end;
}

function deferUntilMorning(prevFireAt, now = Date.now()) {
    const next = new Date(prevFireAt);
    next.setHours(0, 0, 0, 0);
    next.setDate(next.getDate() + 1);
    next.setHours((config.quiet || { end: 6 }).end, 0, 0, 0);
    return next.getTime();
}

function pruneExpired(jid) {
    const list = activeReminders.get(jid);
    if (!list) return [];
    const now = Date.now();
    const fresh = list.filter((r) => r.fireAt > now);
    activeReminders.set(jid, fresh);
    return fresh;
}

async function deliver(sock, chatId, reminder) {
    try {
        await sock.sendMessage(chatId, {
            text: `⏰ *Reminder from ${config.botName}:* ${reminder.text}`
        }, { __skipStyle: true });
    } catch (err) {
        console.error('[REMIND] failed to deliver reminder:', err.message);
    } finally {
        const list = activeReminders.get(chatId);
        if (list) activeReminders.set(chatId, list.filter((r) => r.id !== reminder.id));
    }
}

function schedule(sock, chatId, minutes, text) {
    let delayMs = Math.round(minutes * 60 * 1000);
    let fireAt = Date.now() + delayMs;

    // Quiet hours — nudge the fire time forward instead of delivery-time pausing
    if (isQuietNow()) {
        const morning = deferUntilMorning(fireAt);
        if (morning > fireAt) { fireAt = morning; delayMs = morning - Date.now(); }
    }
    // absolute cap: re-check at fire time and re-defer if we've landed in quiet
    const reminder = { id: idSeq++, fireAt, text, timer: null };
    const timer = setTimeout(async () => {
        const now = Date.now();
        if (isQuietNow(new Date(now))) {
            const next = deferUntilMorning(now, now);
            reminder.fireAt = next;
            reminder.timer = setTimeout(() => deliver(sock, chatId, reminder), next - now);
            const list = activeReminders.get(chatId) || [];
            activeReminders.set(chatId, list.map((r) => (r.id === reminder.id ? reminder : r)));
            console.log(`[REMIND] #${reminder.id} deferred to ${new Date(next).toISOString()} (quiet hours)`);
            return;
        }
        await deliver(sock, chatId, reminder);
    }, delayMs);
    reminder.timer = timer;

    const list = activeReminders.get(chatId) || [];
    list.push(reminder);
    activeReminders.set(chatId, list);
    return reminder;
}

function formatWhen(ms) {
    const mins = Math.round((ms - Date.now()) / 60000);
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60), m = mins % 60;
    return `${h}h${m ? ` ${m}m` : ''}`;
}

module.exports = {
    name: 'remind',
    aliases: ['remindme', 'reminder'],
    category: 'utility',
    description: 'Set a reminder that comes back to you after a delay.',
    usage: '<minutes> <what> | list | cancel <n>',

    async execute(sock, msg, args, extra = {}) {
        const chatId = extra.from || msg.key.remoteJid;

        // ── Direct usage: list / cancel ───────────────────────────────────
        if (!extra.__brainCall) {
            const action = (args[0] || '').toLowerCase();
            if (action === 'list') {
                const list = pruneExpired(chatId);
                if (!list.length) {
                    await sock.sendMessage(chatId, { text: 'no active reminders here.' }, { quoted: msg });
                    return { ok: true };
                }
                const lines = list.map((r) => `#${r.id} · in ${formatWhen(r.fireAt)} · ${r.text}`);
                await sock.sendMessage(chatId, { text: `⏰ *Active reminders:*\n${lines.join('\n')}` }, { quoted: msg });
                return { ok: true, summary: `listed ${list.length} reminders.` };
            }

            if (action === 'cancel' || action === 'del') {
                const n = parseInt(args[1], 10);
                const list = pruneExpired(chatId);
                const found = list.find((r) => r.id === n);
                if (!found) {
                    await sock.sendMessage(chatId, { text: `no active reminder #${n}.` }, { quoted: msg });
                    return { ok: true };
                }
                clearTimeout(found.timer);
                activeReminders.set(chatId, list.filter((r) => r.id !== n));
                await sock.sendMessage(chatId, { text: `cancelled reminder #${n}.` }, { quoted: msg });
                return { ok: true, summary: `Cancelled reminder #${n}.` };
            }
        }

        // ── Create: brain tool or direct ──────────────────────────────────
        const minutes = parseFloat(args[0]);
        const reminderText = args.slice(1).join(' ').trim();

        if (!reminderText || Number.isNaN(minutes)) {
            const msg_ = extra.__brainCall
                ? 'Need both minutes and a reminder message.'
                : 'usage: `.remind <minutes> <what>`, `.remind list`, `.remind cancel <n>`';
            await sock.sendMessage(chatId, { text: msg_ }, { quoted: msg });
            return { ok: false, reason: 'bad_args', message: msg_ };
        }

        if (minutes < MIN_MINUTES_AHEAD || minutes > MAX_MINUTES_AHEAD) {
            return { ok: false, reason: 'bad_args', message: `Requested ${minutes} minutes, outside the 1–1440 window.` };
        }

        const existing = pruneExpired(chatId);
        if (existing.length >= MAX_ACTIVE_PER_CHAT) {
            return { ok: false, reason: 'at_capacity', message: `Chat already has ${existing.length} active reminders.` };
        }

        const reminder = schedule(sock, chatId, minutes, reminderText);
        const whenLabel = formatWhen(reminder.fireAt);
        const note = isQuietNow() ? ` (it\u2019s quiet hours, I\u2019ll send it at ${new Date(reminder.fireAt).toLocaleTimeString()} instead)` : '';

        await sock.sendMessage(chatId, {
            text: `⏰ Got it — I'll remind you about "${reminderText}" in ${whenLabel}.${note}`
        }, { __skipStyle: true });

        return { ok: true };
    },
};