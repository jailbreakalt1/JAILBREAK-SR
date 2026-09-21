/**
 * cmd/todo.js
 *
 * Private to-do list per user (persisted to database/todos.json).
 *   .todo                  → list
 *   .todo add <task>       → add
 *   .todo done <n>         → tick off
 *   .todo del <n>          → remove
 *   .todo clear            → wipe
 */

const fs = require('fs');
const path = require('path');
const { cleanJid } = require('../tools/jidUtils');

const FILE = path.join(__dirname, '..', 'database', 'todos.json');
const MAX_TODOS = 40;
const MAX_LEN = 300;

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
        console.error(`[TODO] write failed: ${err.message}`);
    }
}

module.exports = {
    name: 'todo',
    aliases: ['tasks', 'tdlist'],
    category: 'utility',
    description: 'Private to-do list.',
    usage: 'add <task> | done <n> | del <n> | clear | (no arg = list)',

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
                if (!text) return reply('usage: `.todo add <task>`');
                if (mine.length >= MAX_TODOS) return reply(`to-do list full (max ${MAX_TODOS}).`);
                mine.push({ id: mine.length + 1, text: text.slice(0, MAX_LEN), done: false, at: Date.now() });
                state[user] = mine;
                write(state);
                return reply(`added task #${mine.length}.`);
            }

            case 'list':
            case 'ls':
            default: {
                if (!mine.length) return reply('nothing on the list — `.todo add something`');
                const chips = mine.map((n) => `${n.done ? '✅' : '⬜'} #${n.id} · ${n.text}`);
                const done = mine.filter((n) => n.done).length;
                return reply(`📋 *To-do (${done}/${mine.length} done)*\n` + chips.join('\n'));
            }

            case 'done':
            case 'finish': {
                let idx = parseInt(args[1], 10);
                let task = mine.find((n) => n.id === idx);
                if (!task && !Number.isInteger(idx)) {
                    const q = args.slice(1).join(' ').toLowerCase().trim();
                    task = mine.find((n) => n.text.toLowerCase().includes(q));
                    if (task) idx = task.id;
                }
                if (!task) return reply(`no task "${args.slice(1).join(' ') || '?'}" on the list.`);
                task.done = !task.done;
                state[user] = mine;
                write(state);
                return reply(`task #${idx} marked ${task.done ? 'done ✅' : 'not done'}.`);
            }

            case 'del':
            case 'delete': {
                let idx = parseInt(args[1], 10);
                let found = mine.find((n) => n.id === idx);
                if (!found && !Number.isInteger(idx)) {
                    const q = args.slice(1).join(' ').toLowerCase().trim();
                    found = mine.find((n) => n.text.toLowerCase().includes(q));
                    if (found) idx = found.id;
                }
                if (!found) return reply(`no task "${args.slice(1).join(' ') || '?'}" on the list.`);
                const next = mine.filter((n) => n !== found).map((n, i) => ({ ...n, id: i + 1 }));
                state[user] = next;
                write(state);
                return reply(`deleted task #${idx}.`);
            }

            case 'clear':
                state[user] = [];
                write(state);
                return reply('to-do list cleared.');
        }
    },
};