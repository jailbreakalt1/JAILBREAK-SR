/**
 * cmd/remind.js
 *
 * Brain-only tool (not a direct user command). JB calls this once, confirms
 * immediately, then messages the user again on its own when the timer's up.
 *
 * Scope/limits (by design, not oversight):
 *  - In-memory only — reminders are lost if the process restarts. Fine for
 *    "remind me in 20 minutes", not meant for anything that must survive a
 *    deploy.
 *  - Capped per-chat concurrent reminders and a max delay.
 */

const config = require('../config');

const MAX_MINUTES_AHEAD  = 24 * 60;
const MIN_MINUTES_AHEAD  = 1 / 60;
const MAX_ACTIVE_PER_CHAT = 5;

const activeReminders = new Map();

function pruneExpired(jid) {
    const list = activeReminders.get(jid);
    if (!list) return [];
    const now = Date.now();
    const fresh = list.filter((r) => r.fireAt > now);
    activeReminders.set(jid, fresh);
    return fresh;
}

module.exports = {
    name: 'remind',
    aliases: ['remindme', 'reminder'],
    category: 'utility',
    description: 'Set a reminder that gets sent back to the user after a delay, with no further prompting needed.',
    usage: '<minutes> <what to remind about>',

    async execute(sock, msg, args, extra = {}) {
        const chatId = extra.from || msg.key.remoteJid;

        // Tool-only — refuse direct command execution
        if (!extra.__brainCall) {
            await sock.sendMessage(chatId, {
                text: `⧯ remind is only available through the AI chat, not as a direct command.`
            }, { quoted: msg });
            return { ok: false, reason: 'tool_only', message: 'remind is only available through the AI.' };
        }
        const minutes = parseFloat(args[0]);
        const reminderText = args.slice(1).join(' ').trim();

        if (!reminderText || Number.isNaN(minutes)) {
            return { ok: false, reason: 'bad_args', message: 'Need both minutes and a reminder message.' };
        }

        if (minutes < MIN_MINUTES_AHEAD || minutes > MAX_MINUTES_AHEAD) {
            return { ok: false, reason: 'bad_args', message: `Requested ${minutes} minutes, outside the 1–1440 window.` };
        }

        const existing = pruneExpired(chatId);
        if (existing.length >= MAX_ACTIVE_PER_CHAT) {
            return { ok: false, reason: 'at_capacity', message: `Chat already has ${existing.length} active reminders.` };
        }

        const delayMs = Math.round(minutes * 60 * 1000);
        const fireAt = Date.now() + delayMs;

        const whenLabel = minutes >= 60
            ? `${(minutes / 60).toFixed(1).replace(/\.0$/, '')}h`
            : `${Math.round(minutes)}m`;

        const timer = setTimeout(async () => {
            try {
                await sock.sendMessage(chatId, {
                    text: `⏰ *Reminder from ${config.botName}:* ${reminderText}`
                }, { __skipStyle: true });
            } catch (err) {
                console.error('[REMIND] failed to deliver reminder:', err.message);
            } finally {
                const list = activeReminders.get(chatId);
                if (list) activeReminders.set(chatId, list.filter((r) => r.timer !== timer));
            }
        }, delayMs);

        existing.push({ fireAt, timer });
        activeReminders.set(chatId, existing);

        await sock.sendMessage(chatId, {
            text: `⏰ Got it — I'll remind you about "${reminderText}" in ${whenLabel}.`
        }, { __skipStyle: true });

        return { ok: true };
    },
};
