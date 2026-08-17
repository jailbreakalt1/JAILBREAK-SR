const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { createTempFilePath, deleteTempFile } = require('./tempManager');
/**
 * Bot-side HTTP client for the standalone media backend
 * (JAILBREAK-MEDIA-BACKEND, deployable on Render).
 *
 * Contract: POST /api/download with JSON { url } → the backend streams the
 * media file (single item) with X-Media-Title / X-Media-Platform /
 * X-Media-Type headers. Errors come back as JSON { error, message }.
 *
 * Point the bot at it via MEDIA_BACKEND_URL, e.g.:
 *   MEDIA_BACKEND_URL=https://jailbreakdl.onrender.com   npm start
 */

const REQUEST_TIMEOUT_MS = 120000;

// Ceiling for media we're willing to stage on disk for a WhatsApp send.
// Staging first means a dead download URL can never make the actual send
// fail mid-flight — the file is already local when we hand it to Baileys.
const MAX_STAGED_BYTES = 64 * 1024 * 1024;

const EXT_BY_CONTENT_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
};

function backendBase() {
  return (config.mediaBackend && config.mediaBackend.url) || 'https://jailbreakdl.onrender.com';
}

function backendHeaders() {
  const token = config.mediaBackend && config.mediaBackend.token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readErrorBody(response) {
  let text = '';
  return new Promise((resolve) => {
    if (!response.data || typeof response.data.on !== 'function') {
      return resolve(`Server error (${response.status}).`);
    }
    response.data.on('data', (chunk) => {
      if (text.length < 65536) text += chunk.toString();
    });
    response.data.on('end', () => {
      try {
        const parsed = JSON.parse(text);
        resolve(parsed?.message || `Server error (${response.status}).`);
      } catch {
        resolve(`Server error (${response.status}).`);
      }
    });
    response.data.on('error', () => resolve(`Server error (${response.status}).`));
  });
}

function extFromDisposition(disposition) {
  const match = disposition && disposition.match(/filename="?([^";]+)"?/i);
  if (match) {
    const ext = path.extname(match[1]).replace('.', '').toLowerCase();
    if (ext && /^[a-z0-9]{2,5}$/.test(ext)) return ext;
  }
  return null;
}

/**
 * Downloads one media item from the backend into the bot's temp dir.
 * Returns { filePath, ext, mediaType, title, platform }.
 */
async function backendDownload(apiPath, url) {
  const response = await axios.post(`${backendBase()}${apiPath}`, { url }, {
    responseType: 'stream',
    timeout: REQUEST_TIMEOUT_MS,
    headers: backendHeaders(),
    validateStatus: () => true,
    maxRedirects: 0,
  });

  if (response.status !== 200) {
    throw new Error(await readErrorBody(response));
  }

  const headers = response.headers || {};
  const ext = extFromDisposition(headers['content-disposition']) ||
              EXT_BY_CONTENT_TYPE[headers['content-type']] ||
              'bin';
  const filePath = createTempFilePath('media', ext);

  try {
    await new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(filePath);
      let received = 0;
      response.data.on('data', (chunk) => {
        received += chunk.length;
        if (received > MAX_STAGED_BYTES) {
          response.data.destroy(new Error(`File exceeds ${Math.round(MAX_STAGED_BYTES / 1024 / 1024)}MB — too big for WhatsApp.`));
        }
      });
      response.data.on('error', reject);
      writer.on('error', reject);
      writer.on('finish', resolve);
      response.data.pipe(writer);
    });

    const stat = await fs.promises.stat(filePath);
    if (!stat.size) throw new Error('Downloaded file is empty.');
  } catch (err) {
    deleteTempFile(filePath);
    throw err;
  }

  return {
    filePath,
    ext,
    mediaType: headers['x-media-type'] || 'video',
    title: headers['x-media-title'] || '',
    platform: headers['x-media-platform'] || '',
  };
}

const downloadMedia = (url) => backendDownload('/api/download', url);

/**
 * jailbreakdl media endpoints — songs (audio) and videos from any URL
 * (YouTube etc). Streamed by the backend, staged on disk here.
 */
const getSong = (url) => backendDownload('/api/media/audio', url);
const getVideo = (url) => backendDownload('/api/media/video', url);

/**
 * Sends a downloaded media item to a chat, then deletes the temp file.
 */
async function sendMediaMessage(sock, chatId, media, { caption, quoted }) {
  try {
    if (media.mediaType === 'video' || /^(mp4|mkv|webm|mov|m4v|avi)$/.test(media.ext)) {
      await sock.sendMessage(chatId, {
        video: { url: media.filePath },
        mimetype: 'video/mp4',
        caption,
      }, { quoted });
    } else {
      await sock.sendMessage(chatId, {
        image: { url: media.filePath },
        caption,
      }, { quoted });
    }
  } finally {
    deleteTempFile(media.filePath);
  }
}

const getInstagram = (url) => downloadMedia(url);
const getPinterest = (url) => downloadMedia(url);
const getTikTok = (url) => downloadMedia(url);
const getFacebook = (url) => downloadMedia(url);

/**
 * Image search via the backend (DuckDuckGo/Bing).
 * Returns an array of direct image URLs.
 */
async function imageSearch(query, count = 10) {
  const response = await axios.post(`${backendBase()}/api/img/search`, { query, count }, {
    timeout: 60000,
    headers: backendHeaders(),
    validateStatus: () => true,
  });
  if (response.status !== 200) {
    throw new Error(response.data?.message || `Image search failed (${response.status}).`);
  }
  return response.data?.images || [];
}

function getBackendStatus() {
  return axios.get(`${backendBase()}/health`, { timeout: 5000, headers: backendHeaders() })
    .then(res => ({ reachable: true, data: res.data }))
    .catch(() => ({ reachable: false, data: null }));
}

/**
 * Streams a URL straight to a file on disk (chunked — never held in RAM),
 * then validates the result is non-empty and under MAX_STAGED_BYTES.
 * Returns the final size in bytes. Throws with a readable message when the
 * stream dies or the file comes back empty/oversized.
 */
async function downloadToDisk(url, destPath, { timeout = 90000, headers = {} } = {}) {
  const response = await axios.get(url, {
    responseType: 'stream',
    timeout,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: '*/*',
      'Accept-Encoding': 'identity',
      ...headers,
    },
    validateStatus: (status) => status >= 200 && status < 400,
  });

  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(destPath);
    let received = 0;
    const onData = (chunk) => {
      received += chunk.length;
      if (received > MAX_STAGED_BYTES) {
        response.data.destroy(new Error(`File exceeds ${Math.round(MAX_STAGED_BYTES / 1024 / 1024)}MB — too big for WhatsApp.`));
      }
    };
    response.data.on('data', onData);
    response.data.on('error', reject);
    writer.on('error', reject);
    writer.on('finish', resolve);
    response.data.pipe(writer);
  });

  const stat = await fs.promises.stat(destPath);
  if (!stat.size) throw new Error('Downloaded file is empty.');
  if (stat.size > MAX_STAGED_BYTES) throw new Error(`File exceeds ${Math.round(MAX_STAGED_BYTES / 1024 / 1024)}MB — too big for WhatsApp.`);
  return stat.size;
}

module.exports = {
  getInstagram,
  getPinterest,
  getTikTok,
  getFacebook,
  getSong,
  getVideo,
  downloadMedia,
  sendMediaMessage,
  imageSearch,
  downloadToDisk,
  getBackendStatus,
};
