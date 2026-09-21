/**
 * cmd/joke.js
 *
 * Random clean joke from JokeAPI (https://v2.jokeapi.dev) — no API key.
 * Works both as a direct command and as a brain tool (returns { summary }).
 */

const axios = require('axios');

module.exports = {
    name: 'joke',
    aliases: ['jokes', 'lolgo'],
    category: 'fun',
    description: 'Random clean joke.',
    usage: '',

    async execute(sock, msg, args, extra = {}) {
        let text;
        try {
            const { data } = await axios.get('https://v2.jokeapi.dev/joke/Any', {
                params: { blacklistFlags: 'nsfw,racist,sexist,explicit', format: 'json' },
                timeout: 8000,
            });
            text = data && data.type === 'twopart'
                ? `${data.setup}\n\n${data.delivery}`
                : (data && data.joke) || "that API came back empty, classic.";
        } catch (err) {
            text = `couldn't grab a joke rn — ${err.message}`;
        }

        if (extra.__brainCall) return { summary: text };

        try { await extra.react?.('🤣'); } catch (_) {}
        if (!extra.reply) {
            await sock.sendMessage(extra.from || msg.key.remoteJid, { text }, { quoted: msg });
        } else {
            await extra.reply(text);
        }
        return { ok: true, summary: text };
    },
};