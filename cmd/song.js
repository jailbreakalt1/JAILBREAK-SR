const axios = require('axios');
const fs = require('fs');
const path = require('path');
const yts = require('yt-search');
const config = require('../config');
const APIs = require('../tools/api');
const { toAudio, toAudioFromFile } = require('../tools/converter');
const { cleanNumber, toPhoneJid } = require('../tools/jidCleanser');
const quota = require('../tools/quota');
const songRecommend = require('../brain/songRecommend');

const CHANNEL_URL = 'https://whatsapp.com/channel/0029Vb6zZKpKbYMFqRWgx62q';
const AXIOS_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: '*/*',
  'Accept-Encoding': 'identity'
};

const MAX_DOWNLOAD_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2500;
const MAX_MEM_RSS = 600 * 1024 * 1024;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Download concurrency lock ────────────────────────────────────────────
// Only one audio download pipeline runs at a time so we never hold multiple
// audio Buffers in memory simultaneously.
let dlLock = Promise.resolve();
const acquireDL = () => {
  let release;
  const next = new Promise(r => { release = r; });
  const prev = dlLock;
  dlLock = next;
  return prev.then(() => release);
};

const sanitize = (value, fallback = 'song') => (value || fallback).replace(/[\\/:*?"<>|]+/g, '').trim() || fallback;
const buildJailbreakCaption = ({ info, author, ago, senderNum, emoji }) =>
`⧯ *𝙹𝙰𝙸𝙻𝙱𝚁𝙴𝙰𝙺_𝙰𝙸* 𝙱𝚁𝙸𝙽𝙶𝚂 𝚈𝙾𝚄\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯\n◈ *𝚃𝙸𝚃𝙻𝙴 :* \`${info.title}\`\n◈ *𝙰𝚁𝚃𝙸𝚂𝚃 :* \`${author}\`\n◈ *𝚁𝙴𝙻𝙴𝙰𝚂𝙴𝙳 :* \`${ago}\`\n◈ *𝙳𝚄𝚁𝙰𝚃𝙸𝙾𝙽 :* \`${info.timestamp}\`\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯\n⎆ @${senderNum} _ENJOY_ ${emoji}\n  follow our channel\n> ☬ *𝚂𝙾𝚄𝚁𝙲𝙴 :* 𝙹𝙰𝙸𝙻𝙱𝚁𝙴𝙰𝙺 ☬`;

// ── YouTube metadata resolver ──────────────────────────────────────
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

// ── Audio download resolver (hybrid: API → local yt-dlp) ──────────
const resolveAudioDownload = async (youtubeUrl) => {
  // 0) Local jailbreakdl backend — primary path (cookies + POT + yt-dlp
  //    handled server-side on the same box; no hosted API dependence).
  try {
    const audio = await APIs.getBackendMediaByUrl(youtubeUrl, 'audio');
    return { audio, payload: null };
  } catch (e) {
    console.log(`[SONG] local backend failed: ${e.message}`);
  }

  // 1) EliteProTech API — fast path, returns download URL
  try {
    const payload = await APIs.getEliteProTechDownloadByUrl(youtubeUrl);
    if (payload?.download) {
      console.log(`[SONG] EliteProTech API OK — downloading from CDN`);
      const tmpFile = await downloadToFile(payload.download);
      const audio = await normalizeAudioFromFile(tmpFile);
      return { audio, payload };
    }
  } catch (e) {
    console.log(`[SONG] EliteProTech API failed: ${e.message}`);
  }

  // 2) Local yt-dlp fallback — downloads + converts on the server
  console.log(`[SONG] Falling through to local yt-dlp...`);
  const audio = await APIs.getLocalAudioByUrl(youtubeUrl);
  return { audio, payload: null };
};

// ── Stream download to temp file (no RAM spike) ────────────────────
const TEMP = path.join(__dirname, '..', 'temp');
const tempPath = () => path.join(TEMP, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.raw`);

const downloadToFile = async (url) => {
  const tmp = tempPath();
  let response;
  try {
    response = await axios.get(url, {
      responseType: 'stream',
      timeout: 90000,
      headers: AXIOS_HEADERS,
      validateStatus: (s) => s >= 200 && s < 400
    });
  } catch (err) {
    del(tmp);
    throw err;
  }
  const writer = fs.createWriteStream(tmp);
  return new Promise((resolve, reject) => {
    const fail = (err) => {
      del(tmp);
      writer.destroy();
      reject(err);
    };
    response.data.on('error', fail);
    writer.on('error', fail);
    writer.on('finish', () => resolve(tmp));
    response.data.pipe(writer);
  });
};

// ── Detect format from file, convert if needed ─────────────────────
const normalizeAudioFromFile = async (filePath) => {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(12);
    fs.readSync(fd, buf, 0, 12, 0);
    const ascii = buf.slice(4, 8).toString('ascii');
    const ext = buf.toString('ascii', 0, 4) === 'OggS' ? 'ogg'
      : buf.toString('ascii', 0, 4) === 'RIFF' ? 'wav'
      : ascii === 'ftyp' || buf.toString('hex').startsWith('000000') ? 'm4a'
      : 'mp3';
    if (ext === 'mp3') {
      const buffer = fs.readFileSync(filePath);
      return { buffer, mimetype: 'audio/mpeg', ext: 'mp3' };
    }
    const converted = await toAudioFromFile(filePath, ext);
    if (!converted?.length) throw new Error('Failed to convert audio.');
    return { buffer: converted, mimetype: 'audio/mpeg', ext: 'mp3' };
  } finally {
    try { if (fd !== undefined) fs.closeSync(fd); } catch (_) {}
    del(filePath);
  }
};

// ── Backward compat wrappers for find.js chaining ──────────────────
const downloadBuffer = async (url) => {
  const tmp = await downloadToFile(url);
  const buf = fs.readFileSync(tmp);
  del(tmp);
  return buf;
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

// ── Helpers ────────────────────────────────────────────────────────
const del = (...paths) => {
  for (const p of paths) {
    try {
      if (p && fs.existsSync(p)) {
        fs.writeFileSync(p, Buffer.alloc(0));
        fs.unlinkSync(p);
      }
    } catch (_) {}
  }
};

const memOk = () => process.memoryUsage().rss < MAX_MEM_RSS;

module.exports = {
  name: 'song',
  aliases: ['play', 'music', 'yta'],
  category: 'cmd',
  description: 'Search and download a track as a document',
  usage: '.song <song name or YouTube link>',

  resolveSong,
  resolveAudioDownload,
  acquireDL,
  downloadBuffer,
  normalizeAudio,
  downloadToFile,
  normalizeAudioFromFile,
  sanitize,
  buildJailbreakCaption,

  async execute(sock, msg, args, extra = {}) {
    const from = extra.from || msg.key.remoteJid;
    const sender = msg.key.participant || from;
    const isDM = !from.endsWith('@g.us');
    const query = args.join(' ').trim();

    if (!memOk()) {
      await sock.sendMessage(from, {
        text: `⧯ Server is busy right now, try again in ${config.spam.duplicateCooldown}s.`
      }, { quoted: msg });
      return { ok: false, reason: 'memory_pressure', message: 'Server RAM too high — told the user to try again.' };
    }

    const senderNum = sender.split('@')[0];

    if (!isDM) {
      const q = quota.getQuota(sender);
      if (!q.allowed) {
        const artists = quota.getArtists(sender);
        let artistsLine = '';
        if (artists.length) {
          const listed = artists.slice(0, 10).map((a, i) => `${i + 1}. ${a}`).join('\n');
          artistsLine = `\n\nYour artists of the day were:\n${listed}`;
        }
        await sock.sendMessage(from, {
          text: `Dear @${extra.pushName || senderNum}, you requested ${q.used} songs today. I can no longer be of service.${artistsLine}\n\nYou can request more songs in ${quota.timeUntilReset()}.`
        }, { quoted: msg });
        return { ok: false, reason: 'quota_exhausted', message: `Daily request limit ${q.used}/${q.total} reached — told the user.` };
      }
    }

    if (!query) {
      await sock.sendMessage(from, {
        text: `⧯ Provide a song name or YouTube link.\n\nExample: ${config.prefix}play CHAMUNORWA Bagga`
      }, { quoted: msg });
      return { ok: false, reason: 'no_query', message: 'No song name/link was given — asked the user to provide one.' };
    }

    let tmpFile;
    try {
      if (typeof extra.react === 'function') await extra.react('🔥');

      const song = await resolveSong(query);
      if (!song) throw new Error('No results found for that query.');

      let payload, audio, lastErr;
      const release = await acquireDL();
      try {
        for (let attempt = 1; attempt <= MAX_DOWNLOAD_ATTEMPTS; attempt++) {
          try {
            const resolved = await resolveAudioDownload(song.url);
            payload = resolved.payload;
            audio = resolved.audio;
            lastErr = null;
            break;
          } catch (err) {
            lastErr = err;
            console.error(`[SONG] download attempt ${attempt}/${MAX_DOWNLOAD_ATTEMPTS} failed: ${err.message}`);
            if (attempt < MAX_DOWNLOAD_ATTEMPTS) await sleep(RETRY_DELAY_MS);
          }
        }
      } finally {
        release();
      }
      if (lastErr) throw lastErr;
      const senderJid = toPhoneJid(extra.sender || msg.key.participant || msg.key.remoteJid);
      const senderNum = cleanNumber(senderJid);
      const fileName = `${sanitize(song.author, 'Unknown Artist')} - ${sanitize(payload?.title || song.info.title)}.${audio.ext}`;

      let q2;
      if (isDM) {
        q2 = { used: 0, total: Infinity };
      } else {
        q2 = quota.useQuota(sender);
        quota.recordArtist(sender, song.author);
      }

      await sock.sendMessage(from, {
        document: audio.buffer,
        mimetype: audio.mimetype,
        fileName,
        caption: `${buildJailbreakCaption({ info: song.info, author: song.author, ago: song.ago, senderNum, emoji: '🎧' })}\n\n_@${senderNum}, you've used ${q2.used}/${q2.total} today — ${q2.total - q2.used} remaining_`,
        mentions: [senderJid]
      }, { quoted: msg });

      audio.buffer = null;

      if (typeof extra.react === 'function') await extra.react('✅');

      if (isDM && song.videoId) {
        songRecommend.register({
          sock, from,
          jid: sender,
          senderJid,
          pushName: extra.pushName || '',
          videoId: song.videoId,
          title: song.info.title,
          artist: song.author,
        });
      }

      return { ok: true };
    } catch (error) {
      del(tmpFile);
      await sock.sendMessage(from, {
        text: `❌ Failed to fetch song: ${error.message}`
      }, { quoted: msg });
      if (typeof extra.react === 'function') await extra.react('❌');
      return { ok: false, reason: 'download_failed', message: error.message };
    }
  },
};
