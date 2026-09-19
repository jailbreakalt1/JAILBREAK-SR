'use strict';

const fs = require('fs');
const path = require('path');

const CONTENT_TYPES = {
  mp4: 'video/mp4',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  mov: 'video/quicktime',
  m4v: 'video/mp4',
  avi: 'video/x-msvideo',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  avif: 'image/avif',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  aac: 'audio/aac',
  opus: 'audio/opus',
};

function contentTypeFor(ext) {
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

function contentTypeForMediaType(mediaType, ext) {
  if (mediaType === 'video') return 'video/mp4';
  if (mediaType === 'image') {
    return contentTypeFor(ext) !== 'application/octet-stream' ? contentTypeFor(ext) : 'image/jpeg';
  }
  if (mediaType === 'audio') return 'audio/mpeg';
  return contentTypeFor(ext);
}

function sanitizeFilename(title, ext) {
  const cleaned = title.replace(/[^\w\s-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (cleaned) return `${cleaned}.${ext}`;
  return `media-${Date.now()}.${ext}`;
}

// HTTP headers must be latin-1 encodable; titles from TikTok/Instagram carry
// emoji and other non-latin1 chars which crash res.setHeader with
// ERR_INVALID_CHAR. Strip anything outside latin-1 (keep it readable).
function headerSafe(value) {
  return String(value || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[^\u0020-\u00FF]/g, '')
    .trim()
    .slice(0, 200);
}

function streamFile(res, { filePath, title, platform, mediaType, onComplete }) {
  const ext = path.extname(filePath).replace('.', '').toLowerCase();
  const contentType = contentTypeForMediaType(mediaType, ext);
  const filename = sanitizeFilename(title || 'media', ext);
  const headerTitle = headerSafe(title);

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  if (headerTitle) res.setHeader('X-Media-Title', headerTitle);
  res.setHeader('X-Media-Platform', headerSafe(platform));
  res.setHeader('X-Media-Type', mediaType);

  const stat = fs.statSync(filePath);
  res.setHeader('Content-Length', stat.size);

  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    res.destroy();
  });
  stream.on('close', () => {
    if (typeof onComplete === 'function') onComplete(filePath);
    if (!res.writableEnded) res.end();
  });
  stream.pipe(res);
}

module.exports = { streamFile, contentTypeFor };
