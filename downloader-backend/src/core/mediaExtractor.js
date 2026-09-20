'use strict';

const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const { execa } = require('execa');
const config = require('../config');
const tempFileManager = require('./tempFileManager');
const {
  mapFailure,
  findDownloadedFile,
  parseTitleFromFile,
} = require('../utils/ytdlpHelpers');
const { DownloadFailedError } = require('../utils/errors');
const { cookieArgs } = require('./cookieHealth');

// PO-token provider plugin (bgutil-ytdlp-pot-provider) lives in
// bin/yt-dlp-plugins — it mints botguard attestation tokens so YouTube
// lets datacenter IPs through the "Sign in to confirm you're not a bot" wall.
const PLUGIN_DIR = path.join(__dirname, '..', '..', 'bin', 'yt-dlp-plugins', 'bgutil-ytdlp-pot-provider');

function pluginArgs() {
  return fs.existsSync(PLUGIN_DIR) ? ['--plugin-dirs', PLUGIN_DIR] : [];
}

// Ported from the Flask backend's "ULTRA STABLE" yt-dlp options: multi-client
// fallback dramatically increases YouTube/song extraction stability.
// Android/iOS clients have PLAYER_PO_TOKEN_POLICY recommended=True, so when a
// PO token provider is registered yt-dlp mints a player token and sends it in
// the player request — the documented way past the "Sign in to confirm you're
// not a bot" wall on datacenter IPs. yt-dlp processes the client list in
// REVERSE order and stops fetching tokens after the first player response, so
// the token-capable clients must come LAST here (android first-tried).
// Keep the client list short. The android client is the PO-token-capable path
// used by the local bgutil server; the old nine-client list caused yt-dlp to
// mint several tokens and try multiple slow fallbacks for one request.
const YOUTUBE_STABILITY_ARGS = 'youtube:player_client=android';

// TikTok's web WAF serves a JS challenge to non-residential IPs (and
// intermittently to everyone), which yt-dlp's native solver can't always
// pass ("Unexpected response from webpage request"). Forcing the mobile API
// path (multi/aweme/detail) via `tiktok:app_info=` works far more reliably
// with a logged-in session (cookies-noyt.txt): each run gets a FRESH random
// device_id, so TikTok can't rate-limit a fixed device. The api_hostname is
// rotated across attempts for the same reason.
// NOTE: the CLI parser only honors the FIRST `ie:` prefix per --extractor-args
// flag, so tiktok args must be their OWN flag (never `;`-appended to the
// youtube flag — they get swallowed under the youtube key).
const TIKTOK_HOST_POOL = [
  'api19-normal-useast5.us.tiktok.com',
  'api16-normal-c-useast1a.tiktokv.com',
  'api22-normal-c-useast2a.tiktokv.com',
];

function tiktokArgs(attempt = 0) {
  const host = TIKTOK_HOST_POOL[attempt % TIKTOK_HOST_POOL.length];
  return `tiktok:app_info=;tiktok:api_hostname=${host}`;
}

// YouTube runs unauthenticated (see ensure-bins.js) so android/ios stay in the
// client list and the bgutil POT server can mint player tokens. Other
// platforms keep their cookies in cookies-noyt.txt.
function ytCookieArgs() {
  return cookieArgs(path.join(__dirname, '..', '..', 'cookies-noyt.txt'));
}

const AUDIO_STRATEGIES = ['bestaudio/best', 'best'];
// yt-dlp filters support no OR, and portrait reels report height as the tall
// dimension (e.g. 720x1278), so a height cap alone would always match some
// low 360p format and never reach the width pass. Width first (portrait),
// height second (landscape), `best` as the last resort.
const VIDEO_STRATEGIES = [
  'bestvideo[width<=720]+bestaudio/best[width<=720]/best',
  'bestvideo[height<=720]+bestaudio/best[height<=720]/best',
  'best',
];

