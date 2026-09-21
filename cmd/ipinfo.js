/**
 * cmd/ipinfo.js
 *
 * IP / geo info via ipwho.is (free tier, no key, HTTPS). No IP given → looks up
 * the bot's own public IP first. Direct + brain tool.
 */

const axios = require('axios');

module.exports = {
    name: 'ipinfo',
    aliases: ['ip', 'whereis'],
    category: 'utility',
    description: 'Look up an IP address (defaults to my own public IP).',
    usage: '[ip address]',

    async execute(sock, msg, args, extra = {}) {
        const ip = (args[0] || '').trim();

        try {
            const { data } = await axios.get(`https://ipwho.is/${encodeURIComponent(ip)}`, { timeout: 10000 });
            if (!data || data.success === false) throw new Error(data && data.message ? data.message : 'lookup failed');

            const city = data.city ? `${data.city}, ` : '';
            const region = data.region_code ? `${data.region_code}, ` : '';
            const country = data.country ? `${data.country}` : '';
            const coords = data.latitude !== undefined && data.longitude !== undefined
                ? `${data.latitude.toFixed(2)}, ${data.longitude.toFixed(2)}`
                : '';
            const lines = [
                `🌍 *${data.ip || ip}*`,
                `\n${city}${region}${country}`,
                data.connection && data.connection.isp ? `ISP: ${data.connection.isp}` : '',
                data.connection && data.connection.org && data.connection.org !== data.connection.isp ? `org: ${data.connection.org}` : '',
                data.timezone && data.timezone.id ? `timezone: ${data.timezone.id} (${data.timezone.abbr || ''})` : '',
                coords ? `coords: ${coords}` : '',
            ];
            const out = lines.filter(Boolean).join('\n');

            if (extra.__brainCall) return { summary: out };
            try { await extra.react?.('🌍'); } catch (_) {}
            await extra.reply?.(out);
            return { ok: true, summary: out };
        } catch (err) {
            const note = `IP lookup failed — ${err.message}`;
            if (extra.__brainCall) return { summary: note };
            await extra.reply?.(note);
            return { ok: false, reason: 'ipinfo_failed', message: err.message };
        }
    },
};