/**
 * cmd/ping.js
 *
 * Health + latency card. Reports process uptime, memory, Node version and a
 * live measure of how long an outbound HTTP round-trip takes right now.
 * Direct + brain tool.
 */

const axios = require('axios');

function humanize(ms) {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
    const h = Math.floor(s / 3600);
    return `${h}h ${Math.floor((s % 3600) / 60)}m`;
}

module.exports = {
    name: 'ping',
    aliases: ['pong', 'alive', 'health'],
    category: 'utility',
    description: 'Check if the bot is alive and how it\u2019s doing.',
    usage: '',

    async execute(sock, msg, args, extra = {}) {
        const mem = process.memoryUsage();
        const started = Date.now() - process.uptime() * 1000;

        let net = 0;
        try {
            const t0 = Date.now();
            await axios.get('https://open.er-api.com/v6/latest/USD', { timeout: 5000 });
            net = Date.now() - t0;
        } catch (_) { net = -1; }

        const uptime = humanize(process.uptime() * 1000);
        const text = [
            '🏓 *PONG — I\u2019m here!*',
            '',
            `⏱ uptime: ${uptime}`,
            `🕐 booted: ${new Date(started).toUTCString()}`,
            `📈 RSS: ${(mem.rss / 1048576).toFixed(0)}MB  ·  heap: ${(mem.heapUsed / 1048576).toFixed(0)}MB`,
            `🖥 node: ${process.version}  ·  ${process.platform}/${process.arch}`,
            `🌐 outbound: ${net < 0 ? 'unreachable' : net + 'ms'}`,
        ].join('\n');

        if (extra.__brainCall) return { summary: text };

        try { await extra.react?.('🏓'); } catch (_) {}
        await extra.reply?.(text);
        return { ok: true, summary: text };
    },
};