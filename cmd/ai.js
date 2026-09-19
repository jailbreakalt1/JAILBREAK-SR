/**
 * cmd/ai.js
 *
 * Commands for managing JB's AI brain:
 *   .aion   — enable AI chat in this group
 *   .aioff  — disable AI chat in this group
 *   .forget — wipe JB's memory for this chat (fresh start)
 *   .aistats — show memory stats (owner only)
 */

const config = require('../config');
const database = require('../database');
const memory = require('../brain/memory');

module.exports = {
    name: 'aion',
    aliases: ['aioff', 'forget', 'aistats'],
    category: 'cmd',
    description: 'Control JB\'s AI brain',
    adminOnly: true,
    usage: '.aion / .aioff / .forget / .aistats',

    async execute(sock, msg, args, extra = {}) {
        const from = extra.from || msg.key.remoteJid;
        const isGroup = from.endsWith('@g.us');
        const { normalizeMessageContent } = require('@whiskeysockets/baileys');
        const normalizedMsg = normalizeMessageContent(msg.message);
        const body = (
            normalizedMsg?.conversation ||
            normalizedMsg?.extendedTextMessage?.text || ''
        ).trim().toLowerCase();

        const prefix = config.prefix;
        const command = body.startsWith(prefix)
            ? body.slice(prefix.length).split(/\s+/)[0]
            : 'aion';

        // ── .forget ──────────────────────────────────────────────────────────
        if (command === 'forget') {
            memory.clear(from);
            return extra.reply('memory wiped. fresh start 🧹');
        }

        // ── .aistats ─────────────────────────────────────────────────────────
        if (command === 'aistats') {
            const stats = memory.stats();
            const lines = [`*JB Brain Memory Stats*`, `Active chats: ${stats.chats}`, ''];
            for (const d of stats.details) {
                lines.push(`• ${d.jid} — ${d.messages} msgs, idle ${d.idleMins}m`);
            }
            return extra.reply(lines.join('\n'));
        }

        // ── .aion / .aioff ────────────────────────────────────────────────────
        if (!isGroup) {
            return extra.reply('AI is always on in DMs — no toggle needed');
        }

        if (command === 'aion') {
            database.updateGroupSettings(from, { aiEnabled: true });
            return extra.reply('AI brain is *ON* for this group 🧠\nJB will now respond to natural language, not just commands.');
        }

        if (command === 'aioff') {
            database.updateGroupSettings(from, { aiEnabled: false });
            memory.clear(from);  // clear memory when disabled
            return extra.reply('AI brain is *OFF* for this group.\nJB will only respond to commands (prefix: ' + config.prefix + ')');
        }
    },
};
