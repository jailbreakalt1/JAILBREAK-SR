/**
 * Menu Command - Dynamically lists every loaded command.
 *
 * This does NOT hardcode a command list. It reads the live command
 * registry (via extra.getCommands(), supplied by handler.js) at the
 * moment the command runs, so any command file you drop into /cmd
 * or /tools is picked up automatically - nothing here needs editing
 * when you add, remove, or rename a command.
 */

const config = require('../config');

const CATEGORY_META = {
  general: { label: 'GENERAL', emoji: '◈' },
  cmd: { label: 'CMD', emoji: '🎬' },
  admin: { label: 'GROUP ADMIN', emoji: '🛡️' },
  owner: { label: 'OWNER', emoji: '👑' },
  misc: { label: 'MISC', emoji: '✦' },
};

function categoryMeta(category) {
  const key = (category || 'misc').toLowerCase();
  return CATEGORY_META[key] || { label: key.toUpperCase(), emoji: '✦' };
}

module.exports = {
  name: 'menu',
  aliases: ['help', 'list', 'commands'],
  category: 'general',
  description: 'Show all available commands',
  usage: '.menu',

  async execute(sock, msg, args, extra = {}) {
    const from = extra.from || msg.key.remoteJid;

    if (typeof extra.getCommands !== 'function') {
      return extra.reply
        ? extra.reply('❌ Could not load the command registry.')
        : sock.sendMessage(from, { text: '❌ Could not load the command registry.' }, { quoted: msg });
    }

    // The registry maps both names AND aliases to the same command
    // object, so dedupe by object reference before grouping.
    const allEntries = extra.getCommands();
    const seen = new Set();
    const uniqueCommands = [];
    for (const cmd of allEntries.values()) {
      if (seen.has(cmd)) continue;
      seen.add(cmd);
      uniqueCommands.push(cmd);
    }

    // Group by category, sort alphabetically within each group.
    const grouped = new Map();
    for (const cmd of uniqueCommands) {
      const key = (cmd.category || 'misc').toLowerCase();
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(cmd);
    }
    for (const list of grouped.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }

    // Order: general, cmd, admin, owner, then anything else alphabetically.
    const preferredOrder = ['general', 'cmd', 'admin', 'owner'];
    const remaining = [...grouped.keys()]
      .filter(k => !preferredOrder.includes(k))
      .sort();
    const order = [...preferredOrder.filter(k => grouped.has(k)), ...remaining];

    const senderJid = extra.sender || msg.key.participant || msg.key.remoteJid;
    const senderNum = (senderJid || '').split('@')[0];

    let text = `⧯ *${config.botName}* 𝙼𝙴𝙽𝚄 ⧯\n`;
    text += `⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯\n`;
    text += `◈ *PREFIX :* \`${config.prefix}\`\n`;
    text += `◈ *COMMANDS :* \`${uniqueCommands.length}\`\n`;
    text += `⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯\n`;

    for (const key of order) {
      const meta = categoryMeta(key);
      text += `\n${meta.emoji} *${meta.label}*\n`;
      for (const cmd of grouped.get(key)) {
        const aliasText = cmd.aliases && cmd.aliases.length
          ? ` _(${cmd.aliases.join(', ')})_`
          : '';
        text += `  ▸ ${config.prefix}${cmd.name}${aliasText} — ${cmd.description || 'no description'}\n`;
      }
    }

    text += `\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯\n`;
    text += `⎆ @${senderNum} _use ${config.prefix}<command> to run one_\n`;
    text += `> ☬ *𝚂𝙾𝚄𝚁𝙲𝙴 :* 𝙹𝙰𝙸𝙻𝙱𝚁𝙴𝙰𝙺 ☬`;

    await sock.sendMessage(from, {
      text,
      mentions: senderJid ? [senderJid] : [],
    }, { quoted: msg });
  },
};
