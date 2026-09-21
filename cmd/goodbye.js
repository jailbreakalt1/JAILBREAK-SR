/**
 * cmd/goodbye.js
 *
 * Per-group goodbye (member-left) message toggle. Sent via handler.handleGroupUpdate.
 *   .goodbye on [message]  |  .goodbye off
 */

const database = require('../database');

module.exports = {
    name: 'goodbye',
    aliases: ['leavemsg'],
    category: 'admin',
    description: 'Set a goodbye message when members leave this group.',
    usage: 'on|off [message]   ·   see also: .welcome',
    adminOnly: true,

    async execute(sock, msg, args, extra = {}) {
        const chatId = extra.from || msg.key.remoteJid;
        const mode = (args[0] || '').toLowerCase();
        const text = args.slice(1).join(' ').trim();

        const reply = async (t) => { await (extra.reply ? extra.reply(t) : sock.sendMessage(chatId, { text: t }, { quoted: msg })); return { ok: true }; };

        if (!chatId.endsWith('@g.us')) return reply('goodbye messages are a group thing.');
        if (!mode) return reply('usage: `.goodbye on <message>` or `.goodbye off`');

        if (mode === 'off') {
            database.updateGroupSettings(chatId, { goodbye: { enabled: false } });
            return reply('goodbye messages turned off for this group.');
        }

        if (mode === 'on') {
            const current = database.getGroupSettings(chatId).goodbye || {};
            const message = text || current.text || 'See you later, @name! 👋';
            database.updateGroupSettings(chatId, {
                goodbye: { enabled: true, text: message },
            });
            return reply(`goodbye messages turned on.\nMessage: ${message}\n(use @name for the member\u2019s name)`);
        }

        return reply('usage: `.goodbye on <message>` or `.goodbye off`');
    },
};