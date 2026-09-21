/**
 * cmd/fact.js
 *
 * Random fun fact from uselessfacts.jsph.pl — free, no key.
 * Direct command + brain tool (data kind, returns { summary }).
 */

const axios = require('axios');

module.exports = {
    name: 'fact',
    aliases: ['facts', 'didyouknow'],
    category: 'fun',
    description: 'Random fun fact.',
    usage: '',

    async execute(sock, msg, args, extra = {}) {
        let text;
        try {
            const { data } = await axios.get('https://uselessfacts.jsph.pl/api/v2/facts/random', {
                params: { language: 'en' },
                timeout: 8000,
            });
            text = (data && data.text) || "the fact-fairy came back empty today.";
        } catch (err) {
            text = `couldn't pull a fact rn — ${err.message}`;
        }

        if (extra.__brainCall) return { summary: text };

        try { await extra.react?.('🤯'); } catch (_) {}
        if (!extra.reply) {
            await sock.sendMessage(extra.from || msg.key.remoteJid, { text }, { quoted: msg });
        } else {
            await extra.reply(text);
        }
        return { ok: true, summary: text };
    },
};