const yts = require('yt-search');
const config = require('../config');
const { buildCard, buildStatusCard } = require('../tools/style');
const downloadQueue = require('../tools/downloadQueue');
const { imageSearch } = require('../tools/mediaDownloader');
const { artistClean } = require('../tools/songRecommend')._internals;

const processedMessages = new Set();

const MAX_IMG_RESULTS = 5;

// Given a song/video name, resolve it to a track and pull the artist name
// out of it — the whole point of `.img <song>` is artist photos. Falls back
// to a plain image search when the query isn't resolvable.
async function resolveArtist(query) {
  try {
    const { videos } = await yts(query);
    const v = videos && videos[0];
    if (!v) return null;
    const raw = String(v.author?.name || '');
    return {
      artist: raw,
      searchArtist: artistClean(raw) || raw,
      title: String(v.title || ''),
      videoId: v.videoId || '',
    };
  } catch {
    return null;
  }
}

module.exports = {
  name: 'img',
  aliases: ['image', 'images', 'gimg', 'imgsearch'],
  category: 'media',
  description: 'Search images — give a song/video name to get artist photos',
  usage: '.img <song name, video name, or search query>',

  async execute(sock, msg, args, extra = {}) {
    return downloadQueue.run(async () => {
      const chatId = extra.from || msg.key.remoteJid;

      try {
        if (processedMessages.has(msg.key.id)) {
          return { ok: false, reason: 'duplicate', message: 'This message was already processed — skipped.' };
        }
        processedMessages.add(msg.key.id);
        setTimeout(() => processedMessages.delete(msg.key.id), 5 * 60 * 1000);

        const text = (msg.message?.conversation ||
                     msg.message?.extendedTextMessage?.text ||
                     args.join(' ')).trim();

        if (!text) {
          await extra.reply(buildStatusCard({
            title: 'IMAGE SEARCH',
            status: '⫎ What should I search for?',
            lines: ['Example: `.img CHAMUNORWA` (artist photos)', 'Example: `.img lion on safari` (plain search)'],
          }));
          return { ok: false, reason: 'no_query', message: 'No search query was given — asked the user to provide one.' };
        }

        await sock.sendMessage(chatId, {
          react: { text: '📥', key: msg.key }
        });

        const resolved = await resolveArtist(text);
        const searchQuery = resolved?.searchArtist ? `${resolved.searchArtist} artist` : text;

        let images = [];
        try {
          images = await imageSearch(searchQuery, MAX_IMG_RESULTS);
        } catch (err) {
          console.warn('[IMG] artist search failed:', err?.message || err);
        }

        if (!images.length && searchQuery !== text) {
          try {
            images = await imageSearch(text, MAX_IMG_RESULTS);
          } catch (err) {
            console.warn('[IMG] fallback search failed:', err?.message || err);
          }
        }

        if (!images.length) {
          await extra.reply(buildStatusCard({
            title: 'IMAGE SEARCH',
            status: '❌ No results found.',
            lines: ['Try a different search query.'],
          }));
          return { ok: false, reason: 'not_found', message: 'No images returned for that query.' };
        }

        const results = images.slice(0, MAX_IMG_RESULTS);
        const captionTitle = resolved?.title || text;

        for (let i = 0; i < results.length; i++) {
          try {
            await sock.sendMessage(chatId, {
              image: { url: results[i] },
              caption: buildCard({
                title: resolved?.artist ? 'ARTIST PHOTOS' : 'IMAGE SEARCH',
                lines: [
                  ...(resolved?.artist
                    ? [`◈ *TRACK :* \`${captionTitle}\``, `◈ *ARTIST :* \`${resolved.artist}\``]
                    : [`◈ *QUERY :* \`${text}\``]),
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
