/**
 * cmd/wiki.js
 *
 * Wikipedia summary via the free REST / Search API — no key.
 * Direct + brain tool.
 */

const axios = require('axios');

const UA = { 'User-Agent': 'JailbreakSR-Bot/1.0 (personal WhatsApp assistant)' };

async function summaryFor(title) {
    const { data } = await axios.get(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
        { timeout: 10000, headers: UA }
    );
    if (!data || !data.extract) throw new Error('no extract');
    return data;
}

async function firstMatch(query) {
    const { data } = await axios.get('https://en.wikipedia.org/w/api.php', {
        params: {
            action: 'query', list: 'search', srsearch: query,
            format: 'json', origin: '*', srlimit: 3,
        },
        timeout: 10000,
        headers: UA,
    });
    const hits = (data.query && data.query.search) || [];
    return hits.length ? hits[0].title : null;
}

module.exports = {
    name: 'wiki',
    aliases: ['wikipedia', 'wp'],
    category: 'utility',
    description: 'Get a Wikipedia summary for a topic.',
    usage: '<topic>',

    async execute(sock, msg, args, extra = {}) {
        const query = args.join(' ').trim();
        if (!query) {
            const ask = 'give me a topic, like `.wiki Harare`';
            if (extra.__brainCall) return { summary: ask };
            await extra.reply?.(ask);
            return { ok: true, summary: ask };
        }

        let out;
        try {
            let info;
            try {
                info = await summaryFor(query);
            } catch (_) {
                const title = await firstMatch(query);
                if (!title) throw new Error('nothing found');
                info = await summaryFor(title);
            }
            const extract = (info.extract || '').split('\n')[0];
            const link = info.content_urls && info.content_urls.desktop && info.content_urls.desktop.page;
            out = `📚 *${info.title}*\n${info.description ? `_${info.description}_\n` : ''}\n${extract}${link ? `\n\n${link}` : ''}`;
        } catch (err) {
            out = `no wikipedia match for "${query}" — ${err.message}`;
        }

        if (extra.__brainCall) return { summary: out };

        try { await extra.react?.('📚'); } catch (_) {}
        if (!extra.reply) {
            await sock.sendMessage(extra.from || msg.key.remoteJid, { text: out }, { quoted: msg });
        } else {
            await extra.reply(out);
        }
        return { ok: true, summary: out };
    },
};