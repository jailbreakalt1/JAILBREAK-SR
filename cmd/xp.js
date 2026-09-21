/**
 * cmd/xp.js
 *
 * Show your XP level, streak and progress. Points accrue automatically on
 * messages (1/min). See also .xptop.
 */

const xp   = require('../tools/xp');
const { cleanJid } = require('../tools/jidUtils');

module.exports = {
    name: 'xp',
    aliases: ['level', 'rank'],
    category: 'utility',
    description: 'Your XP level, streak and leaderboard rank.',
    usage: '',

    async execute(sock, msg, args, extra = {}) {
        const chatId = extra.from || msg.key.remoteJid;
        const self = cleanJid(extra.sender || (msg.key.participant || msg.key.remoteJid));

        const stats = xp.get(self);
        if (!stats) {
            const note = 'no XP yet — send a few messages and check back.';
            await extra.reply?.(note);
            return { ok: true, summary: note };
        }

        const rnk = xp.rank(self);
        const progressW = Math.min(10, Math.floor((stats.level.current / stats.level.next) * 10));
        const bar = '█'.repeat(progressW) + '░'.repeat(10 - progressW);
        const text = [
            `🏅 *Level ${stats.level.level}*${rnk ? `  ·  rank #${rnk}` : ''}`,
            `${bar} ${stats.level.current}/${stats.level.next} xp to next level`,
            `🔥 streak: ${stats.streak} day${stats.streak === 1 ? '' : 's'} active`,
            `💎 total XP: ${stats.xp}`,
        ].join('\n');

        await extra.reply?.(text);
        return { ok: true, summary: text };
    },
};