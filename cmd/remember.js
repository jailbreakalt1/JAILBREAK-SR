/**
 * cmd/remember.js
 *
 * Explicitly teach the bot persistent facts.
 *   .remember <key> <value>   → store (e.g. .remember music_taste amapiano)
 *   .forget <key>             → remove one
 *   .profile                  → show everything stored about this chat
 *   .forgetall                → wipe this chat's stored facts
 *
 * Facts land in the same store the AI uses (brain/userProfiles), so they
 * show up in every future conversation here.
 */

const userProfiles = require('../brain/userProfiles');

module.exports = {
    name: 'remember',
    aliases: ['profile', 'memorize', 'rememberme', 'forgetall'],
    category: 'utility',
    description: 'Teach the bot facts it will remember about you.',
    usage: '.remember <key> <value>  ·  .forget <key>  ·  .profile  ·  .forgetall',

    async execute(sock, msg, args, extra = {}) {
        const chatId = extra.from || msg.key.remoteJid;
        const invoked = ((msg.message?.conversation || msg.message?.extendedTextMessage?.text || '') || '')
            .split(/\s+/)[0]
            .toLowerCase()
            .replace(/^\./, '');

        if (invoked === 'profile') {
            const facts = userProfiles.get(chatId);
            const entries = Object.entries(facts);
            const text = !entries.length
                ? 'nothing stored here yet — `.remember key value` to teach me things.'
                : `🧠 *What I know about this chat:*\n` + entries.map(([k, v]) => `  • ${k}: ${v}`).join('\n');
            await extra.reply?.(text);
            return { ok: true, summary: text };
        }

        if (invoked === 'forgetall') {
            userProfiles.clear(chatId);
            await extra.reply?.('forgot everything about this chat.');
            return { ok: true, summary: 'profile cleared.' };
        }

        if (invoked === 'forget') {
            const key = args[0];
            if (!key) {
                await extra.reply?.('which fact? `.forget <key>`');
                return { ok: true };
            }
            userProfiles.save(chatId, { [key]: '' });
            await extra.reply?.(`forgot "${key.toLowerCase()}".`);
            return { ok: true, summary: `forgot ${key}.` };
        }

        // remember
        const key = args[0];
        const value = args.slice(1).join(' ').trim();
        if (!key) {
            await extra.reply?.('usage: `.remember <key> <value>` — e.g. `.remember city Harare`\n(.remember <key> with no value removes it)');
            return { ok: true };
        }
        if (!value) {
            userProfiles.save(chatId, { [key]: '' });
            await extra.reply?.(`forgot "${key.toLowerCase()}".`);
            return { ok: true, summary: `forgot ${key}.` };
        }
        userProfiles.save(chatId, { [key]: value });
        await extra.reply?.(`noted: ${key.toLowerCase()} = ${value}`);
        return { ok: true, summary: `Stored ${key} = ${value}.` };
    },
};