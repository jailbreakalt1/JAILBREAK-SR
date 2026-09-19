'use strict';

const express = require('express');
const path = require('path');
const { randomUUID } = require('crypto');
const config = require('../config');
const { extractMedia, fetchInfo } = require('../core/mediaExtractor');
const { ensureWithinLimit } = require('../core/sizeGuard');
const { streamFile } = require('../core/streamer');
const tempFileManager = require('../core/tempFileManager');
const { isHttpUrl } = require('../utils/ytdlpHelpers');
const { AppError } = require('../utils/errors');

const router = express.Router();

function requestUrl(body) {
  const url = typeof body?.url === 'string' ? body.url.trim() : '';
  if (!url) {
    throw new AppError('Provide a "url" field in the JSON body.', { code: 'BadRequest', statusCode: 400 });
  }
  if (!isHttpUrl(url)) {
    throw new AppError('url must be an http(s) link.', { code: 'BadRequest', statusCode: 400 });
  }
  return url;
}

function requestKind(body) {
  const kind = (typeof body?.kind === 'string' ? body.kind : '').toLowerCase();
  if (kind !== 'audio' && kind !== 'video') {
    throw new AppError('Provide a "kind" of "audio" or "video".', { code: 'BadRequest', statusCode: 400 });
  }
  return kind;
}

function requestDir(requestId) {
  return path.join(config.tempRoot, requestId);
}

async function streamMedia(res, result) {
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
      onComplete: async () => {
        try { await tempFileManager.cleanup(requestDir(result.requestId)); } catch (_) {}
        resolve();
      },
    });
    res.on('error', reject);
  });
}

async function handleMedia(req, res, next, kind) {
  const requestId = randomUUID();
  try {
    const url = requestUrl(req.body);
    const result = await extractMedia({ url, requestId, kind });
    result.requestId = requestId;
    await streamMedia(res, result);
  } catch (error) {
    try { await tempFileManager.cleanup(requestDir(requestId)); } catch (_) {}
    next(error);
  }
}

router.post('/', async (req, res, next) => {
  try {
    const kind = requestKind(req.body);
    await handleMedia(req, res, next, kind);
  } catch (error) {
    next(error);
  }
});

router.post('/audio', async (req, res, next) => {
  await handleMedia(req, res, next, 'audio');
});

router.post('/video', async (req, res, next) => {
  await handleMedia(req, res, next, 'video');
});

router.post('/info', async (req, res, next) => {
  try {
    const url = requestUrl(req.body);
    const info = await fetchInfo({ url });
    res.json(info);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
