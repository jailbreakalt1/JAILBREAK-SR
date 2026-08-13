const config = require('../config');
const { buildCard, buildStatusCard } = require('../tools/style');
const downloadQueue = require('../tools/downloadQueue');
const { getTikTok, sendMediaMessage } = require('../tools/mediaDownloader');

const processedMessages = new Set();

const TIKTOK_PATTERNS = [
  /https?:\/\/(?:www\.|vt\.|m\.|vm\.)?tiktok\.com\//,
  /https?:\/\/(?:www\.)?tiktok\.com\/(?:@[\w.-]+\/video|@[\w.-]+\/photo|v)\/\d+/,
];

module.exports = {
  name: 'tiktok',
  aliases: ['tt', 'ttdl', 'tiktokdl'],
  category: 'media',
  description: 'Download TikTok videos (no watermark)',
  usage: '<TikTok URL>',

  async execute(sock, msg, args, extra = {}) {
    return downloadQueue.run(async () => {
      const chatId = extra.from || msg.key.remoteJid;

      try {
        if (processedMessages.has(msg.key.id)) {
          return { ok: false, reason: 'duplicate', message: 'This message was already processed — skipped.' };
        }
        processedMessages.add(msg.key.id);
        setTimeout(() => processedMessages.delete(msg.key.id), 5 * 60 * 1000);

        const text = msg.message?.conversation ||
                     msg.message?.extendedTextMessage?.text ||
                     args.join(' ');

        if (!text) {
          await extra.reply(buildStatusCard({
            title: 'TIKTOK',
            status: '⫎ Provide a TikTok link.',
            lines: ['Send a video or share link (tiktok.com, vm.tiktok.com, vt.tiktok.com).'],
          }));
          return { ok: false, reason: 'no_query', message: 'No TikTok link was given — asked the user to provide one.' };
        }

        if (!TIKTOK_PATTERNS.some(pattern => pattern.test(text))) {
          await extra.reply(buildStatusCard({
            title: 'TIKTOK',
            status: '❌ Invalid TikTok link.',
            lines: ['Provide a valid tiktok.com video URL.'],
          }));
          return { ok: false, reason: 'invalid_link', message: 'The text did not contain a valid TikTok URL — told the user.' };
        }

        await sock.sendMessage(chatId, { react: { text: '📥', key: msg.key } });

        const media = await getTikTok(text);
        await sendMediaMessage(sock, chatId, media, {
          caption: buildCard({
            title: 'TIKTOK DOWNLOADED',
            lines: [`*DOWNLOADED BY ${config.botName.toUpperCase()}*`],
          }),
          quoted: msg,
        });

        return { ok: true };
      } catch (error) {
        console.error('Error in TikTok command:', error);
        await extra.reply(buildStatusCard({
          title: 'TIKTOK',
          status: '❌ An error occurred.',
          lines: [error?.message || 'Unknown error'],
        }));
        return { ok: false, reason: 'error', message: error?.message };
      }
    });
  }
};