const express = require('express');
const { randomUUID } = require('crypto');
const logger = require('../utils/logger');
const { detect, PLATFORMS } = require('../core/detector');
const { getAdapter } = require('../adapters');
const { extract } = require('../core/extractor');
const { ensureWithinLimit } = require('../core/sizeGuard');
const { streamFile } = require('../core/streamer');
const tempFileManager = require('../core/tempFileManager');
const { AppError, DownloadFailedError } = require('../utils/errors');

const router = express.Router();

router.post('/download', async (req, res, next) => {
  const requestId = randomUUID();
  const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';

  if (!url) {
    return res.status(400).json({ error: 'BadRequest', message: 'Provide a "url" field in the JSON body.' });
  }

  const platform = detect(url);
  if (platform === PLATFORMS.UNKNOWN) {
    return res.status(422).json({ error: 'UnsupportedPlatformError', message: "That link isn't from a supported platform." });
  }

  let adapter;
  try {
    adapter = getAdapter(platform);
  } catch (err) {
    return next(err);
  }

  try {
    const result = await extract({ url, adapter, requestId });
    const guarded = await ensureWithinLimit({
      filePath: result.filePath,
      mediaType: result.mediaType,
    });

    await new Promise((resolve, reject) => {
      streamFile(res, {
        filePath: guarded.filePath,
        title: result.title,
        platform: result.platform,
        mediaType: result.mediaType,
        onComplete: async (filePath) => {
          const dir = require('path').dirname(filePath);
          try { await tempFileManager.cleanup(dir); } catch (_) {}
          resolve();
        },
      });
      res.on('error', reject);
    });
  } catch (error) {
    try { await tempFileManager.cleanup(require('path').join(require('os').tmpdir(), 'dl-backend', requestId)); } catch (_) {}
    next(error);
  }
});

module.exports = router;