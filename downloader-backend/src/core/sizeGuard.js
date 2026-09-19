'use strict';

const fsp = require('fs/promises');
const path = require('path');
const { execa } = require('execa');
const config = require('../config');
const tempFileManager = require('./tempFileManager');
const { FileTooLargeError } = require('../utils/errors');

const LIMIT_BYTES = config.maxMediaSizeMb * 1024 * 1024;

function encodeArgs(mediaType, filePath, outPath) {
  const ext = path.extname(outPath).toLowerCase();
  if (mediaType === 'image') {
    return ['-y', '-i', filePath, '-vf', 'scale=1080:-2', '-q:v', '3', outPath];
  }
  if (mediaType === 'audio') {
    return ['-y', '-i', filePath, '-b:a', '96k', outPath];
  }
  return ['-y', '-i', filePath, '-vf', 'scale=1280:-2', '-crf', '28', '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '96k', outPath];
}

async function ensureWithinLimit({ filePath, mediaType }) {
  const stat = await fsp.stat(filePath);
  if (stat.size <= LIMIT_BYTES) {
    return { filePath, sizeBytes: stat.size, reencoded: false };
  }

  const dir = path.dirname(filePath);
  const ext = mediaType === 'audio' ? 'mp3' : 'mp4';
  const outPath = path.join(dir, `${path.basename(filePath, path.extname(filePath))}-reencoded.${ext}`);

  try {
    const result = await execa(config.ffmpegBinary, encodeArgs(mediaType, filePath, outPath), {
      reject: false,
      timeout: config.ytdlpTimeoutMs,
    });
    if (result.exitCode !== 0) {
      throw new Error(`ffmpeg failed with exit code ${result.exitCode}`);
    }
    const newStat = await fsp.stat(outPath);
    if (newStat.size > LIMIT_BYTES) {
      throw new Error('re-encoded file still exceeds limit');
    }
    await fsp.unlink(filePath);
    return { filePath: outPath, sizeBytes: newStat.size, reencoded: true };
  } catch (err) {
    try {
      await fsp.unlink(outPath);
    } catch {
      // swallow
    }
    try {
      await tempFileManager.cleanup(dir);
    } catch {
      // swallow cleanup errors
    }
    throw new FileTooLargeError('That file is too large to send here.', {
      details: { sizeBytes: stat.size, cause: err.message },
    });
  }
}

module.exports = { ensureWithinLimit };
