const fsp = require('fs/promises');
const yts = require('yt-search');
const { Innertube } = require('youtubei.js');
const downloadQueue = require('./downloadQueue');
const APIs = require('./api');
const { toAudioFile } = require('./converter');
const { getSong, downloadToDisk } = require('./mediaDownloader');
const CHANNEL_URL = 'https://whatsapp.com/channel/0029Vb6zZKpKbYMFqRWgx62q';
const { createTempFilePath, deleteTempFiles } = require('./tempManager');

const pending = new Map();
const recentlySent = new Map();
const recentlyFailed = new Map();
const inFlight = new Set();

const GAP_MS = 5 * 60 * 1000;
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;
const FAIL_WINDOW_MS = 30 * 60 * 1000;
const POOL_FETCH_BUDGET_MS = 45 * 1000;
const DOWNLOAD_PHASE_BUDGET_MS = 4 * 60 * 1000;
const CANDIDATE_BUDGET_MS = 60 * 1000;
const MAX_CANDIDATES = 8;

let ytPromise = null;
function getInnertube() {
  if (!ytPromise) ytPromise = Innertube.create({ retrieve_player: false });
  return ytPromise;
}

const STRIP_TAGS = /[([].*?(official|lyric|audio|video|music|visualizer|hq|hd|4k|slowed|reverb|sped\s?up|nightcore|remix|edit|version|instrumental|cover|karaoke|acoustic|live|bass\s?boosted|anniversary).*?[)\]]/gi;
const VARIANT_HINT = /cover|karaoke|instrumental|acoustic|remix|reverb|slowed|sped\s?up|nightcore|piano\s?version|live\s?session|anniversary\s?edition|lyric(s)?/i;

