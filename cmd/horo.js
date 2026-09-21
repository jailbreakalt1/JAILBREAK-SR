/**
 * cmd/horo.js
 *
 * Daily horoscope via horoscope-app-api (free Vercel API, no key).
 * Direct + brain tool.
 */

const axios = require('axios');

const SIGNS = ['aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo', 'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces'];

module.exports = {
    name: 'horo',
    aliases: ['horoscope'],
    category: 'fun',
    description: 'Daily horoscope for your sign.',
    usage: '<sign>  e.g. `.horo leo`',

    async execute(sock, msg, args, extra = {}) {
        const sign = (args[0] || '').toLowerCase().trim().replace(/\s+/g, '');
        if (!SIGNS.includes(sign)) {
            const ask = `pick a sign: ${SIGNS.slice(0, 6).join(', ')} …`;
            if (extra.__brainCall) return { summary: ask };
            await extra.reply?.(ask);
            return { ok: true, summary: ask };
        }

        let out;
        try {
            const { data } = await axios.get(
                `https://horoscope-app-api.vercel.app/api/v1/get-horoscope/daily?sign=${sign}&day=today`,
                { timeout: 8000 }
            );
            const d = data && data.data;
            if (!d || !d.horoscope) throw new Error('no horoscope data');
            const lucky = d.lucky_number ? `\n\n🍀 lucky number: ${d.lucky_number}${d.lucky_time ? `  ·  lucky time: ${d.lucky_time}` : ''}` : '';
            const mood = d.mood ? `  ·  mood: ${d.mood}` : '';
            out = `🔮 *${sign.charAt(0).toUpperCase()}${sign.slice(1)} — ${d.date || 'today'}*\n\n${d.horoscope}${lucky}${mood}`;
        } catch (err) {
            out = `horoscope reading failed — ${err.message}`;
        }

        if (extra.__brainCall) return { summary: out };

        try { await extra.react?.('🔮'); } catch (_) {}
        if (!extra.reply) {
            await sock.sendMessage(extra.from || msg.key.remoteJid, { text: out }, { quoted: msg });
        } else {
            await extra.reply(out);
        }
        return { ok: true, summary: out };
    },
};