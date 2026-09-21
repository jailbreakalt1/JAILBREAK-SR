/**
 * cmd/recap.js
 *
 * Local recap of recent conversation context for this chat (no model call —
 * free and instant). Shows the last handful of turns stored for this chat
 * plus any stored facts.
 */

const memory       = require('../brain/memory');
const userProfiles = require('../brain/userProfiles');

module.exports = {
    name: 'recap',
    aliases: ['context', 'recapchat'],
    category: 'utility',
    description: 'Show what I remember of our recent conversation.',
    usage: '',

    async execute(sock, msg, args, extra = {}) {
        const chatId = extra.from || msg.key.remoteJid;
        const turns = memory.get(chatId);
        const facts = Object.entries(userProfiles.get(chatId));

        const lines = [];
        if (facts.length) {
            lines.push('🧠 *Remembered facts*');
            facts.forEach(([k, v]) => lines.push(`  • ${k}: ${v}`));
            lines.push('');
        }

        const recent = (Array.isArray(turns) ? turns : []).slice(-8);
        if (recent.length) {
            lines.push('💬 *Recent context*');
            for (const t of recent) {
                const content = (t.content || '');
                const short = content.length > 120 ? `${content.slice(0, 120)}…` : content;
                lines.push(`• ${t.role === 'user' ? '🧑 you' : '🤖 JB'}: ${short}`);
            }
        }

        const text = recent.length || facts.length
            ? lines.join('\n')
            : 'no saved context for this chat yet — say anything to start one.';

        await extra.reply?.(text);
        return { ok: true, summary: text };
    },
};