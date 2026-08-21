const fsp = require('fs/promises');
const yts = require('yt-search');
const config = require('../config');
const APIs = require('../tools/api');
const { toAudioFile } = require('../tools/converter');
const { getSong, downloadToDisk } = require('../tools/mediaDownloader');
const { cleanNumber, toPhoneJid } = require('../tools/jidCleanser');
const quota = require('../tools/quota');
const songRecommend = require('../tools/songRecommend');
const { buildStatusCard } = require('../tools/style');
const { sendInteractiveMessage } = require('@ryuu-reinzz/button-helper');
const downloadQueue = require('../tools/downloadQueue');
const { createTempFilePath, deleteTempFiles } = require('../tools/tempManager');
const { getLiveState } = require('../tools/liveDetector');
const buttonContext = require('../tools/buttonContext');

const CHANNEL_URL = 'https://whatsapp.com/channel/0029Vb6zZKpKbYMFqRWgx62q';

const sanitize = (value, fallback = 'song') => String(value || fallback).replace(/[\\/:*?"<>|]+/g, '').trim() || fallback;
const buildJailbreakCaption = ({ info, author, ago, senderNum, emoji }) =>
`⧯ *𝙹𝙰𝙸𝙻𝙱𝚁𝙴𝙰𝙺_𝚂𝚁* 𝙱𝚁𝙸𝙽𝙶𝚂 𝚈𝙾𝚄\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯\n◈ *𝚃𝙸𝚃𝙻𝙴 :* \`${info.title}\`\n◈ *𝙰𝚁𝚃𝙸𝚂𝚃 :* \`${author}\`\n◈ *𝚁𝙴𝙻𝙴𝙰𝚂𝙴𝙳 :* \`${ago}\`\n◈ *𝙳𝚄𝚁𝙰𝚃𝙸𝙾𝙽 :* \`${info.timestamp}\`\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯\n⎆ @${senderNum} _ENJOY_ ${emoji}\n𝙹`;

// ── YouTube metadata resolver (unchanged) ────────────────────────────────────
const resolveSong = async (query) => {
  const search = await yts(query);
  const video = search?.videos?.[0];
  if (!video) return null;
  return {
    url: video.url,
    videoId: video.videoId,
    info: {
      title: video.title || 'Unknown Title',
      timestamp: video.timestamp || 'Unknown',
      thumbnail: video.thumbnail || 'https://files.catbox.moe/s80m7e.png'
    },
    author: String(video.author?.name || 'Unknown Artist'),
    ago: video.ago || 'Recently'
  };
};

const resolveSongCandidates = async (query) => {
  const search = await yts(query);
  return (search?.videos?.slice(0, 5) || []).map((video) => ({
    url: video.url,
    videoId: video.videoId,
    info: {
      title: video.title || 'Unknown Title',
      timestamp: video.timestamp || 'Unknown',
      thumbnail: video.thumbnail || 'https://files.catbox.moe/s80m7e.png'
    },
    author: String(video.author?.name || 'Unknown Artist'),
    ago: video.ago || 'Recently'
  }));
};

// ── Audio download resolver ──────────────────────────────────────────────────
// External API (siputzx) first — light on our VPS.
// Falls back to VPS backend (jailbreakdl), then EliteProTech as last resort.
const resolveAudioDownload = async (query, youtubeUrls) => {
  // 1) External API first (siputzx)
  for (const youtubeUrl of youtubeUrls) {
    try {
      const payload = await APIs.ytDownload(youtubeUrl, 'audio');
      const mediaUrl = payload?.download || payload?.url || payload?.link;
      if (mediaUrl) {
        return { payload: { title: payload.title || 'Song' }, mediaUrl };
      }
    } catch (err) {
      console.warn('[song] siputzx failed:', err.message);
    }
  }

  // 2) VPS backend (jailbreakdl) — our own reliable source
  for (const youtubeUrl of youtubeUrls) {
    try {
      const media = await getSong(youtubeUrl);
      if (media?.filePath) {
        return { payload: { title: media.title || 'Song' }, localPath: media.filePath };
      }
    } catch (err) {
      console.warn('[song] jailbreakdl failed:', err.message);
    }
  }

  // 3) EliteProTech — last resort
  for (const youtubeUrl of youtubeUrls) {
    try {
      const payload = await APIs.getEliteProTechDownloadByUrl(youtubeUrl);
      const mediaUrl = payload.download;
      if (mediaUrl) return { payload, mediaUrl };
    } catch (err) {
      console.warn('[song] EliteProTech failed:', err.message);
    }
  }

  throw new Error('All audio sources failed.');
};

// Only reads the first 12 bytes off disk to sniff the container format —
// no need to load the whole file just to check a header.
const detectExt = async (filePath) => {
  const fd = await fsp.open(filePath, 'r');
  try {
    const header = Buffer.alloc(12);
    await fd.read(header, 0, 12, 0);
    const ascii4 = header.slice(4, 8).toString('ascii');
    if (header.toString('ascii', 0, 4) === 'OggS') return 'ogg';
    if (header.toString('ascii', 0, 4) === 'RIFF') return 'wav';
    if (ascii4 === 'ftyp' || header.toString('hex').startsWith('000000')) return 'm4a';
    return 'mp3';
  } finally {
    await fd.close();
  }
};

const scheduleCleanup = (...filePaths) => {
  const unique = [...new Set(filePaths.filter(Boolean))];
  if (!unique.length) return;
  setImmediate(() => deleteTempFiles(unique));
};

const sendSongCore = async (sock, msg, query, extra = {}) => {
  const from = extra.from || msg.key.remoteJid;
  const sender = extra.sender || msg.key.participant || msg.key.remoteJid;
  const isDM = !from.endsWith('@g.us');

  let rawPath = null;
  let finalPath = null;

  try {
    if (typeof extra.react === 'function') await extra.react('🔥');

    if (!extra.skipQuota && !isDM) {
      const q = quota.getQuota(sender);
      if (!q.allowed) {
        const senderNum = (sender || '').split('@')[0];
        const limitMsg = quota.buildLimitMessage({
          jid: sender,
          pushName: extra.pushName || '',
          senderNum,
          subject: 'songs',
        });
        await sock.sendMessage(from, { text: limitMsg.text }, { quoted: msg });
        return false;
      }
    }

    const songCandidates = await resolveSongCandidates(query);
    if (!songCandidates.length) throw new Error('No results found for that query.');
    const song = songCandidates[0];

    const liveState = await getLiveState(song.videoId);
    if (liveState) {
      await sock.sendMessage(from, {
        text: buildStatusCard({
          title: '☬ SONG DOWNLOAD',
          status: liveState === 'live'
            ? '❌ Live streams cannot be downloaded'
            : '❌ That stream has not started yet',
          lines: [
            liveState === 'live'
              ? `"${song.info.title}" is a live stream — there's no finished audio to grab.`
              : `"${song.info.title}" is scheduled and hasn't aired yet.`,
            'Try a regular song or a different search.',
          ],
        })
      }, { quoted: msg });
      if (typeof extra.react === 'function') await extra.react('❌');
      return false;
    }

    const { payload, mediaUrl, localPath } = await resolveAudioDownload(query, songCandidates.map((c) => c.url));

    if (localPath) {
      rawPath = localPath;
    } else {
      rawPath = createTempFilePath('song', 'raw');
      await downloadToDisk(mediaUrl, rawPath);
    }

    const ext = await detectExt(rawPath);
    let mimetype = 'audio/mpeg';

    if (ext === 'mp3') {
      finalPath = rawPath;
    } else {
      finalPath = createTempFilePath('song', 'mp3');
      await toAudioFile(rawPath, finalPath);
      const stat = await fsp.stat(finalPath);
      if (!stat.size) throw new Error('Converted audio is empty.');
    }

    const senderJid = toPhoneJid(extra.sender || msg.key.participant || msg.key.remoteJid);
    const senderNum = cleanNumber(senderJid);
    const fileName = `${sanitize(song.author, 'Unknown Artist')} - ${sanitize(payload.title || song.info.title)}.mp3`;

    let q2;
    if (isDM || extra.skipQuota) {
      q2 = { used: 0, total: Infinity };
    } else {
      q2 = quota.useQuota(sender);
      quota.recordArtist(sender, song.author);
    }

    const videoQuery = `${song.author} - ${payload.title || song.info.title}`;
    const captionText = buildJailbreakCaption({ info: song.info, author: song.author, ago: song.ago, senderNum, emoji: '🎧' }) + `\n_@${senderNum}, _used ${q2.used}/${q2.total} today — ${q2.total - q2.used} remaining__`;

    // 1) The document goes out as a plain message — the same proven path
    //    songRecommend uses. No interactive-with-media fusion.
    await sock.sendMessage(from, {
      document: { url: finalPath },
      mimetype,
      fileName,
      caption: captionText,
      mentions: [senderJid]
    }, { quoted: msg, __skipStyle: true });

    // 2) Buttons are a separate follow-up, sent only after the document
    //    itself was delivered. The query is remembered so a tap that
    //    arrives without a proper id can still be resolved.
    buttonContext.set(from, { videoQuery });
    try {
      await sendInteractiveMessage(sock, from, {
        text: `⬇ *${payload.title || song.info.title}* delivered to @${senderNum}.`,
        interactiveButtons: [
          {
            name: 'quick_reply',
            buttonParamsJson: JSON.stringify({
              display_text: '🎬 FETCH VIDEO',
              id: `viddl:${encodeURIComponent(videoQuery)}`,
            }),
          },
          {
            name: 'quick_reply',
            buttonParamsJson: JSON.stringify({
              display_text: '📸 FETCH PHOTOS',
              id: `imgdl:${encodeURIComponent(videoQuery)}`,
            }),
          },
          {
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({
              display_text: '▶ JOIN CHANNEL',
              url: CHANNEL_URL,
            }),
          },
        ],
      }, { quoted: msg });
    } catch (error) {
      console.warn('[SONG] follow-up buttons failed:', error?.message || error);
    }

    if (typeof extra.react === 'function') await extra.react('✅');

    if (isDM && song.videoId) {
      songRecommend.register({
        sock,
        from,
        jid: sender,
        senderJid,
        pushName: extra.pushName || '',
        videoId: song.videoId,
        title: song.info.title,
        artist: song.author,
      });
    }

    return true;
  } catch (error) {
    if (extra.quietFailure) return false;
    await sock.sendMessage(from, {
      text: buildStatusCard({
        title: 'SONG DOWNLOAD',
        status: '❌ Failed to fetch song',
        lines: [error.message || 'Unknown error'],
      })
    }, { quoted: msg });
    if (typeof extra.react === 'function') await extra.react('❌');
    return false;
  } finally {
    scheduleCleanup(rawPath, finalPath);
  }
};

const sendSong = (sock, msg, query, extra = {}) => downloadQueue.run(() => sendSongCore(sock, msg, query, extra));

module.exports = {
  name: 'song',
  aliases: ['play', 'music'],
  category: 'cmd',
  description: 'Find and send it as a document',
  usage: '.song <song name or YouTube link>',
  sendSong,

  async execute(sock, msg, args, extra = {}) {
    const from = extra.from || msg.key.remoteJid;
    const query = args.join(' ').trim();
    if (!query) {
      await sock.sendMessage(from, {
        text: buildStatusCard({
          title: '☬ SONG REQUEST',
          status: '> ⫎ Provide a song name or YouTube link.',
          lines: [`Example: \n ${config.prefix}play you are the shadow to my light`],
        })
      }, { quoted: msg });
      return;
    }

    await sendSong(sock, msg, query, extra);
  },
};
