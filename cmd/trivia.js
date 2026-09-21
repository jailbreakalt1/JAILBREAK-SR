/**
 * cmd/trivia.js
 *
 * Random multiple-choice trivia from opentdb.com — free, no key.
 * Direct + brain tool.
 */

const axios = require('axios');

function decodeEntities(s) {
    return String(s)
        .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'")
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
        .replace(/&[a-z]+;/gi, '');
}

function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

module.exports = {
    name: 'trivia',
    aliases: ['quiz'],
    category: 'fun',
    description: 'Random multiple-choice trivia question.',
    usage: '',

    async execute(sock, msg, args, extra = {}) {
        let text;
        try {
            const { data } = await axios.get('https://opentdb.com/api.php?amount=1&type=multiple', { timeout: 8000 });
            const q = data && data.results && data.results[0];
            if (!q) throw new Error('no trivia found');
            const options = shuffle([q.correct_answer, ...q.incorrect_answers]);
            const label = ['A', 'B', 'C', 'D'];
            const lines = [
                `🧠 *${decodeEntities(q.question)}*`,
                `_${q.category} · ${q.difficulty}_`,
                '',
                ...options.map((opt, i) => `${label[i]}. ${decodeEntities(opt)}`),
                '',
                `_answer: ${decodeEntities(q.correct_answer)}_`,
            ];
            text = lines.join('\n');
        } catch (err) {
            text = `trivia service bailed — ${err.message}`;
        }

        if (extra.__brainCall) return { summary: text };

        try { await extra.react?.('🧠'); } catch (_) {}
        if (!extra.reply) {
            await sock.sendMessage(extra.from || msg.key.remoteJid, { text }, { quoted: msg });
        } else {
            await extra.reply(text);
        }
        return { ok: true, summary: text };
    },
};