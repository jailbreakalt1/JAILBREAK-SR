/**
 * cmd/xpTop.js
 *
 * Group leaderboard by XP. .xptop [n] — top 10 by default.
 */

const xp = require('../tools/xp');

module.exports = {
    name: 'xptop',
    aliases: ['top', 'leaderboard', 'lb'],
    category: 'fun',
    description: 'Global XP leaderboard.',
    usage: '[count]',

    async execute(sock, msg, args, extra = {}) {
        const n = Math.min(20, Math.max(3, parseInt(args[0], 10) || 10));
        const list = xp.top(n);

        if (!list.length) {
            const note = 'leaderboard is empty — go send some messages!';
            await extra.reply?.(note);
            return { ok: true, summary: note };
        }

        const medals = ['🥇', '🥈', '🥉'];
        const lines = list.map((r, i) => {
            const name = r.name || r.phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
            return `${medals[i] || `${i + 1}.`} ${name} — Lv${r.level} · ${r.xp} xp${r.streak > 1 ? ` · 🔥${r.streak}` : ''}`;
        });
        const text = `🏆 *Top ${list.length}*\n\n${lines.join('\n')}`;

        if (extra.__brainCall) return { summary: text };
        await extra.reply?.(text);
        return { ok: true, summary: text };
    },
};