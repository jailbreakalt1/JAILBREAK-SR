const config = require('../config');
const { buildCard, buildStatusCard } = require('../tools/style');
const downloadQueue = require('../tools/downloadQueue');
const { getPinterest, sendMediaMessage } = require('../tools/mediaDownloader');

const processedMessages = new Set();

module.exports = {
  name: 'pinterest',
  aliases: ['pin', 'pindl', 'pinterestdl'],
  category: 'media',
  description: 'Download Pinterest images/videos',
  usage: '<Pinterest URL>',

  async execute(sock, msg, args, extra = {}) {
    return downloadQueue.run(async () => {
      const chatId = extra.from || msg.key.remoteJid;

      try {
        if (processedMessages.has(msg.key.id)) {
          return { ok: false, reason: 'duplicate' };
        }
        processedMessages.add(msg.key.id);
        setTimeout(() => processedMessages.delete(msg.key.id), 5 * 60 * 1000);

        const text = msg.message?.conversation ||
                     msg.message?.extendedTextMessage?.text ||
                     args.join(' ');

        if (!text) {
          await extra.reply(buildStatusCard({
            title: 'PINTEREST',
            status: '⫎ Provide a Pinterest pin link.',
            lines: ['Send a pin, board, or video URL.'],
          }));
          return { ok: false, reason: 'no_query' };
        }

        if (!/https?:\/\/(?:www\.)?pinterest\.(?:com|ca|co\.uk|fr|de|es|it|jp|au|nz|mx)\//i.test(text)) {
          await extra.reply(buildStatusCard({
            title: 'PINTEREST',
            status: '❌ Invalid Pinterest link.',
            lines: ['Provide a valid Pinterest pin URL.'],
          }));
          return { ok: false, reason: 'invalid_link' };
        }

        await sock.sendMessage(chatId, { react: { text: '📥', key: msg.key } });

        const media = await getPinterest(text);
        await sendMediaMessage(sock, chatId, media, {
          caption: buildCard({
            title: 'PINTEREST DOWNLOADED',
            lines: [`*DOWNLOADED BY ${config.botName.toUpperCase()}*`],
          }),
          quoted: msg,
        });

        return { ok: true };
      } catch (error) {
        console.error('Error in Pinterest command:', error);
        await extra.reply(buildStatusCard({
          title: 'PINTEREST',
          status: '❌ An error occurred.',
          lines: [error?.message || 'Unknown error'],
        }));
        return { ok: false, reason: 'error', message: error?.message };
      }
    });
  }
};
