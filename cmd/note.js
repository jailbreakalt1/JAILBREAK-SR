/**
 * cmd/note.js
 *
 * Private quick notes per user (persisted to database/notes.json).
 *   .note add <text>  |  .note list  |  .note del <n>  |  .note clear
 */

const fs = require('fs');
const path = require('path');
const { cleanJid } = require('../tools/jidUtils');

const FILE = path.join(__dirname, '..', 'database', 'notes.json');
const MAX_NOTES = 50;
const MAX_LEN = 500;

function read() {
    try {
        const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
        return typeof raw === 'object' && raw ? raw : {};
    } catch (_) { return {}; }
}

function write(state) {
    const tmp = FILE + '.tmp';
    try {
        fs.mkdirSync(path.dirname(FILE), { recursive: true });
        fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
        fs.renameSync(tmp, FILE);
    } catch (err) {
        try { fs.unlinkSync(tmp); } catch (_) {}
        console.error(`[NOTES] write failed: ${err.message}`);
    }
}

module.exports = {
    name: 'note',
    aliases: ['notes', 'memo'],
    category: 'utility',
    description: 'Private quick notes.',
    usage: 'add <text> | list | del <n> | clear',

    async execute(sock, msg, args, extra = {}) {
        const chatId = extra.from || msg.key.remoteJid;
        const user = cleanJid(extra.sender || (msg.key.participant || msg.key.remoteJid));
        const action = (args[0] || 'list').toLowerCase();
        const state = read();
        const mine = Array.isArray(state[user]) ? state[user] : [];

        const reply = async (t) => { await (extra.reply ? extra.reply(t) : sock.sendMessage(chatId, { text: t }, { quoted: msg })); return { ok: true }; };

        switch (action) {
            case 'add': {
                const text = args.slice(1).join(' ').trim();
                if (!text) return reply('usage: `.note add <text>`');
                if (mine.length >= MAX_NOTES) return reply(`note folder full (max ${MAX_NOTES}). delete some first.`);
                mine.push({ id: mine.length + 1, text: text.slice(0, MAX_LEN), at: Date.now() });
                state[user] = mine;
                write(state);
                return reply(`memorised note #${mine.length}.`);
            }

            case 'list':
            case 'ls': {
                if (!mine.length) return reply('no notes yet — `.note add buy milk`');
                const lines = mine.map((n) => `#${n.id} · ${n.text}`);
                return reply(`📝 *Your notes (${mine.length})*\n` + lines.join('\n'));
            }

            case 'del':
            case 'delete': {
                const idx = parseInt(args[1], 10);
                const found = mine.find((n) => n.id === idx);
                if (!found) return reply(`no note #${idx}.`);
                const next = mine.filter((n) => n !== found).map((n, i) => ({ ...n, id: i + 1 }));
                state[user] = next;
                write(state);
                return reply(`deleted note #${idx}.`);
            }

            case 'clear':
                state[user] = [];
                write(state);
                return reply('all notes cleared.');

            default:
                return reply('usage: `.note add <text> | list | del <n> | clear`');
        }
    },
};