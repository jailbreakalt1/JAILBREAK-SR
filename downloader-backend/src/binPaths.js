'use strict';

const fs = require('fs');
const path = require('path');

const REPO_BIN = path.join(__dirname, '..', 'bin');

function findBinary(name, envKey) {
  const candidates = [];
  if (process.env[envKey]) candidates.push(process.env[envKey]);
  candidates.push(path.join(REPO_BIN, name), name);
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // try next
    }
  }
  return candidates[0];
}

module.exports = {
  ytDlpBinary: findBinary('yt-dlp', 'YTDLP_BINARY'),
  ffmpegBinary: findBinary('ffmpeg', 'FFMPEG_BINARY'),
};