const normalize = (t = '') =>
  t.toLowerCase().replace(STRIP_TAGS, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

// YouTube artist names are not reliable: the same musician shows up as
// "Ed Sheeran", "Ed Sheeran - Topic", "EdSheeranVEVO", "Official Ed Sheeran".
// Normalize all of those to the same token so same-artist recommendations
// actually get filtered out instead of slipping through.
const artistClean = (a = '') =>
  a
    .toLowerCase()
    .replace(/\s*-\s*topic\s*$/i, '')
    .replace(/\s*-\s*(official\s*)?(channel|artist\s*channel|audio|video|lyric(s|s\s*video)?|music\s*video)\s*$/i, '')
    .replace(/^official\s+/i, '')
    .replace(/\s*vevo$/i, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, '')
    .trim();

const sameArtist = (a, b) => Boolean(artistClean(a)) && artistClean(a) === artistClean(b);

const formatSec = (s) => {
  const sec = Math.max(0, Math.round(Number(s) || 0));
  const m = Math.floor(sec / 60);
  return `${m}:${String(sec % 60).padStart(2, '0')}`;
};

const durationText = (v) => {
  if (typeof v?.durationText === 'string' && v.durationText) return v.durationText;
  if (typeof v?.duration === 'string') return v.duration;
  if (v?.duration?.text) return v.duration.text;
  if (Number.isFinite(v?.duration?.seconds)) return formatSec(v.duration.seconds);
  if (Number.isFinite(v?.durationSec)) return formatSec(v.durationSec);
  if (Number.isFinite(v?.seconds)) return formatSec(v.seconds);
  return '';
};

const buildWatchUrl = (videoId) => `https://www.youtube.com/watch?v=${videoId}`;

// A candidate is a "variant" (cover / live / lyrics version of the original
// track) when, after cleanup, it contains the original TITLE's own words.
//
// Key detail: originalTitle is the full YouTube upload title — e.g.
// "Billie Eilish - WILDFLOWER (Official Music Video)". The artist's name is
// inside it, so a naive token-ratio comparison gets diluted ("wildflower"
// vs "billie eilish wildflower" = 33% < the old 80% threshold) and lets
// "WILDFLOWER (Lyrics)" / "(Live)" variants slip through. We strip the
// artist's tokens out of the original first, then check:
//   - exact token equality (same song), or
//   - one title fully contains the other's core song tokens.
const tokenSet = (t = '') => new Set(normalize(t).split(' ').filter(Boolean));

const isVariantOf = (candidateTitle, originalTitle, originalArtist = '') => {
  const cTokens = tokenSet(candidateTitle);
  const aTokens = tokenSet(originalArtist);
  const oTokens = tokenSet(originalTitle);
  if (!cTokens.size || !oTokens.size) return false;

  const core = new Set([...oTokens].filter((t) => !aTokens.has(t)));
  if (!core.size) return false;

  // Same tokens after cleanup — same track.
  if (cTokens.size === oTokens.size && [...cTokens].every((t) => oTokens.has(t))) return true;

  // Candidate fully wraps the song's own name — e.g. "wildflower (lyrics)".
  if ([...core].every((t) => cTokens.has(t))) return true;

  // Candidate is just a subset of the song's name — e.g. "wildflower".
  if ([...cTokens].every((t) => core.has(t))) return true;

  return false;
};

// same-artist tracks and covers/versions of the original are exactly what we
// don't want — skip them up front, keeping the mix mood-similar.
const filterPool = (pool, originalTitle, originalArtist) =>
  (pool || []).filter(
    (pick) =>
      !isVariantOf(pick.title, originalTitle, originalArtist) &&
      !VARIANT_HINT.test(pick.title) &&
      !sameArtist(pick.authorName, originalArtist)
  );

// YouTube Music "Up Next" for a song is the same mood/genre mix as a Spotify
// radio — different artists, same vibe. Sources are run in parallel and merged
// in order of quality (Up Next first).
async function fetchCandidates(videoId, title) {
  const seen = new Set([videoId]);
  const out = [];
  const add = (id, candTitle, authorName, extra = {}) => {
    if (!id || !candTitle || seen.has(id)) return;
    seen.add(id);
    out.push({
      id,
      title: candTitle,
      authorName,
      durationText: durationText(extra) || '',
      ago: typeof extra.ago === 'string' ? extra.ago : '',
    });
  };

  const jobs = [];
  if (videoId) {
    jobs.push((async () => {
      try {
        const yt = await getInnertube();
        const upNext = await yt.music.getUpNext(videoId);
        for (const item of upNext?.contents || []) {
          if (item?.type !== 'PlaylistPanelVideo') continue;
          const artists = (item.artists || [])
            .map((a) => a?.name?.toString?.() || a?.toString?.() || '')
            .filter(Boolean)
            .join(', ');
          add(item.video_id, item.title?.toString?.() || '', artists, item);
        }
      } catch (err) {
        console.warn('[songRecommend] getUpNext unavailable:', err.message);
      }
    })());
  }

  for (const query of [`songs like ${title}`, `similar to ${title}`]) {
    jobs.push((async () => {
      try {
        const res = await yts(query);
        for (const v of res?.videos || []) {
          add(v.videoId, v.title, v.author?.name || v.author || '', v);
        }
      } catch (_) {}
    })());
  }

  await Promise.allSettled(jobs);
  return out;
}

const timebox = (promise, ms, label = '') => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Timed out after ${Math.round(ms / 1000)}s${label ? ` (${label})` : ''}`)),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

async function detectExt(filePath) {
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
}

async function resolveAudioDownload(youtubeUrl, query) {
  try {
    const media = await getSong(youtubeUrl);
    if (media?.filePath) {
      return { payload: { title: media.title || 'Song' }, localPath: media.filePath };
    }
  } catch (_) {}
  try {
    const payload = await APIs.getEliteProTechDownloadByUrl(youtubeUrl);
    if (payload?.download) return { payload, mediaUrl: payload.download };
  } catch (_) {}
  throw new Error('All audio sources failed.');
}

const sanitizeFileName = (value, fallback = 'song') => {
  const clean = (value || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '').replace(/\s+/g, ' ').trim() || fallback;
  return clean.length > 80 ? `${clean.slice(0, 77).trimEnd()}...` : clean;
};

const buildCaption = ({ title, author, ago, duration, senderNum }) =>
  `⧯ *𝙹𝙰𝙸𝙻𝙱𝚁𝙴𝙰𝙺_𝚂𝚁* 𝙱𝚁𝙸𝙽𝙶𝚂 𝚈𝙾𝚄\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯\n◈ *𝚃𝙸𝚃𝙻𝙴 :* \`${title}\`\n◈ *𝙰𝚁𝚃𝙸𝚂𝚃 :* \`${author}\`\n◈ *𝚁𝙴𝙻𝙴𝙰𝚂𝙴𝙳 :* \`${ago || '—'}\`\n◈ *𝙳𝚄𝚁𝙰𝚃𝙸𝙾𝙽 :* \`${duration || '—'}\`\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯\n⎆ @${senderNum} _ENJOY_ 🎧\n▸ *CHANNEL:* ${CHANNEL_URL}\n> ☬ *𝚂𝙾𝚄𝚁𝙲𝙴 :* 𝙹𝙰𝙸𝙻𝙱𝚁𝙴𝙰𝙺 ☬`;

// Download + send one candidate, iterating until one succeeds or the phase
// budget is exhausted. Runs inside downloadQueue so downloads stay at the
// same 2-way concurrency as regular song.js fetches.
async function sendBestCandidate(meta, pool, deadline) {
  const { sock, from, jid, senderJid, title, artist } = meta;
  const mentionJid = senderJid || jid;
  const senderNum = (mentionJid || '').split('@')[0] || '?';

  for (const pick of pool) {
    if (Date.now() > deadline) break;
    if (recentlySent.has(pick.id)) continue;
    if (recentlyFailed.has(pick.id)) continue;

    let rawPath = null;
    let finalPath = null;
    try {
      const resolved = await timebox(
        resolveAudioDownload(buildWatchUrl(pick.id), `${pick.title} ${pick.authorName}`),
        CANDIDATE_BUDGET_MS,
        `download-${pick.id}`
      );

      if (resolved.localPath) {
        rawPath = resolved.localPath;
      } else {
        rawPath = createTempFilePath('recommend', 'raw');
        await timebox(
          downloadToDisk(resolved.mediaUrl, rawPath),
          Math.min(CANDIDATE_BUDGET_MS, Math.max(0, deadline - Date.now())),
          `fetch-${pick.id}`
        );
      }

      const ext = await detectExt(rawPath);
      if (ext === 'mp3') {
        finalPath = rawPath;
      } else {
        finalPath = createTempFilePath('recommend', 'mp3');
        await toAudioFile(rawPath, finalPath);
      }

      const fileName = `${sanitizeFileName(pick.authorName, 'Unknown Artist')} - ${sanitizeFileName(pick.title, 'song')}.mp3`;

      await sock.sendMessage(from, {
        document: { url: finalPath },
        mimetype: 'audio/mpeg',
        fileName,
        caption: buildCaption({
          title: pick.title,
          author: pick.authorName,
          ago: pick.ago,
          duration: pick.durationText,
          senderNum,
        }),
        mentions: [mentionJid],
      });

      recentlySent.set(pick.id, Date.now());

      await sock.sendMessage(from, {
        text: `🎵 @${senderNum} — you liked *${title}* by _${artist}_, thought you'd like this one too! Check it out 👆`,
        mentions: [mentionJid],
      });
      return;
    } catch (err) {
      recentlyFailed.set(pick.id, Date.now());
      console.warn(`[songRecommend] candidate "${pick.title}" failed:`, err.message);
    } finally {
      setImmediate(() => deleteTempFiles([rawPath, finalPath].filter(Boolean)));
    }
  }

  await sock.sendMessage(from, {
    text: `🎵 @${senderNum} — couldn't find a different-artist track close to *${title}* by _${artist}_. Try requesting another song!`,
    mentions: [mentionJid],
  });
}

async function attemptRecommend(meta) {
  const { sock, from, jid, senderJid, videoId, title, artist } = meta;

  // Never run two recommendation passes for the same chat at once — the 5-min
  // timer can fire again while a slow pass is still downloading.
  if (inFlight.has(jid)) return;
  inFlight.add(jid);

  try {
    const now = Date.now();
    for (const [id, ts] of recentlySent) {
      if (now - ts > DEDUPE_WINDOW_MS) recentlySent.delete(id);
    }
    for (const [id, ts] of recentlyFailed) {
      if (now - ts > FAIL_WINDOW_MS) recentlyFailed.delete(id);
    }

    if (!meta._pool) {
      const rawPool = await timebox(
        fetchCandidates(videoId, title),
        POOL_FETCH_BUDGET_MS,
        'pool-fetch'
      );
      meta._pool = filterPool(rawPool, title, artist).slice(0, MAX_CANDIDATES);
    }

    if (!meta._pool.length) {
      const mentionJid = senderJid || jid;
      const senderNum = (mentionJid || '').split('@')[0] || '?';
      await sock.sendMessage(from, {
        text: `🎵 @${senderNum} — couldn't find a different-artist track close to *${title}* by _${artist}_. Try requesting another song!`,
        mentions: [mentionJid],
      });
      return;
    }

    const deadline = Date.now() + DOWNLOAD_PHASE_BUDGET_MS;
    await downloadQueue.run(() => sendBestCandidate(meta, meta._pool, deadline));
  } catch (err) {
    console.error('[songRecommend] failed:', err.message);
  } finally {
    inFlight.delete(jid);
  }
}

function register({ sock, from, jid, senderJid, pushName, videoId, title, artist }) {
  const key = jid;
  clear(key);

  const timer = setTimeout(() => {
    pending.delete(key);
    attemptRecommend({ sock, from, jid, senderJid, pushName, videoId, title, artist });
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

module.exports = {
  register,
  clear,
  fetchCandidates,
  attemptRecommend,
  _internals: { normalize, artistClean, sameArtist, isVariantOf, tokenSet, filterPool, buildWatchUrl, sanitizeFileName, durationText, buildCaption },
};
