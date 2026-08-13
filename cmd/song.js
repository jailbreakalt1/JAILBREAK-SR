const axios = require('axios');
const fs = require('fs');
const fsp = require('fs/promises');
const yts = require('yt-search');
const config = require('../config');
const APIs = require('../tools/api');
const { toAudioFile } = require('../tools/converter');
const { cleanNumber, toPhoneJid } = require('../tools/jidCleanser');
const quota = require('../tools/quota');
const songRecommend = require('../tools/songRecommend');
const { buildStatusCard } = require('../tools/style');
const { sendInteractiveMessage } = require('@ryuu-reinzz/button-helper');
const downloadQueue = require('../tools/downloadQueue');
const { createTempFilePath, deleteTempFiles } = require('../tools/tempManager');

const CHANNEL_URL = 'https://whatsapp.com/channel/0029Vb6zZKpKbYMFqRWgx62q';
const AXIOS_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: '*/*',
  'Accept-Encoding': 'identity'
};

const sanitize = (value, fallback = 'song') => (value || fallback).replace(/[\\/:*?"<>|]+/g, '').trim() || fallback;
const buildJailbreakCaption = ({ info, author, ago, senderNum, emoji }) =>
`⧯ *𝙹𝙰𝙸𝙻𝙱𝚁𝙴𝙰𝙺_𝚂𝚁* 𝙱𝚁𝙸𝙽𝙶𝚂 𝚈𝙾𝚄\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯\n◈ *𝚃𝙸𝚃𝙻𝙴 :* \`${info.title}\`\n◈ *𝙰𝚁𝚃𝙸𝚂𝚃 :* \`${author}\`\n◈ *𝚁𝙴𝙻𝙴𝙰𝚂𝙴𝙳 :* \`${ago}\`\n◈ *𝙳𝚄𝚁𝙰𝚃𝙸𝙾𝙽 :* \`${info.timestamp}\`\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯\n⎆ @${senderNum} _ENJOY_ ${emoji}\n  join our channel: ${CHANNEL_URL}\n> ☬ *𝚂𝙾𝚄𝚁𝙲𝙴 :* 𝙹𝙰𝙸𝙻𝙱𝚁𝙴𝙰𝙺 ☬`;

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
    author: video.author?.name || 'Unknown Artist',
    ago: video.ago || 'Recently'
  };
};

// ── Audio download resolver (unchanged) ──────────────────────────────────────
const resolveAudioDownload = async (query, youtubeUrl) => {
  try {
    const payload = await APIs.getMp3JuiceDownload(query);
    const mediaUrl = payload.download || payload.url;
    if (mediaUrl) return { payload, mediaUrl };
  } catch (err) {
    console.warn('[song] MP3Juice failed:', err.message);
  }

  for (const method of [
    () => APIs.getEliteProTechDownloadByUrl(youtubeUrl),
    () => APIs.getYupraDownloadByUrl(youtubeUrl),
    () => APIs.getOkatsuDownloadByUrl(youtubeUrl),
    () => APIs.getIzumiDownloadByUrl(youtubeUrl),
  ]) {
    try {
      const payload = await method();
      const mediaUrl = payload.download || payload.dl || payload.url || payload.result?.download || payload.result?.url;
      if (mediaUrl) return { payload, mediaUrl };
    } catch (_) {}
  }

  throw new Error('All audio sources failed.');
};

// ── Disk-backed download + conversion helpers ────────────────────────────────

// Streams the HTTP response straight to a file — never holds the full
// response in a JS Buffer, so peak RAM stays roughly at chunk size
// regardless of how big the track is.
const downloadToDisk = async (url, destPath) => {
  const response = await axios.get(url, {
    responseType: 'stream',
    timeout: 90000,
    headers: AXIOS_HEADERS,
    validateStatus: (status) => status >= 200 && status < 400
  });

  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(destPath);
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
    response.data.on('error', reject);
  });

  const stat = await fsp.stat(destPath);
  if (!stat.size) throw new Error('Empty audio file.');
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

    const song = await resolveSong(query);
    if (!song) throw new Error('No results found for that query.');

    const { payload, mediaUrl } = await resolveAudioDownload(query, song.url);

    rawPath = createTempFilePath('song', 'raw');
    await downloadToDisk(mediaUrl, rawPath);

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
    if (isDM) {
      q2 = { used: 0, total: Infinity };
    } else {
      q2 = quota.useQuota(sender);
      quota.recordArtist(sender, song.author);
    }

    await sock.sendMessage(from, {
      document: { url: finalPath },
      mimetype,
      fileName,
      caption: buildJailbreakCaption({ info: song.info, author: song.author, ago: song.ago, senderNum, emoji: '🎧' }) + `\n_@${senderNum}, you've used ${q2.used}/${q2.total} today — ${q2.total - q2.used} remaining_`,
      mentions: [senderJid]
    }, { quoted: msg });

    const videoQuery = `${song.author} - ${payload.title || song.info.title}`;
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
  aliases: ['play', 'music', 'yta'],
  category: 'cmd',
  description: 'Search a track via MP3Juice and send it as a document',
  usage: '.song <song name or YouTube link>',
  sendSong,

  async execute(sock, msg, args, extra = {}) {
    const from = extra.from || msg.key.remoteJid;
    const query = args.join(' ').trim();
    if (!query) {
      await sock.sendMessage(from, {
        text: buildStatusCard({
          title: 'SONG REQUEST',
          status: '⫎ Provide a song name or YouTube link.',
          lines: [`Example: ${config.prefix}play CHAMUNORWA Bagga`],
        })
      }, { quoted: msg });
      return;
    }

    await sendSong(sock, msg, query, extra);
  },
};
