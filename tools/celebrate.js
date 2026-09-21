/**
 * tools/celebrate.js
 *
 * Birthday wishes. Wired into handler.js — on every message it cheaply checks
 * whether anyone with a stored birthday is celebrating today (in the bot's
 * configured timezone) and pings them once, per birthday.
 *
 * Storage: database/birthdays.json  { phone: "MM-DD", wished: { phone: "YYYY-MM-DD" } }
 */

const fs   = require('fs');
const path = require('path');
const cfg  = require('../config');
const { nowInConfiguredTimezone } = require('./timezone');

const FILE = path.join(__dirname, '..', 'database', 'birthdays.json');

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
        console.error(`[BIRTHDAY] write failed: ${err.message}`);
    }
}

function sanitize(mmdd) {
    const m = String(mmdd || '').trim();
    return /^(\d{1,2})-(\d{1,2})$/.test(m) ? m : null;
}

function convertToMmdd(input) {
    // Accept MM/DD, DD-MM, DD.MM, YYYY-MM-DD, and "March 5"-style text.
    const t = String(input || '').trim();
    if (/^\d{1,2}\/\d{1,2}$/.test(t)) return `${t.replace('/', '-')}`;
    if (/^\d{1,2}-\d{1,2}$/.test(t)) return t;
    if (/^\d{1,2}\.\d{1,2}$/.test(t)) return t.replace('.', '-');
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(t)) return `${t.slice(5, 7)}-${t.slice(8, 10)}`;
    const named = t.match(/^([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?$/);
    if (named) {
        const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
        const m = MONTHS.findIndex(x => x.startsWith(named[1].toLowerCase())) + 1;
        if (m) return `${m}-${named[2]}`;
    }
    return null;
}

function setBirthday(phone, mmdd) {
    const clean = sanitize(mmdd);
    if (!clean) return null;
    const state = read();
    state[phone] = clean;
    write(state);
    return clean;
}

function getBirthday(phone) {
    const state = read();
    return state[phone] || null;
}

function clearBirthday(phone) {
    const state = read();
    if (!state[phone]) return false;
    delete state[phone];
    if (state.wished) delete state.wished[phone];
    write(state);
    return true;
}

function dueToday() {
    const today = nowInConfiguredTimezone().format('MM-DD');
    const state = read();
    const wishedDate = nowInConfiguredTimezone().format('YYYY-MM-DD');
    return Object.entries(state)
        .filter(([phone, mmdd]) => phone !== 'wished' && mmdd === today && state.wished?.[phone] !== wishedDate)
        .map(([phone]) => phone);
}

/**
 * Send birthday wishes to everyone celebrating today, once per day.
 * Called from handler.js on incoming messages — cheap when nobody's due.
 */
async function maybeCelebrate(sock) {
    try {
        const due = dueToday();
        if (!due.length) return 0;

        const wishedDate = nowInConfiguredTimezone().format('YYYY-MM-DD');
        const state = read();
        let sent = 0;

        for (const phone of due) {
            const jid = `${phone}@s.whatsapp.net`;
            try {
                const contact = await sock.getContact(jid).catch(() => ({}));
                const name = (contact && (contact.name || contact.verifiedName || contact.notify)) || '';
                await sock.sendMessage(jid, {
                    text: `🎂 *Happy Birthday${name ? `, ${name}` : ''}!*\n\nWishing you the best day — from JB and the crew. Stay legendary. 🎉`,
                }, { __skipStyle: true });
                state.wished = state.wished || {};
                state.wished[phone] = wishedDate;
                sent += 1;
                console.log(`[BIRTHDAY] wished +${phone}`);
            } catch (err) {
                console.error(`[BIRTHDAY] wish failed for +${phone}: ${err.message}`);
            }
        }

        if (sent) write(state);
        return sent;
    } catch (err) {
        console.error(`[BIRTHDAY] maybeCelebrate error: ${err.message}`);
        return 0;
    }
}

module.exports = { setBirthday, getBirthday, clearBirthday, maybeCelebrate, convertToMmdd };