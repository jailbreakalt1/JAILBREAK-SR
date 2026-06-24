/**
 * Antispam Command - Toggle spam protection (duplicate filter + rate limit)
 */

const database = require('../database');
const config = require('../config');

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
      const windowMin = Math.round(config.spam.perUserWindow / 60);

      if (!args[0]) {
        const settings = database.getGroupSettings(extra.from);
        const status = settings.antispam ? 'ON' : 'OFF';
        return extra.reply(
          `🛡️ *Antispam Status*\n\n` +
          `Status: *${status}*\n\n` +
          `When ON, this protects the group against:\n` +
          `  • *Duplicate commands* - the exact same command+args is blocked if repeated within ${config.spam.duplicateCooldown}s (stops accidental double-taps).\n` +
          `  • *Rapid command spam* - more than ${config.spam.perUserLimit} commands from one person within ${windowMin} min triggers a warning, then a 5-min mute after ${config.spam.maxWarnings} warnings.\n` +
          `  • *Global bot flood* - if the whole group sends over ${config.spam.globalLimit} commands/min combined, the bot briefly slows down so it doesn't crash or get rate-limited by WhatsApp.\n\n` +
          `The bot owner is always exempt from these limits.\n\n` +
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
        return extra.reply(
          `*Antispam Configuration:*\nStatus: ${status}\n\n` +
          `Duplicate cooldown: ${config.spam.duplicateCooldown}s (same command+args blocked if repeated within this window)\n` +
          `Rate limit: ${config.spam.perUserLimit} commands / ${windowMin} min per user (then warnings → mute)\n` +
          `Max warnings before mute: ${config.spam.maxWarnings}\n` +
          `Global pace: ${config.spam.globalLimit} commands / min across the whole group`
        );
      }

      return extra.reply('*Use .antispam for usage.*');

    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
