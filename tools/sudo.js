/**
 * Sudo allow command
 * Allow specific commands in the current group even when bot mode is public.
 */

const database = require('../database');

module.exports = {
  name: 'sudo',
  aliases: ['sallow'],
  description: 'Manage per-group command allow list',
  usage: '.sudo <allow|deny|remove|list> [command|all]',
  category: 'owner',
  ownerOnly: true,
  groupOnly: true,

  async execute(sock, msg, args, extra) {
    const groupId = extra.from;
    const sub = (args[0] || 'list').toLowerCase();
    const rawCommand = (args[1] || 'all').toLowerCase();
    const commandName = rawCommand === 'all' ? '*' : rawCommand;

    if (sub === 'allow') {
      database.addGroupCommandAllow(groupId, commandName);
      const label = commandName === '*' ? 'ALL commands' : `.${commandName}`;
      return extra.reply(`✅ Sudo allow saved for this group: *${label}*`);
    }

    if (sub === 'deny' || sub === 'remove' || sub === 'disallow') {
      const removed = database.removeGroupCommandAllow(groupId, commandName);
      const label = commandName === '*' ? 'ALL commands' : `.${commandName}`;
      if (!removed) {
        return extra.reply(`⚠️ No sudo allow entry found for *${label}* in this group.`);
      }
      return extra.reply(`🗑️ Removed sudo allow for *${label}* in this group.`);
    }

    if (sub === 'list') {
      const allowed = database.getAllowedCommandsForGroup(groupId);
      if (!allowed.length) {
        return extra.reply(
          '📭 This group has no sudo allow entries yet.\n\n' +
          'Use:\n' +
          '• .sudo allow <command>\n' +
          '• .sudo allow (allows all commands in this group)'
        );
      }

      const lines = allowed.map((cmd, i) => {
        if (cmd === '*') return `${i + 1}. ALL commands`;
        return `${i + 1}. .${cmd}`;
      });

      return extra.reply(`📌 *Sudo allow list for this group:*\n\n${lines.join('\n')}`);
    }

    return extra.reply(
      '❌ Invalid sudo action.\n\n' +
      'Usage:\n' +
      '• .sudo allow <command>\n' +
      '• .sudo allow\n' +
      '• .sudo remove <command|all>\n' +
      '• .sudo list'
    );
  }
};
