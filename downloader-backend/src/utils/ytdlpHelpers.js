'use strict';

const path = require('path');
const fsp = require('fs/promises');
const {
  AppError,
  ExtractionTimeoutError,
  ContentRequiresLoginError,
  RateLimitedError,
  FileTooLargeError,
  PlatformTemporarilyUnavailable,
  DownloadFailedError,
} = require('./errors');

const EXT_MEDIA_TYPE = {
  video: ['mp4', 'mkv', 'webm', 'mov', 'm4v', 'avi'],
  image: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'avif'],
  audio: ['mp3', 'm4a', 'ogg', 'wav', 'aac', 'opus'],
};

function mediaTypeFor(ext) {
  for (const [type, exts] of Object.entries(EXT_MEDIA_TYPE)) {
    if (exts.includes(ext)) return type;
  }
  return null;
}

function mapFailure(result) {
  const output = `${result.stderr || ''}\n${result.stdout || ''}`.toLowerCase();
  const exitCode = result.exitCode;
  const debug = `${result.stderr || ''}\n${result.stdout || ''}`.slice(-800);

  if (output.includes('file is larger than max-filesize')) {
    return new FileTooLargeError('That file is too large to send here.');
  }
  if (exitCode === 124 || output.includes('timeout') || output.includes('timed out')) {
    return new ExtractionTimeoutError('That took too long to fetch — try again.');
  }
  if (output.includes('login') || output.includes('log in') || output.includes('sign in') ||
      output.includes('requires authentication') || output.includes('private')) {
    return new ContentRequiresLoginError("That post isn't public, so I can't grab it.");
  }
  if (output.includes('rate limit') || output.includes('rate-limited') || output.includes('too many requests') ||
      output.includes('429') || output.includes('ip address is blocked') || output.includes('blocked from accessing')) {
    return new RateLimitedError('Getting rate-limited on that platform — try again shortly.');
  }
  if (output.includes('does not exist') || output.includes('not found') || output.includes('404') ||
      output.includes('unavailable') || output.includes('not available') || output.includes('video not available')) {
    return new DownloadFailedError("That link doesn't lead to any media.");
  }
  if (output.includes('unsupported url') || output.includes('unsupported') || output.includes('regex')) {
    return new DownloadFailedError("That link isn't supported.");
  }
  if (output.includes('unable to extract') || (output.includes('extract') && output.includes('failed'))) {
    return new PlatformTemporarilyUnavailable("That platform's downloader needs an update — flagged for a fix.");
  }
  return new DownloadFailedError('The download failed — try another link.', { debug });
}

async function findDownloadedFile(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const file = entries.find((entry) => entry.isFile());
  if (!file) {
    throw new DownloadFailedError('The download failed — try another link.');
  }
  return path.join(dir, file.name);
}

function parseTitleFromFile(filePath) {
  const baseName = path.basename(filePath, path.extname(filePath));
  const titleMatch = baseName.match(/^(.*) \[[^\]]+\]$/);
  return (titleMatch ? titleMatch[1] : baseName || 'untitled').slice(0, 150) || 'untitled';
}

function isHttpUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url.trim());
}

module.exports = {
  EXT_MEDIA_TYPE,
  mediaTypeFor,
  mapFailure,
  findDownloadedFile,
  parseTitleFromFile,
  isHttpUrl,
};
