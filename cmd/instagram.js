const config = require('../config');
const apiTools = require('../tools/api');

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
        await extra.reply('Please provide an Instagram link for the video.');
        processedMessages.delete(msg.key.id);
        return { ok: false, reason: 'no_query', message: 'No Instagram link was given — asked the user to provide one.' };
      }

      const isValidUrl = INSTAGRAM_PATTERNS.some(pattern => pattern.test(text));

      if (!isValidUrl) {
        await extra.reply('That is not a valid Instagram link. Please provide a valid Instagram post, reel, or video link.');
        processedMessages.delete(msg.key.id);
        return { ok: false, reason: 'invalid_link', message: 'The text did not contain a valid Instagram URL — told the user.' };
      }

      await sock.sendMessage(chatId, {
        react: { text: '\uD83D\uDCE5', key: msg.key }
      });

      const manifest = await apiTools.getBackendSocialManifest(text);

      if (!manifest || !manifest.items || manifest.items.length === 0) {
        await extra.reply('\u274C No media found at the provided link. The post might be private or the link is invalid.');
        processedMessages.delete(msg.key.id);
        return { ok: false, reason: 'not_found', message: 'No media returned for that link — the post may be private or the link is invalid.' };
      }

      const mediaToDownload = manifest.items.slice(0, 20);

      let sentCount = 0;
      const caption = `*DOWNLOADED BY ${config.botName.toUpperCase()}*`;

      for (let i = 0; i < mediaToDownload.length; i++) {
        try {
          const media = mediaToDownload[i];
          let buffer = media.buffer;
          let mimetype = media.mimetype || (media.type === 'video' ? 'video/mp4' : 'image/jpeg');

          if (!buffer) {
            const fetched = await apiTools.fetchSocialItem(media.url);
            if (!fetched.buffer.length) continue;
            buffer = fetched.buffer;
            mimetype = fetched.mimetype || mimetype;
          }

          if (media.type === 'video') {
            await sock.sendMessage(chatId, {
              video: buffer,
              mimetype: 'video/mp4',
              caption
            }, { quoted: msg });
          } else {
            await sock.sendMessage(chatId, {
              image: buffer,
              caption
            }, { quoted: msg });
          }

          sentCount++;

          if (i < mediaToDownload.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }

        } catch (mediaError) {
          console.error(`Error downloading media ${i + 1}:`, mediaError);
        }
      }

      if (sentCount === 0) {
        await extra.reply(`\u274C Found media but all downloads failed. Try again in ${config.spam.duplicateCooldown}s.`);
        processedMessages.delete(msg.key.id);
        return { ok: false, reason: 'download_failed', message: 'All media items failed to send despite being found.' };
      }

      processedMessages.delete(msg.key.id);
      return { ok: true };

    } catch (error) {
      console.error('Error in Instagram command:', error);
      processedMessages.delete(msg.key.id);
      await extra.reply(`\u274C An error occurred while processing the Instagram request. Try again in ${config.spam.duplicateCooldown}s.`);
      return { ok: false, reason: 'error', message: error?.message || 'Unknown error' };
    }
  }
};