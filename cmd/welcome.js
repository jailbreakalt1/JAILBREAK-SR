/**
 * cmd/welcome.js
 *
 * Per-group welcome / goodbye message toggles. The actual sending is wired
 * into handler.handleGroupUpdate (see handler.js).
 *   .welcome on [message]   |   .welcome off
 *   .goodbye on [message]   |   .goodbye off
 */

const database = require('../database');

module.exports = {
    name: 'welcome',
    aliases: ['welcome?', 'gwelcome', 'joinmsg'],
    category: 'admin',
    description: 'Set a welcome/goodbye message for this group.',
    usage: 'on|off [message]   ·   see also: .goodbye',
    adminOnly: true,

    async execute(sock, msg, args, extra = {}) {
        const chatId = extra.from || msg.key.remoteJid;
        const mode = (args[0] || '').toLowerCase();
        const text = args.slice(1).join(' ').trim();

        const reply = async (t) => { await (extra.reply ? extra.reply(t) : sock.sendMessage(chatId, { text: t }, { quoted: msg })); return { ok: true }; };

        if (!chatId.endsWith('@g.us')) return reply('welcome messages are a group thing.');
        if (!mode) return reply('usage: `.welcome on <message>` or `.welcome off`');

        if (mode === 'off') {
            database.updateGroupSettings(chatId, { welcome: { enabled: false } });
            return reply('welcome messages turned off for this group.');
        }

        if (mode === 'on') {
            const current = database.getGroupSettings(chatId).welcome || {};
            const message = text || current.text || 'Welcome to the group, @name! 🎉';
            database.updateGroupSettings(chatId, {
                welcome: { enabled: true, text: message },
            });
            return reply(`welcome messages turned on.\nMessage: ${message}\n(use @name where the new member\u2019s name should go)`);
        }

        return reply('usage: `.welcome on <message>` or `.welcome off`');
    },
};