function buildArgs({ url, dir, formatSelector, kind, tiktokAttempt = 0, convertMp3 = false }) {
  const args = [
    url,
    '--no-warnings',
    '--no-playlist',
    '--no-check-certificate',
    '--geo-bypass',
    ...ytCookieArgs(),
    ...pluginArgs(),
    '--retries', '2',
    '--fragment-retries', '2',
    '--extractor-retries', '1',
    '--concurrent-fragments', '4',
    '--extractor-args', YOUTUBE_STABILITY_ARGS,
    '--extractor-args', tiktokArgs(tiktokAttempt),
    '-f', formatSelector,
    '-o', path.join(dir, '%(title).100B [%(id)s].%(ext)s'),
    '--max-filesize', `${config.maxMediaSizeMb}m`,
    '--socket-timeout', '15',
  ];
  if (kind === 'video') {
    args.push('--merge-output-format', 'mp4');
  }
  if (convertMp3) {
    // Media players recognise MP3 as a real song; native bestaudio is
    // usually AAC-in-MP4 (.m4a) which most music apps won't catalogue.
    // -x --audio-format mp3 re-encodes; --embed-metadata writes ID3
    // title/artist/album so the player shows the song info.
    args.push('-x', '--audio-format', 'mp3', '--audio-quality', '5', '--embed-metadata');
    const ff = config.ffmpegBinary;
    if (typeof ff === 'string' && ff.includes('/')) {
      args.push('--ffmpeg-location', path.dirname(ff));
    }
  }
  return args;
}

