const config = require('../config');
const { buildCard, buildStatusCard } = require('../tools/style');
const downloadQueue = require('../tools/downloadQueue');
const { getInstagram, sendMediaMessage } = require('../tools/mediaDownloader');

const processedMessages = new Set();

const INSTAGRAM_PATTERNS = [
  /https?:\/\/(?:www\.)?instagram\.com\//,
  /https?:\/\/(?:www\.)?instagr\.am\//,
  /https?:\/\/(?:www\.)?instagram\.com\/p\//,
  /https?:\/\/(?:www\.)?instagram\.com\/reel\//,
  /https?:\/\/(?:www\.)?instagram\.com\/tv\//,
];

module.exports = {
  name: 'instagram',
  aliases: ['ig', 'insta', 'igdl', 'reels'],
  category: 'media',
  description: 'Download Instagram photos/videos/reels',
  usage: '<Instagram URL>',

  async execute(sock, msg, args, extra = {}) {
    return downloadQueue.run(async () => {
      const chatId = extra.from || msg.key.remoteJid;

      try {
        if (processedMessages.has(msg.key.id)) {
          return { ok: false, reason: 'duplicate', message: 'This message was already processed — skipped.' };
        }

        processedMessages.add(msg.key.id);

        setTimeout(() => {
          processedMessages.delete(msg.key.id);
        }, 5 * 60 * 1000);

        const text = msg.message?.conversation ||
                     msg.message?.extendedTextMessage?.text ||
                     args.join(' ');

        if (!text) {
          await extra.reply(buildStatusCard({
            title: 'INSTAGRAM',
            status: '⫎ Provide an Instagram link.',
            lines: ['Send a post, reel, or video URL.'],
          }));
          return { ok: false, reason: 'no_query', message: 'No Instagram link was given — asked the user to provide one.' };
        }

        const isValidUrl = INSTAGRAM_PATTERNS.some(pattern => pattern.test(text));

        if (!isValidUrl) {
          await extra.reply(buildStatusCard({
            title: 'INSTAGRAM',
            status: '❌ Invalid Instagram link.',
            lines: ['Provide a valid post, reel, or video URL.'],
          }));
          return { ok: false, reason: 'invalid_link', message: 'The text did not contain a valid Instagram URL — told the user.' };
        }

        await sock.sendMessage(chatId, {
          react: { text: '📥', key: msg.key }
        });

        const media = await getInstagram(text);
        await sendMediaMessage(sock, chatId, media, {
          caption: buildCard({
            title: 'INSTAGRAM DOWNLOADED',
            lines: [`*DOWNLOADED BY ${config.botName.toUpperCase()}*`],
          }),
          quoted: msg,
        });

        return { ok: true };
      } catch (error) {
        console.error('Error in Instagram command:', error);
        const msg = error?.message || 'Unknown error';
        await extra.reply(buildStatusCard({
          title: 'INSTAGRAM',
          status: '❌ An error occurred.',
          lines: [msg],
        }));
        return { ok: false, reason: 'error', message: msg };
      }
    });
  }
};
