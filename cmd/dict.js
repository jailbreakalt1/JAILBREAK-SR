/**
 * cmd/dict.js
 *
 * English dictionary lookup via dictionaryapi.dev (free, no key) with a
 * Wikipedia intro fallback when that API is flaky. Direct + brain tool.
 */

const axios = require('axios');

const UA = { 'User-Agent': 'JailbreakSR-Bot/1.0 (personal WhatsApp assistant)' };

async function fromWikipedia(word) {
    const { data } = await axios.get(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(word)}`,
        { timeout: 10000, headers: UA }
    );
    if (!data || !data.extract) throw new Error('no extract');
    const extract = data.extract.split('\n')[0];
    return `📖 *${data.title}*\n${extract}${data.content_urls && data.content_urls.desktop ? `\n\n${data.content_urls.desktop.page}` : ''}`;
}

module.exports = {
    name: 'dict',
    aliases: ['dictionary', 'define', 'meaning'],
    category: 'utility',
    description: 'Look up a word definition.',
    usage: '<word>',

    async execute(sock, msg, args, extra = {}) {
        const word = args[0] || (extra.__brainCall && args[0]);
        if (!word) {
            const ask = 'give me a word to look up, like `.dict serendipity`';
            if (extra.__brainCall) return { summary: ask };
            await extra.reply?.(ask);
            return { ok: true, summary: ask };
        }

        let out;
        try {
            let entry = null;
            try {
                const { data } = await axios.get(
                    `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`,
                    { timeout: 10000, headers: UA }
                );
                entry = Array.isArray(data) && data[0];
            } catch (_) {}

            if (!entry) {
                try {
                    out = await fromWikipedia(word);
                } catch (_) {
                    throw new Error('no entry');
                }
            } else {
                const phonetic = entry.phonetic || (entry.phonetics || []).map(p => p.text).find(Boolean) || '';
                const lines = [`📖 *${entry.word}*${phonetic ? `  ·  ${phonetic}` : ''}`];
                const meanings = entry.meanings || [];
                meanings.slice(0, 3).forEach((m) => {
                    lines.push(`\n_${m.partOfSpeech}_`);
                    (m.definitions || []).slice(0, 2).forEach((d) => {
                        lines.push(` • ${d.definition}`);
                    });
                });
                const syn = meanings.flatMap(m => m.synonyms || []).filter(Boolean).slice(0, 6);
                if (syn.length) lines.push(`\nSynonyms: ${syn.join(', ')}`);
                out = lines.join('\n');
            }
        } catch (err) {
            out = `"${word}" isn't in my dictionary 🤷`;
        }

        if (extra.__brainCall) return { summary: out };

        try { await extra.react?.('📖'); } catch (_) {}
        if (!extra.reply) {
            await sock.sendMessage(extra.from || msg.key.remoteJid, { text: out }, { quoted: msg });
        } else {
            await extra.reply(out);
        }
        return { ok: true, summary: out };
    },
};