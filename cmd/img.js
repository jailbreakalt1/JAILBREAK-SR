const config = require('../config');
const { buildCard, buildStatusCard } = require('../tools/style');
const downloadQueue = require('../tools/downloadQueue');
const { imageSearch } = require('../tools/mediaDownloader');

const processedMessages = new Set();

const MAX_IMG_RESULTS = 5;

module.exports = {
  name: 'img',
  aliases: ['image', 'images', 'gimg', 'imgsearch'],
  category: 'media',
  description: 'Search and download images',
  usage: '<search query>',

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
            title: 'IMAGE SEARCH',
            status: '⫎ What image should I search for?',
            lines: ['Example: `.img lion on safari`'],
          }));
          return { ok: false, reason: 'no_query', message: 'No search query was given — asked the user to provide one.' };
        }

        await sock.sendMessage(chatId, {
          react: { text: '📥', key: msg.key }
        });

        const images = await imageSearch(text, MAX_IMG_RESULTS);

        if (!images.length) {
          await extra.reply(buildStatusCard({
            title: 'IMAGE SEARCH',
            status: '❌ No results found.',
            lines: ['Try a different search query.'],
          }));
          return { ok: false, reason: 'not_found', message: 'No images returned for that query.' };
        }

        const results = images.slice(0, MAX_IMG_RESULTS);

        for (let i = 0; i < results.length; i++) {
          try {
            await sock.sendMessage(chatId, {
              image: { url: results[i] },
              caption: buildCard({
                title: 'IMAGE SEARCH',
                lines: [
                  `◈ *QUERY :* \`${text}\``,
                  `◈ *IMAGE :* ${i + 1}/${results.length}`,
                ],
              }),
            }, { quoted: msg });
          } catch (mediaError) {
            console.error(`Error sending image ${i + 1}:`, mediaError?.message || mediaError);
          }
        }

        if (typeof extra.react === 'function') await extra.react('✅');
        return { ok: true };
      } catch (error) {
        console.error('Error in IMG command:', error);
        const message = error?.message || 'Unknown error';
        await extra.reply(buildStatusCard({
          title: 'IMAGE SEARCH',
          status: '❌ An error occurred.',
          lines: [message],
        }));
        if (typeof extra.react === 'function') await extra.react('❌');
        return { ok: false, reason: 'error', message };
      }
    });
  }
};