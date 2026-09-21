/**
 * cmd/group.js
 *
 * Family of group-management commands, gated by the handler's adminOnly +
 * botAdminNeeded flags (handler.js). Owner is always allowed.
 *
 * Subcommands:
 *   promote|demote|kick   <@mention or number>
 *   add                   <phone number>  (invite only; non-admin members can be added by admins)
 *   link / revoke         get or reset the group invite link
 *   name <title>          set group name
 *   desc <text>           set group description
 *   open / close          toggle who can send messages
 *   tagall [text]         mention everyone
 *   bye                   leave the group (owner only)
 */

const { jidNormalizedUser } = require('@whiskeysockets/baileys');

function cleanNumber(input) {
    const raw = String(input || '');
    const matched = raw.match(/\d+/g);
    const digits = matched ? matched.join('') : '';
    return digits.slice(-12);
}

async function isGroupAdminX(sock, jid, participant) {
    try {
        const meta = await sock.groupMetadata(jid);
        for (const p of meta.participants || []) {
            if (p.admin !== 'admin' && p.admin !== 'superadmin') continue;
            const resolved = p.id.endsWith('@lid')
                ? await sock.signalRepository.lidMapping.getPNForLID(p.id).catch(() => p.id)
                : p.id;
            if (cleanNumber(resolved) === cleanNumber(participant)) return true;
        }
    } catch (_) {}
    return false;
}

async function isOwner(sock, msg) {
    const config = require('../config');
    const jid = (msg.key && (msg.key.participant || msg.key.remoteJid)) || '';
    return config.ownerNumber.includes(cleanNumber(jid));
}

function mentionJids(msg) {
    return msg?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
}

function participantsFromArgs(meta, args) {
    const wanted = new Set(args.map((a) => cleanNumber(a)).filter(Boolean));
    return (meta.participants || []).filter((p) => {
        const num = cleanNumber(p.id);
        return wanted.has(num) || wanted.has(`+${num}`);
    });
}

const jidFor = (p) => (p.lid && p.lid.endsWith('@lid') ? p.lid : p.id || jidNormalizedUser(p.id));

module.exports = {
    name: 'group',
    aliases: ['gc', 'gadmin'],
    category: 'admin',
    description: 'Manage this group (promote, demote, kick, add, link, revoke, name, desc, open, close, tagall, bye).',
    usage: '<action> [targets|text]',
    adminOnly: true,

    async execute(sock, msg, args, extra = {}) {
        const chatId = extra.from || msg.key.remoteJid;
        const action = (args[0] || '').toLowerCase();
        const rest = args.slice(1).join(' ').trim();

        const reply = (text) => (extra.reply ? extra.reply(text) : sock.sendMessage(chatId, { text }, { quoted: msg }));

        if (!action) {
            return reply('usage: `.group <promote|demote|kick|add|link|revoke|name|desc|open|close|tagall|bye>`');
        }

        if (!chatId.endsWith('@g.us')) {
            return reply('this only works inside a group.');
        }

        const isOwnerUser = await isOwner(sock, msg);
        const adminNeeded = new Set(['promote', 'demote', 'kick', 'revoke', 'name', 'desc', 'open', 'close']);
        if (adminNeeded.has(action) && !isOwnerUser) {
            const isAdmin = await isGroupAdminX(sock, chatId, (msg.key.participant || msg.key.remoteJid));
            if (!isAdmin) return reply("only group admins can do that.");
        }

        const botNeedsToBeAdmin = new Set(['promote', 'demote', 'kick', 'add', 'link', 'revoke', 'name', 'desc', 'open', 'close']);
        if (botNeedsToBeAdmin.has(action)) {
            const meta = await sock.groupMetadata(chatId).catch(() => null);
            const botJid = sock.user?.id;
            const botAdmin = (meta?.participants || []).some((p) =>
                (p.admin === 'admin' || p.admin === 'superadmin') && cleanNumber(p.id) === cleanNumber(botJid));
            if (!botAdmin) return reply("I need to be an admin here to do that.");
        }

        try {
            switch (action) {
                case 'promote':
                case 'demote':
                case 'kick': {
                    const meta = await sock.groupMetadata(chatId);
                    const targets = participantsFromArgs(meta, [rest, ...mentionJids(msg)]);
                    if (!targets.length) return reply(`who? reply with \`.group ${action} @mention\` or a number`);
                    const jids = targets.map(jidFor);
                    const result = await sock.groupParticipantsUpdate(chatId, jids, action);
                    const ok = (result || []).filter((r) => r.status && r.status.toLowerCase() !== 'error');
                    return reply(`${action} done for ${ok.length} member${ok.length === 1 ? '' : 's'}.`);
                }

                case 'add': {
                    const number = cleanNumber(rest);
                    if (!number) return reply('give me a phone number to add, like `.group add 263771234567`');
                    const target = `${number}@s.whatsapp.net`;
                    const result = await sock.groupParticipantsUpdate(chatId, [target], 'add');
                    const status = (result && result[0] && result[0].status) || '';
                    if (String(status).toLowerCase().includes('403')) {
                        return reply('that number is a LID-only contact — I can\u2019t add them by number. Ask them to send a join link invite instead.');
                    }
                    return reply(`invite sent to +${number}`);
                }

                case 'link': {
                    const code = await sock.groupInviteCode(chatId);
                    return reply(`🔗 https://chat.whatsapp.com/${code}`);
                }

                case 'revoke': {
                    const code = await sock.groupRevokeInvite(chatId);
                    return reply(`invite link reset 🔄 new link: https://chat.whatsapp.com/${code}`);
                }

                case 'name': {
                    if (!rest) return reply('give me the new name, like `.group name AGENTIC HQ`');
                    await sock.groupUpdateSubject(chatId, rest);
                    return reply(`group renamed to "${rest}".`);
                }

                case 'desc': {
                    if (!rest) return reply('give me the new description, like `.group desc welcome everyone`');
                    await sock.groupUpdateDescription(chatId, rest);
                    return reply('group description updated.');
                }

                case 'open':
                    await sock.groupSettingUpdate(chatId, 'not_announcement');
                    return reply('group opened — everyone can message now.');

                case 'close':
                    await sock.groupSettingUpdate(chatId, 'announcement');
                    return reply('group closed — only admins can message now.');

                case 'tagall': {
                    const meta = await sock.groupMetadata(chatId);
                    const participants = (meta.participants || []).filter((p) => p.id !== sock.user?.id);
                    const mentions = participants.map(jidFor);
                    const leader = mentions.length ? `@${cleanNumber(mentions[0])}` : '';
                    const body = rest || '';
                    await sock.sendMessage(chatId, {
                        text: body ? `${body}\n\n${leader}` : leader,
                        mentions,
                    }, { quoted: msg });
                    return { ok: true, summary: 'tagged everyone in the group.' };
                }

                case 'bye':
                    if (!isOwnerUser) return reply('only the owner can make me leave.');
                    await reply(`alright, I\u2019m out. 👋`);
                    await sock.groupLeave(chatId);
                    return { ok: true, summary: 'left the group.' };

                default:
                    return reply(`unknown action "${action}". Try promote, demote, kick, add, link, revoke, name, desc, open, close, tagall, bye.`);
            }
        } catch (err) {
            console.error(`[GROUP] ${action} failed:`, err.message);
            return reply(`couldn't ${action} — ${err.message}`);
        }
    },
};