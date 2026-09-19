const yts = require('yt-search');

const pending = new Map();
let currentSock = null; // freshest socket for auto-sends — set per incoming message

/**
 * Keep a live reference to the active WhatsApp socket. Timers fire minutes
 * after register(), long after the original sock may have been closed by a
 * reconnect — always prefer the freshest reference so the recommendation
 * actually goes out.
 */
function setSock(sock) {
  if (sock) currentSock = sock;
}

const GAP_MS = 5 * 60 * 1000;
const RETRY_GAP_MS = 3 * 60 * 1000;

async function fetchRelated(videoId, originalTitle, originalArtist) {
  try {
    const related = await yts.related(videoId);
    const videos = related?.videos || [];
    if (videos.length) return videos.filter(v => v.id !== videoId);
  } catch (_) {}

  try {
    const fallback = await yts(`similar to ${originalTitle} ${originalArtist}`);
    const videos = fallback?.videos || [];
    return videos.filter(v => v.id !== videoId);
  } catch (_) {}

  return [];
}

async function attemptRecommend(meta, retryCount, candidateIndex) {
  const { from, jid, senderJid, videoId, title, artist } = meta;
  const sock = currentSock || meta.sock;

  try {
    const songCmd = require('../cmd/song');

    if (!meta._related) {
      meta._related = await fetchRelated(videoId, title, artist);
    }

    if (!meta._related.length || candidateIndex >= meta._related.length) return;

    const pick = meta._related[candidateIndex];

    const song = await songCmd.resolveSong(pick.title);
    if (!song) {
      setTimeout(() => attemptRecommend(meta, 0, candidateIndex + 1), RETRY_GAP_MS);
      return;
    }

    const { audio, payload } = await songCmd.resolveAudioDownload(song.url);

    const mentionJid = senderJid || jid;
    const senderNum = mentionJid.split('@')[0];
    const fileName = `${songCmd.sanitize(song.author, 'Unknown Artist')} - ${songCmd.sanitize(payload?.title || song.info.title)}.${audio.ext}`;

    await sock.sendMessage(from, {
      document: audio.buffer,
      mimetype: audio.mimetype,
      fileName,
      caption: songCmd.buildJailbreakCaption({ info: song.info, author: song.author, ago: song.ago, senderNum, emoji: '🎧' }),
      mentions: [mentionJid],
    });

    audio.buffer = null;

    await sock.sendMessage(from, {
      text: `🎵 @${senderNum} — you liked *${title}* by _${artist}_, thought you'd like this one too! Check it out 👆`,
      mentions: [mentionJid],
    });

    const memory = require('./memory');
    memory.add(from, 'assistant', `[JB proactively recommended "${song.info.title}" by ${song.author} based on user's previous request for "${title}" by ${artist}]`);
    memory.addSong(from, `${song.info.title} by ${song.author}`);

  } catch (err) {
    console.error(`[songRecommend] attempt ${retryCount + 1} candidate ${candidateIndex} failed:`, err.message);

    if (retryCount === 0) {
      setTimeout(() => attemptRecommend(meta, 1, candidateIndex), RETRY_GAP_MS);
    } else {
      setTimeout(() => attemptRecommend(meta, 0, candidateIndex + 1), RETRY_GAP_MS);
    }
  }
}

function register({ sock, from, jid, senderJid, pushName, videoId, title, artist }) {
  const key = jid;
  clear(key);

  const timer = setTimeout(() => {
    pending.delete(key);
    const meta = { sock, from, jid, senderJid, pushName, videoId, title, artist };
    attemptRecommend(meta, 0, 0);
  }, GAP_MS);

  pending.set(key, { timer, videoId, title, artist });
}

function clear(jid) {
  const existing = pending.get(jid);
  if (existing) {
    clearTimeout(existing.timer);
    pending.delete(jid);
  }
}

module.exports = { register, clear, setSock };
