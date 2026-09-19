'use strict';

const path = require('path');
const fsp = require('fs/promises');
const { execa } = require('execa');
const config = require('../config');
const tempFileManager = require('./tempFileManager');
const {
  DownloadFailedError,
} = require('../utils/errors');
const {
  mediaTypeFor,
  mapFailure,
  findDownloadedFile,
  parseTitleFromFile,
} = require('../utils/ytdlpHelpers');

async function extract({ url, adapter, requestId }) {
  if (typeof adapter.preflight === 'function') {
    await adapter.preflight(url);
  }
  const dir = await tempFileManager.createRequestDir(requestId);
  try {
    const opts = adapter.getOptions(url);
    const args = [
      url,
      '--no-cookies',
      '--no-playlist',
      '--no-warnings',
        '-f',
      opts.formatSelector,
      '-o',
      path.join(dir, '%(title).100B [%(id)s].%(ext)s'),
      '--max-filesize',
      `${config.maxMediaSizeMb}m`,
      '--socket-timeout',
      '15',
    ];
    for (const [key, value] of Object.entries(opts.headers || {})) {
      args.push('--add-header', `${key}: ${value}`);
    }
    args.push(...(opts.extraArgs || []));

    let result;
    try {
      result = await execa(config.ytDlpBinary, args, {
        timeout: config.ytdlpTimeoutMs,
        reject: false,
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch (spawnError) {
      console.error('[extractor] yt-dlp spawn failed:', spawnError?.message || spawnError);
      console.error('[extractor] binary:', config.ytDlpBinary, '| code:', spawnError?.code, '| cause:', spawnError?.cause?.code);
      throw new DownloadFailedError('The download failed — try another link.');
    }
    if (result.failed && !Number.isInteger(result.exitCode)) {
      console.error('[extractor] yt-dlp spawn failed silently; binary:', config.ytDlpBinary);
      throw new DownloadFailedError('The download failed — try another link.');
    }

    if (result.exitCode !== 0) {
      const failure = mapFailure(result);
      // Pinterest image-only pins have no video streams — fall back to the
      // pin page's og:image before surfacing any error.
      if (adapter.fallbackToImage && /no video formats/i.test(`${result.stderr || ''} ${result.stdout || ''}`)) {
        try {
          const imagePath = await adapter.fallbackToImage(url, requestId, dir);
          const stat = await fsp.stat(imagePath);
          const ext = path.extname(imagePath).replace('.', '').toLowerCase();
          return {
            filePath: imagePath,
            title: 'Pinterest image',
            ext,
            sizeBytes: stat.size,
            mediaType: 'image',
            platform: adapter.platform,
          };
        } catch (fallbackError) {
          console.error('[extractor] pinterest image fallback failed:', fallbackError?.message);
          console.error('[extractor] yt-dlp failure output:', `${result.stderr || ''} ${result.stdout || ''}`.slice(0, 500));
        }
      }
      throw failure;
    }

    const filePath = await findDownloadedFile(dir);
    const stat = await fsp.stat(filePath);
    const ext = path.extname(filePath).replace('.', '').toLowerCase();
    const title = parseTitleFromFile(filePath);

    return {
      filePath,
      title,
      ext,
      sizeBytes: stat.size,
      mediaType: mediaTypeFor(ext) || opts.defaultMediaType || 'unknown',
      platform: adapter.platform,
    };
  } catch (err) {
    try {
      await tempFileManager.cleanup(dir);
    } catch {
      // swallow cleanup errors
    }
    throw err;
  }
}

module.exports = { extract };
