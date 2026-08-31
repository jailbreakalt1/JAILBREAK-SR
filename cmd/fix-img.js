const yts = require('yt-search');
const config = require('../config');
const { orchestratorClient } = require('../tools/orchestratorClient');
const { buildCard, buildStatusCard } = require('../tools/style');
const downloadQueue = require('../tools/downloadQueue');
const { artistClean } = require('../tools/songRecommend')._internals;
const { createTempFilePath, deleteTempFiles } = require('../tools/tempManager');

const processedMessages = new Set();

const MAX_IMG_RESULTS = 5;

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

const pollJobCompletion = async (jobId, maxWaitMs = 120000, pollIntervalMs = 2000) => {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await new Promise(r => setTimeout(r, pollIntervalMs));
    try {
      const job = await orchestratorClient.getJobStatus(jobId);
      if (job.status === 'completed' && job.result) {
        return job.result;
      }
      if (job.status === 'failed') {
        throw new Error(job.error || 'Job failed');
      }
    } catch (err) {
      if (err.status === 404) continue;
      throw err;
    }
  }
  throw new Error('Job timed out');
};

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

        // Submit to orchestrator
        const sender = msg.key.participant || msg.key.remoteJid;
        const senderNum = sender.split('@')[0];
        const userId = senderNum;
        const jobPayload = {
          query: text,
          from: chatId,
          sender,
          senderNum,
          pushName: extra.pushName || '',
          isDM: !chatId.endsWith('@g.us'),
        };

        if (typeof extra.react === 'function') await extra.react('⏳');

        let job;
        try {
          job = await orchestratorClient.submitJob('download-image', jobPayload, userId);
        } catch (err) {
          console.warn('[IMG] Orchestrator submit failed, falling back to local:', err.message);
          return executeImgLocal(sock, msg, args, extra);
        }

        await extra.reply(buildStatusCard({
          title: '☬ IMAGE QUEUED',
          status: `⏳ Searching for images...`,
          lines: [`Job ID: \`${job.jobId}\``],
        }));

        let result;
        try {
          result = await pollJobCompletion(job.jobId);
        } catch (err) {
          await extra.reply(buildStatusCard({
            title: 'IMAGE SEARCH',
            status: '❌ Processing timed out or failed',
            lines: [err.message],
          }));
          if (typeof extra.react === 'function') await extra.react('❌');
          return { ok: false };
        }

        // Send images
        const { images, captionTitle, resolvedArtist, captionData } = result;
        const results = images.slice(0, MAX_IMG_RESULTS);

        for (let i = 0; i < results.length; i++) {
          try {
            await sock.sendMessage(chatId, {
              image: { url: results[i] },
              caption: buildCard({
                title: resolvedArtist ? 'ARTIST PHOTOS' : 'IMAGE SEARCH',
                lines: [
                  ...(resolvedArtist
                    ? [`◈ *TRACK :* \`${captionTitle}\``, `◈ *ARTIST :* \`${resolvedArtist}\``]
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
  },
};

// Local fallback (original logic)
async function executeImgLocal(sock, msg, args, extra = {}) {
  const { imageSearch } = require('../tools/mediaDownloader');
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
}