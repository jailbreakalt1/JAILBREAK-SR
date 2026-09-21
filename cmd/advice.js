/**
 * cmd/advice.js
 *
 * Random life advice from adviceslip.com — free, no key. Direct + brain tool.
 */

const axios = require('axios');

module.exports = {
    name: 'advice',
    aliases: ['advise'],
    category: 'fun',
    description: 'Random piece of life advice.',
    usage: '',

    async execute(sock, msg, args, extra = {}) {
        let text;
        try {
            const { data } = await axios.get('https://api.adviceslip.com/advice', { timeout: 8000 });
            text = (data && data.slip && data.slip.advice)
                ? `💡 ${data.slip.advice}`
                : "the advice machine is out of order.";
        } catch (err) {
            text = `couldn't get advice rn — ${err.message}`;
        }

        if (extra.__brainCall) return { summary: text };

        try { await extra.react?.('💡'); } catch (_) {}
        if (!extra.reply) {
            await sock.sendMessage(extra.from || msg.key.remoteJid, { text }, { quoted: msg });
        } else {
            await extra.reply(text);
        }
        return { ok: true, summary: text };
    },
};