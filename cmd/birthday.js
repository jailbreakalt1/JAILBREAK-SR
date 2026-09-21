/**
 * cmd/birthday.js
 *
 * Store your birthday so the bot can wish you on the day.
 *   .setbirthday <MM/DD or DD-MM or DD.MM>
 *   .birthday            → show yours
 *   .clearbirthday       → remove it
 */

const celebrate = require('../tools/celebrate');
const { cleanJid } = require('../tools/jidUtils');

module.exports = {
    name: 'birthday',
    aliases: ['bday', 'setbirthday', 'clearbirthday'],
    category: 'utility',
    description: 'Set your birthday and get wished on the day.',
    usage: '.setbirthday <MM/DD>  ·  .birthday  ·  .clearbirthday',

    async execute(sock, msg, args, extra = {}) {
        const chatId = extra.from || msg.key.remoteJid;
        const self = cleanJid(extra.sender || (msg.key.participant || msg.key.remoteJid));
        const invoked = ((msg.message?.conversation || msg.message?.extendedTextMessage?.text || '') || '')
            .split(/\s+/)[0]
            .toLowerCase()
            .replace(/^\./, '');

        if (invoked.startsWith('s')) { // setbirthday
            const raw = (args[0] || '').trim();
            if (!raw) {
                await extra.reply?.('give me a date: `.setbirthday 12/25` or `.setbirthday 25-12`');
                return { ok: true };
            }
            const mmdd = celebrate.convertToMmdd(raw);
            const saved = celebrate.setBirthday(self, mmdd);
            if (!saved) {
                await extra.reply?.('that doesn\u2019t look like a date — try `.setbirthday 12/25`');
                return { ok: true };
            }
            const [m, d] = saved.split('-');
            await extra.reply?.(`🎂 got it — ${new Date(2000, +m - 1, +d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}. I\u2019ll wish you on the day.`);
            return { ok: true, summary: `Birthday set to ${saved}.` };
        }

        if (invoked.startsWith('c')) { // clearbirthday
            const ok = celebrate.clearBirthday(self);
            await extra.reply?.(ok ? 'birthday removed.' : 'you didn\u2019t have one set.');
            return { ok: true };
        }

        // .birthday → view own
        const stored = celebrate.getBirthday(self);
        if (!stored) {
            const note = 'you haven\u2019t set a birthday yet — `.setbirthday <MM/DD>`.';
            await extra.reply?.(note);
            return { ok: true, summary: note };
        }
        const [m, d] = stored.split('-');
        await extra.reply?.(`🎂 your birthday: ${new Date(2000, +m - 1, +d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`);
        return { ok: true, summary: `Birthday is ${stored}.` };
    },
};