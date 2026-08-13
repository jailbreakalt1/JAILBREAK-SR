const config = require('../config');
const { buildCard, buildStatusCard } = require('../tools/style');
const downloadQueue = require('../tools/downloadQueue');
const { getFacebook, sendMediaMessage } = require('../tools/mediaDownloader');

module.exports = {
  name: 'facebook',
  aliases: ['fb', 'fbdl', 'facebookdl'],
  category: 'media',
  description: 'Download Facebook videos',
  usage: '<Facebook URL>',

  async execute(sock, msg, args, extra = {}) {
    return downloadQueue.run(async () => {
      const chatId = extra.from || msg.key.remoteJid;

      try {
        const text = msg.message?.conversation ||
                     msg.message?.extendedTextMessage?.text ||
                     args.join(' ');

        if (!text) {
          await extra.reply(buildStatusCard({
            title: 'FACEBOOK',
            status: '⫎ Provide a Facebook video link.',
            lines: ['Send a public video URL.'],
          }));
          return { ok: false, reason: 'no_query' };
        }

        if (!/https?:\/\/(?:www\.)?(?:facebook\.com|fb\.watch|fb\.com)\//i.test(text)) {
          await extra.reply(buildStatusCard({
            title: 'FACEBOOK',
            status: '❌ Invalid Facebook link.',
            lines: ['Provide a valid Facebook video URL.'],
          }));
          return { ok: false, reason: 'invalid_link' };
        }

        await sock.sendMessage(chatId, { react: { text: '📥', key: msg.key } });

        const media = await getFacebook(text);
        await sendMediaMessage(sock, chatId, media, {
          caption: buildCard({
            title: 'FACEBOOK DOWNLOADED',
            lines: [`*DOWNLOADED BY ${config.botName.toUpperCase()}*`],
          }),
          quoted: msg,
        });

        return { ok: true };
      } catch (error) {
        console.error('Error in Facebook command:', error);
        await extra.reply(buildStatusCard({
          title: 'FACEBOOK',
          status: '❌ An error occurred.',
          lines: [error?.message || 'Unknown error'],
        }));
        return { ok: false, reason: 'error', message: error?.message };
      }
    });
  }
};
