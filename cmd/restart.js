/**
 * cmd/restart.js
 *
 * Restart the bot (owner only). start.sh runs node in a loop, so exiting the
 * process cleanly brings it straight back up with fresh code.
 */

module.exports = {
    name: 'restart',
    aliases: ['reboot', 'respawn'],
    category: 'owner',
    description: 'Restart the bot (owner only).',
    usage: '',
    ownerOnly: true,

    async execute(sock, msg, args, extra = {}) {
        const chatId = extra.from || msg.key.remoteJid;
        await extra.reply?.('🔄 restarting… back in a few seconds.');
        setTimeout(() => process.exit(0), 600);
        return { ok: true, summary: 'restarting.' };
    },
};