const axios = require('axios');
const yts = require('yt-search');
const config = require('../config');
const APIs = require('../tools/api');
const { toAudio } = require('../tools/converter');
const { cleanNumber, toPhoneJid } = require('../tools/jidCleanser');

const CHANNEL_URL = 'https://whatsapp.com/channel/0029Vb6zZKpKbYMFqRWgx62q';
const AXIOS_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: '*/*',
  'Accept-Encoding': 'identity'
};

const sanitize = (value, fallback = 'song') => (value || fallback).replace(/[\\/:*?"<>|]+/g, '').trim() || fallback;
const buildJailbreakCaption = ({ info, author, ago, senderNum, emoji }) =>
`⧯ *𝙹𝙰𝙸𝙻𝙱𝚁𝙴𝙰𝙺_𝙰𝙸* 𝙱𝚁𝙸𝙽𝙶𝚂 𝚈𝙾𝚄\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯\n◈ *𝚃𝙸𝚃𝙻𝙴 :* \`${info.title}\`\n◈ *𝙰𝚁𝚃𝙸𝚂𝚃 :* \`${author}\`\n◈ *𝚁𝙴𝙻𝙴𝙰𝚂𝙴𝙳 :* \`${ago}\`\n◈ *𝙳𝚄𝚁𝙰𝚃𝙸𝙾𝙽 :* \`${info.timestamp}\`\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯\n⎆ @${senderNum} _ENJOY_ ${emoji}\n  follow our channel\n> ☬ *𝚂𝙾𝚄𝚁𝙲𝙴 :* 𝙹𝙰𝙸𝙻𝙱𝚁𝙴𝙰𝙺 ☬`;

// ── YouTube metadata resolver (unchanged) ────────────────────────────────────
const resolveSong = async (query) => {
  const search = await yts(query);
  const video = search?.videos?.[0];
  if (!video) return null;
  return {
    url: video.url,
    info: {
      title: video.title || 'Unknown Title',
      timestamp: video.timestamp || 'Unknown',
      thumbnail: video.thumbnail || 'https://files.catbox.moe/s80m7e.png'
    },
    author: video.author?.name || 'Unknown Artist',
    ago: video.ago || 'Recently'
  };
};

// ── Audio download resolver ───────────────────────────────────────────────────
// Tries each URL-based API in turn against the resolved YouTube URL.
const resolveAudioDownload = async (youtubeUrl) => {
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

const downloadBuffer = async (url) => {
  const { data } = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 90000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    headers: AXIOS_HEADERS,
    validateStatus: (status) => status >= 200 && status < 400
  });
  const buffer = Buffer.from(data || []);
  if (!buffer.length) throw new Error('Empty audio buffer.');
  return buffer;
};

const normalizeAudio = async (buffer) => {
  const header = buffer.slice(0, 12);
  const ascii = buffer.slice(4, 8).toString('ascii');
  const ext = buffer.toString('ascii', 0, 4) === 'OggS' ? 'ogg'
    : buffer.toString('ascii', 0, 4) === 'RIFF' ? 'wav'
    : ascii === 'ftyp' || header.toString('hex').startsWith('000000') ? 'm4a'
    : 'mp3';

  if (ext === 'mp3') return { buffer, mimetype: 'audio/mpeg', ext: 'mp3' };
  const converted = await toAudio(buffer, ext);
  if (!converted?.length) throw new Error('Failed to convert audio.');
  return { buffer: converted, mimetype: 'audio/mpeg', ext: 'mp3' };
};

module.exports = {
  name: 'song',
  aliases: ['play', 'music', 'yta'],
  category: 'cmd',
  description: 'Search and download a track as a document',
  usage: '.song <song name or YouTube link>',

  async execute(sock, msg, args, extra = {}) {
    const from = extra.from || msg.key.remoteJid;
    const query = args.join(' ').trim();

    if (!query) {
      await sock.sendMessage(from, {
        text: `⧯ Provide a song name or YouTube link.\n\nExample: ${config.prefix}play CHAMUNORWA Bagga`
      }, { quoted: msg });
      return;
    }

    try {
      if (typeof extra.react === 'function') await extra.react('🔥');

      // Resolve YouTube metadata for title/duration/thumbnail and fallback URL.
      const song = await resolveSong(query);
      if (!song) throw new Error('No results found for that query.');

      // Use the YouTube URL resolved above to find a working audio source.
      const { payload, mediaUrl } = await resolveAudioDownload(song.url);

      const audio = await normalizeAudio(await downloadBuffer(mediaUrl));
      const senderJid = toPhoneJid(extra.sender || msg.key.participant || msg.key.remoteJid);
      const senderNum = cleanNumber(senderJid);
      const fileName = `${sanitize(song.author, 'Unknown Artist')} - ${sanitize(payload.title || song.info.title)}.${audio.ext}`;

      await sock.sendMessage(from, {
        document: audio.buffer,
        mimetype: audio.mimetype,
        fileName,
        caption: buildJailbreakCaption({ info: song.info, author: song.author, ago: song.ago, senderNum, emoji: '🎧' }),
        mentions: [senderJid]
      }, { quoted: msg });

      if (typeof extra.react === 'function') await extra.react('✅');
    } catch (error) {
      await sock.sendMessage(from, {
        text: `❌ Failed to fetch song: ${error.message}`
      }, { quoted: msg });
      if (typeof extra.react === 'function') await extra.react('❌');
    }
  },
};
