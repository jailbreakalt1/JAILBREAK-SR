'use strict';

const path = require('path');
const os = require('os');
const binPaths = require('./binPaths');

module.exports = {
  port: Number(process.env.PORT || 30102),
  maxMediaSizeMb: Number(process.env.MAX_MEDIA_SIZE_MB || 16),
  ytdlpTimeoutMs: Number(process.env.YTDLP_TIMEOUT_MS || 40000),
  mediaTimeoutMs: Number(process.env.MEDIA_TIMEOUT_MS || 120000),
  logLevel: process.env.LOG_LEVEL || 'info',
  ytDlpBinary: binPaths.ytDlpBinary,
  ffmpegBinary: binPaths.ffmpegBinary,
  tempRoot: process.env.TEMP_ROOT || path.join(os.tmpdir(), 'dl-backend'),
  cookiesFile: process.env.COOKIES_FILE || path.join(__dirname, '..', 'cookies.txt'),
  quotaToken: process.env.QUOTA_API_TOKEN || '',
  quotaDbPath: process.env.QUOTA_DB_PATH || path.join(__dirname, '..', 'data', 'quota.db'),
  quotaLimit: Number(process.env.QUOTA_DAILY_LIMIT || 10),
};
