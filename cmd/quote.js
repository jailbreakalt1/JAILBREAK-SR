/**
 * cmd/quote.js
 *
 * Random quote from ZenQuotes (free, no key). Direct + brain tool.
 */

const axios = require('axios');

module.exports = {
    name: 'quote',
    aliases: ['qotd', 'wisdom'],
    category: 'fun',
    description: 'Random quote of wisdom.',
    usage: '',

    async execute(sock, msg, args, extra = {}) {
        let text;
        try {
            const { data } = await axios.get('https://zenquotes.io/api/random', { timeout: 8000 });
            const item = Array.isArray(data) && data[0];
            text = item && (item.q || item.quote)
                ? `"${item.q || item.quote}"\n\n— ${item.a || 'unknown'}`
                : "the quote well ran dry, sorry.";
        } catch (err) {
            text = `couldn't fetch a quote rn — ${err.message}`;
        }

        if (extra.__brainCall) return { summary: text };

        try { await extra.react?.('💬'); } catch (_) {}
        if (!extra.reply) {
            await sock.sendMessage(extra.from || msg.key.remoteJid, { text }, { quoted: msg });
        } else {
            await extra.reply(text);
        }
        return { ok: true, summary: text };
    },
};