async function runOnce({ url, dir, formatSelector, kind, convertMp3 = false }) {
  const args = buildArgs({ url, dir, formatSelector, kind, convertMp3 });
  // TikTok API/roundtrips fail fast when they fail — don't let a dead attempt
  // eat the whole 5-minute budget. Cap tiktok attempts at 90s each.
  const attemptTimeout = isTiktokUrl(url)
    ? Math.min(config.mediaTimeoutMs, 90000)
    : config.mediaTimeoutMs;
  let result;
  try {
    result = await execa(config.ytDlpBinary, args, {
      timeout: attemptTimeout,
      reject: false,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (spawnError) {
    console.error('[mediaExtractor] yt-dlp spawn failed:', spawnError?.message || spawnError);
    console.error('[mediaExtractor] binary:', config.ytDlpBinary, '| code:', spawnError?.code, '| cause:', spawnError?.cause?.code);
    throw new DownloadFailedError('The download failed — try another link.');
  }
  if (result.failed && !Number.isInteger(result.exitCode)) {
    console.error('[mediaExtractor] yt-dlp spawn failed silently; binary:', config.ytDlpBinary);
    throw new DownloadFailedError('The download failed — try another link.');
  }

  if (result.exitCode !== 0) {
    console.error('[mediaExtractor] yt-dlp failed:', result.stderr?.slice(-8000) || result.stdout?.slice(-8000));
    const err = mapFailure(result);
    err.debug = result.stderr?.slice(-8000) || result.stdout?.slice(-8000);
    throw err;
  }

  const filePath = await findDownloadedFile(dir);
  const stat = await fsp.stat(filePath);
  return {
    filePath,
    title: parseTitleFromFile(filePath),
    ext: path.extname(filePath).replace('.', '').toLowerCase(),
    sizeBytes: stat.size,
    mediaType: kind,
    platform: 'GENERIC',
  };
}

/**
 * Generic media download for ANY url yt-dlp understands (songs, videos, etc).
 * Tries a list of format strategies in order, like the Flask backend.
 * kind: 'audio' | 'video'
 */
function isTiktokUrl(url) {
  return typeof url === 'string' && /(^|\.)tiktok\.com\/?/i.test(url);
}

// TikTok's mobile API intermittently returns empty bodies per IP/device, so
// give tiktok requests several passes with rotated hosts (each run already
// gets a fresh random device_id via `tiktok:app_info=`).
function attemptList(kind, url) {
  const strategies = kind === 'audio' ? AUDIO_STRATEGIES : VIDEO_STRATEGIES;
  const list = [];
  // First try to deliver real MP3 (convert with the bundled/native ffmpeg);
  // if conversion is impossible the plain strategies below still fall back.
  if (kind === 'audio') list.push({ formatSelector: 'bestaudio/best', convertMp3: true });
  const passes = isTiktokUrl(url) ? 3 : 1;
  for (let pass = 0; pass < passes; pass += 1) {
    for (let i = 0; i < strategies.length; i += 1) {
      list.push({
        formatSelector: strategies[i],
        tiktokAttempt: pass * strategies.length + i,
      });
    }
  }
  return list;
}

async function extractMedia({ url, requestId, kind }) {
  const base = await tempFileManager.createRequestDir(requestId);
  const attempts = attemptList(kind, url);
  const errors = [];
  let lastDebug;
  try {
    for (let i = 0; i < attempts.length; i += 1) {
      const attemptDir = path.join(base, `${kind}-${i}`);
      await fsp.mkdir(attemptDir, { recursive: true });
      try {
        const { formatSelector, tiktokAttempt, convertMp3 } = attempts[i];
        return await runOnce({ url, dir: attemptDir, formatSelector, kind, tiktokAttempt, convertMp3 });
      } catch (err) {
        errors.push(`${attempts[i].formatSelector || 'default'}: ${err.message}`);
        if (err.debug) lastDebug = err.debug;
      }
    }
  } finally {
    // on success the file must remain until streamed; cleanup happens in route
  }
  await tempFileManager.cleanup(base).catch(() => {});
  throw new DownloadFailedError(`Media download failed after retries (${errors.join('; ')})`, { debug: lastDebug });
}

/**
 * Metadata-only info for /api/media/info (mirrors Flask's /video_info).
 */
async function fetchInfo({ url }) {
  const args = [
    url,
    '--no-warnings',
    '--no-playlist',
    '--no-check-certificate',
    '--geo-bypass',
    ...ytCookieArgs(),
    ...pluginArgs(),
    '--retries', '1',
    '--extractor-retries', '1',
    '--extractor-args', YOUTUBE_STABILITY_ARGS,
    '--extractor-args', tiktokArgs(0),
    '--socket-timeout', '10',
    '--skip-download',
    '--dump-single-json',
  ];
  let lastErr;
  for (let attempt = 0; attempt < (isTiktokUrl(url) ? 3 : 1); attempt += 1) {
    if (attempt > 0) {
      const flagIdx = args.indexOf('--extractor-args', args.indexOf('--extractor-args') + 1);
      args[flagIdx + 1] = tiktokArgs(attempt);
    }
    let result;
    try {
      result = await execa(config.ytDlpBinary, args, {
        timeout: config.mediaTimeoutMs,
        reject: false,
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch (spawnError) {
      console.error('[mediaExtractor] info spawn failed:', spawnError?.message || spawnError);
      throw new DownloadFailedError('The download failed — try another link.');
    }
    if (result.failed && !Number.isInteger(result.exitCode)) {
      throw new DownloadFailedError('The download failed — try another link.');
    }
    if (result.exitCode !== 0) {
      console.error('[mediaExtractor] info failed:', result.stderr?.slice(-2500) || result.stdout?.slice(-2500));
      lastErr = mapFailure(result);
      lastErr.debug = result.stderr?.slice(-8000) || result.stdout?.slice(-8000);
      continue;
    }
    const info = JSON.parse(result.stdout);
    return {
      title: info.title,
      author: info.uploader || info.channel,
      timestamp: info.duration_string || info.duration,
      thumbnail: info.thumbnail,
    };
  }
  throw lastErr || new DownloadFailedError('The download failed — try another link.');
}

module.exports = {
  extractMedia,
  fetchInfo,
  buildArgs,
  AUDIO_STRATEGIES,
  VIDEO_STRATEGIES,
  YOUTUBE_STABILITY_ARGS,
  tiktokArgs,
  TIKTOK_HOST_POOL,
  isTiktokUrl,
};
