/**
 * cmd/riddle.js
 *
 * Random riddle from riddles-api (Vercel, free, no key). Direct + brain tool.
 */

const axios = require('axios');

module.exports = {
    name: 'riddle',
    aliases: ['riddles'],
    category: 'fun',
    description: 'Random riddle (answer included — no peeking).',
    usage: '',

    async execute(sock, msg, args, extra = {}) {
        let text;
        try {
            const { data } = await axios.get('https://riddles-api.vercel.app/random', { timeout: 8000 });
            text = (data && data.riddle)
                ? `${data.riddle}\n\n_Answer: ${data.answer || '?'}_`
                : "no riddle came back, strange.";
        } catch (err) {
            text = `riddle service is being stubborn — ${err.message}`;
        }

        if (extra.__brainCall) return { summary: text };

        try { await extra.react?.('🤔'); } catch (_) {}
        if (!extra.reply) {
            await sock.sendMessage(extra.from || msg.key.remoteJid, { text }, { quoted: msg });
        } else {
            await extra.reply(text);
        }
        return { ok: true, summary: text };
    },
};