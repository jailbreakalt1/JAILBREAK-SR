/**
 * cmd/translate.js
 *
 * Free translate via Google's public endpoint (client=gtx, no key).
 * Usage: `.translate <target lang code> <text>` or `.translate <text>` (→ English).
 * Direct + brain tool.
 */

const axios = require('axios');

const DEFAULT_TARGET = 'en';
const LANG_HINT = {
    en: 'English', fr: 'French', es: 'Spanish', de: 'German', pt: 'Portuguese',
    sw: 'Swahili', zu: 'Zulu', sn: 'Shona', zh: 'Chinese', ja: 'Japanese',
    ko: 'Korean', ar: 'Arabic', ru: 'Russian', hi: 'Hindi', it: 'Italian',
    nl: 'Dutch', yo: 'Yoruba', ig: 'Igbo', ha: 'Hausa', am: 'Amharic',
    af: 'Afrikaans', so: 'Somali', tn: 'Tswana', st: 'Sotho',
};

module.exports = {
    name: 'translate',
    aliases: ['tr', 'tl'],
    category: 'utility',
    description: 'Translate text (default target: English).',
    usage: '[lang code] <text>  e.g. `.translate sn hello friend`',

    async execute(sock, msg, args, extra = {}) {
        const chatId = extra.from || msg.key.remoteJid;

        let target = DEFAULT_TARGET;
        let text = args.join(' ').trim();
        if (args.length > 1 && /^[a-z]{2,3}$/i.test(args[0]) && LANG_HINT[args[0].toLowerCase()]) {
            target = args[0].toLowerCase();
            text = args.slice(1).join(' ').trim();
        } else if (args.length > 1 && /^[a-z]{2,3}$/i.test(args[args.length - 1]) && LANG_HINT[args[args.length - 1].toLowerCase()]) {
            target = args[args.length - 1].toLowerCase();
            text = args.slice(0, -1).join(' ').trim();
        }

        if (!text) {
            const ask = 'give me something to translate, like `.translate sn good morning`';
            if (extra.__brainCall) return { summary: ask };
            await extra.reply?.(ask);
            return { ok: true, summary: ask };
        }

        let out;
        try {
            const { data } = await axios.get('https://translate.googleapis.com/translate_a/single', {
                params: { client: 'gtx', sl: 'auto', tl: target, dt: 't', q: text },
                timeout: 10000,
            });
            const chunks = (Array.isArray(data) && data[0]) ? data[0] : [];
            const translated = chunks.map((c) => (Array.isArray(c) && c[0]) || '').join('');
            const source = (Array.isArray(data) && data[2]) || '?';
            if (!translated) throw new Error('empty translation');
            out = `🌐 *${source} → ${(LANG_HINT[target] || target)}*: ${translated}`;
        } catch (err) {
            out = `translation hiccup — ${err.message}`;
        }

        if (extra.__brainCall) return { summary: out };

        try { await extra.react?.('🌐'); } catch (_) {}
        if (!extra.reply) {
            await sock.sendMessage(chatId, { text: out }, { quoted: msg });
        } else {
            await extra.reply(out);
        }
        return { ok: true, summary: out };
    },
};