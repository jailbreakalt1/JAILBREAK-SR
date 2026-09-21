/**
 * cmd/ban.js
 *
 * Ban / unban a number from talking to the bot (owner only).
 * Banned numbers are silently ignored; ban enforcement lives in handler.js.
 *   .ban <number> [reason]   |   .unban <number>   |   .banlist
 */

const blacklist = require('../tools/blacklist');
const { cleanJid } = require('../tools/jidUtils');

module.exports = {
    name: 'ban',
    aliases: ['blockuser'],
    category: 'owner',
    description: 'Ban or unban a number from using the bot (owner only).',
    usage: 'ban <number> [reason] | unban <number> | ban list',
    ownerOnly: true,

    async execute(sock, msg, args, extra = {}) {
        const chatId = extra.from || msg.key.remoteJid;
        const action = (args[0] || '').toLowerCase();
        const rest = args.slice(1);

        if (action === 'list' || action === 'ls' || action === 'show') {
            const rows = blacklist.list();
            const text = rows.length
                ? `🚫 *Banned:*\n` + rows.map(([p, r]) => `• ${p} — ${r.reason || 'no reason'}`).join('\n')
                : 'no banned numbers.';
            await extra.reply?.(text);
            return { ok: true, summary: text };
        }

        if (action === 'unban') {
            const num = cleanJid(rest[0] || '');
            if (!num) {
                await extra.reply?.('give me a number: `.ban unban 2637...`');
                return { ok: true };
            }
            const ok = blacklist.unban(num);
            await extra.reply?.(ok ? `unbanned +${num}` : `+${num} wasn't banned.`);
            return { ok: true };
        }

        // default: ban
        const num = cleanJid(action);
        const reason = rest.join(' ').trim();
        if (!num || num.replace(/^\d+$/, '') !== '') {
            await extra.reply?.('usage: `.ban <number> [reason]`, `.ban unban <number>`, `.ban list`');
            return { ok: true };
        }
        blacklist.ban(num, 'owner', reason);
        console.log(`[BAN] banned +${num} (${reason || 'no reason'})`);
        await extra.reply?.(`banned +${num}${reason ? ` — ${reason}` : ''}. said bye.`);
        return { ok: true, summary: `Banned +${num}.` };
    },
};