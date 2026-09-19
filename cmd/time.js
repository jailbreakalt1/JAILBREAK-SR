/**
 * cmd/time.js
 *
 * Returns the current date and time in Zimbabwe (Africa/Harare, CAT UTC+2).
 * Works as a direct command (.time) and as a brain-triggered action that
 * returns { summary } for JB to relay naturally.
 *
 * No external API needed — moment-timezone is already in package.json.
 */

const { nowInConfiguredTimezone, resolveTimezone } = require('../tools/timezone');

// Day/month labels so JB can speak naturally
const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function getTimeData() {
    const now = nowInConfiguredTimezone();
    const tz   = resolveTimezone();          // 'Africa/Harare'
    const country = 'Zimbabwe';              // human label — timezone is ZW-specific

    return {
        hour:        now.hours(),
        minute:      now.minutes(),
        second:      now.seconds(),
        day:         DAYS[now.day()],
        date:        now.date(),
        month:       MONTHS[now.month()],
        year:        now.year(),
        formatted12: now.format('h:mm A'),  // e.g. "3:45 PM"
        formatted24: now.format('HH:mm'),   // e.g. "15:45"
        full:        now.format('dddd, D MMMM YYYY · HH:mm:ss'),
        tz,
        country,
    };
}

/**
 * Compact natural-language summary for the brain to rephrase.
 * Includes a time-of-day hint so JB can say "morning" / "evening" etc.
 */
function buildBrainSummary(d) {
    let period;
    if      (d.hour >= 5  && d.hour < 12) period = 'morning';
    else if (d.hour >= 12 && d.hour < 17) period = 'afternoon';
    else if (d.hour >= 17 && d.hour < 21) period = 'evening';
    else                                   period = 'night';

    return (
        `Current time in ${d.country} (${d.tz}): ` +
        `${d.formatted12} (${d.formatted24}), ${period}. ` +
        `Today is ${d.day}, ${d.date} ${d.month} ${d.year}.`
    );
}

/** Formatted card for direct .time command replies */
function buildCard(d) {
    return (
`╔════════════════════╗
   ╼ 𝚉𝙸𝙼𝙱𝙰𝙱𝚆𝙴 𝚃𝙸𝙼𝙴 ╾
╚════════════════════╝
⎛
  ◈ 𝙻𝙾𝙲𝙰𝚃𝙸𝙾𝙽 : \`${d.country} (CAT · UTC+2)\`
  ◈ 𝚃𝙸𝙼𝙴     : \`${d.formatted12}  /  ${d.formatted24}\`
  ◈ 𝙳𝙰𝚃𝙴     : \`${d.day}, ${d.date} ${d.month} ${d.year}\`
⎝`
    );
}

module.exports = {
    name: 'time',
    aliases: ['clock', 'date', 'now'],
    category: 'public',
    description: 'Show the current time and date in Zimbabwe.',
    usage: '.time',

    async execute(sock, msg, args, extra = {}) {
        const { reply } = extra;
        const from = extra.from || msg.key.remoteJid;

        const data = getTimeData();

        // Brain-triggered: return summary for relay
        if (extra.__brainCall) {
            return { summary: buildBrainSummary(data) };
        }

        // Direct command: send card
        await sock.sendMessage(from, { text: buildCard(data) }, { quoted: msg });
    },
};
