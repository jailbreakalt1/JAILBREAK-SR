const config = require('../config');

const processedMessages = new Set();

async function instaDownload(url) {
  const response = await fetch('https://api.instasave.website/media', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Origin': 'https://instasave.website',
      'Referer': 'https://instasave.website/'
    },
    body: 'url=' + encodeURIComponent(url),
    signal: AbortSignal.timeout(20000)
  });

  if (!response.ok) {
    throw new Error('API returned status ' + response.status);
  }

  const text = await response.text();
  const tokens = text.match(/https:\/\/cdn\.instasave\.website\/\?token=[a-zA-Z0-9_\-\.]+/g);

  if (!tokens || tokens.length === 0) {
    throw new Error('No media found in API response');
  }

  const mediaItems = [];

  for (const token of tokens) {
    const tokenParam = token.split('?token=')[1];
    const parts = tokenParam.split('.');
    if (parts.length < 2) continue;

    let payload = parts[1];
    payload = payload.replace(/-/g, '+').replace(/_/g, '/');
    while (payload.length % 4) payload += '=';

    let decoded;
    try {
      decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    } catch {
      continue;
    }

    const isVideo = decoded.filename && decoded.filename.endsWith('.mp4');

    if (isVideo || decoded.force === false) {
      mediaItems.push({
        url: token,
        type: isVideo ? 'video' : 'image',
        thumbnail: !isVideo
      });
    }
  }

  if (mediaItems.length === 0) {
    throw new Error('No valid media items found');
  }

  const videoItem = mediaItems.find(m => m.type === 'video');
  const imageItem = mediaItems.find(m => m.type === 'image');

  return {
    data: videoItem ? [videoItem, ...(imageItem ? [imageItem] : [])] : mediaItems
  };
}

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

      const downloadData = await instaDownload(text);

      if (!downloadData || !downloadData.data || downloadData.data.length === 0) {
        await extra.reply('\u274C No media found at the provided link. The post might be private or the link is invalid.');
        processedMessages.delete(msg.key.id);
        return { ok: false, reason: 'not_found', message: 'No media returned for that link — the post may be private or the link is invalid.' };
      }

      const mediaData = downloadData.data;
      const mediaToDownload = mediaData.slice(0, 20);

      if (mediaToDownload.length === 0) {
        await extra.reply('\u274C No valid media found to download. This might be a private post or the scraper failed.');
        processedMessages.delete(msg.key.id);
        return { ok: false, reason: 'not_found', message: 'No valid media after dedup/filtering — told the user.' };
      }

      let sentCount = 0;

      for (let i = 0; i < mediaToDownload.length; i++) {
        try {
          const media = mediaToDownload[i];
          const mediaUrl = media.url;

          const isVideo = media.type === 'video';

          if (isVideo) {
            await sock.sendMessage(chatId, {
              video: { url: mediaUrl },
              mimetype: 'video/mp4',
              caption: `*DOWNLOADED BY ${config.botName.toUpperCase()}*`
            }, { quoted: msg });
          } else {
            await sock.sendMessage(chatId, {
              image: { url: mediaUrl },
              caption: `*DOWNLOADED BY ${config.botName.toUpperCase()}*`
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
