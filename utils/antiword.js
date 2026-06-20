/**
 * Antiword Command - Toggle bad word filter with delete/kick options
 */

const database = require('../database');

module.exports = {
  name: 'antiword',
  aliases: [],
  category: 'admin',
  description: 'Configure bad word filter (delete/kick)',
  usage: '.antiword <on/off/set/get>',
  groupOnly: true,
  adminOnly: true,
  botAdminNeeded: true,

  async execute(sock, msg, args, extra) {
    try {
      if (!args[0]) {
        const settings = database.getGroupSettings(extra.from);
        const status = settings.antiword ? 'ON' : 'OFF';
        const action = settings.antiwordAction || 'delete';
        return extra.reply(
          `🛡️ *Antiword Status*\n\n` +
          `Status: *${status}*\n` +
          `Action: *${action}*\n\n` +
          `Usage:\n` +
          `  .antiword on\n` +
          `  .antiword off\n` +
          `  .antiword set delete | kick\n` +
          `  .antiword get`
        );
      }

      const opt = args[0].toLowerCase();

      if (opt === 'on') {
        if (database.getGroupSettings(extra.from).antiword) {
          return extra.reply('*Antiword is already on*');
        }
        database.updateGroupSettings(extra.from, { antiword: true });
        return extra.reply('*Antiword has been turned ON*');
      }

      if (opt === 'off') {
        database.updateGroupSettings(extra.from, { antiword: false });
        return extra.reply('*Antiword has been turned OFF*');
      }

      if (opt === 'set') {
        if (args.length < 2) {
          return extra.reply('*Please specify an action: .antiword set delete | kick*');
        }

        const setAction = args[1].toLowerCase();
        if (!['delete', 'kick'].includes(setAction)) {
          return extra.reply('*Invalid action. Choose delete or kick.*');
        }

        database.updateGroupSettings(extra.from, {
          antiwordAction: setAction,
          antiword: true
        });
        return extra.reply(`*Antiword action set to ${setAction}*`);
      }

      if (opt === 'get') {
        const settings = database.getGroupSettings(extra.from);
        const status = settings.antiword ? 'ON' : 'OFF';
        const action = settings.antiwordAction || 'delete';
        return extra.reply(`*Antiword Configuration:*\nStatus: ${status}\nAction: ${action}`);
      }

      return extra.reply('*Use .antiword for usage.*');

    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
