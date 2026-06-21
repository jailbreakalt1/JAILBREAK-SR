/**
 * Antispam Command - Toggle spam protection (duplicate filter + rate limit)
 */

const database = require('../database');

module.exports = {
  name: 'antispam',
  aliases: [],
  category: 'admin',
  description: 'Configure spam protection (duplicate/rate limit)',
  usage: '.antispam <on/off/get>',
  groupOnly: true,
  adminOnly: true,
  botAdminNeeded: true,

  async execute(sock, msg, args, extra) {
    try {
      if (!args[0]) {
        const settings = database.getGroupSettings(extra.from);
        const status = settings.antispam ? 'ON' : 'OFF';
        return extra.reply(
          `🛡️ *Antispam Status*\n\n` +
          `Status: *${status}*\n\n` +
          `Protects against:\n` +
          `  • Duplicate commands (same cmd <60s)\n` +
          `  • Rapid command spam (5/30s per user)\n` +
          `  • Global bot flood (30/min, auto-paces)\n\n` +
          `Usage:\n` +
          `  .antispam on\n` +
          `  .antispam off\n` +
          `  .antispam get`
        );
      }

      const opt = args[0].toLowerCase();

      if (opt === 'on') {
        if (database.getGroupSettings(extra.from).antispam) {
          return extra.reply('*Antispam is already on*');
        }
        database.updateGroupSettings(extra.from, { antispam: true });
        return extra.reply('*Antispam has been turned ON*');
      }

      if (opt === 'off') {
        database.updateGroupSettings(extra.from, { antispam: false });
        return extra.reply('*Antispam has been turned OFF*');
      }

      if (opt === 'get') {
        const settings = database.getGroupSettings(extra.from);
        const status = settings.antispam ? 'ON' : 'OFF';
        return extra.reply(`*Antispam Configuration:*\nStatus: ${status}\n\nDuplicate cooldown: 60s\nRate limit: 5 cmd / 30s per user\nGlobal pace: 30 cmd / min`);
      }

      return extra.reply('*Use .antispam for usage.*');

    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
