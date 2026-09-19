const express = require('express');
const { searchImages, MAX_COUNT, DEFAULT_COUNT } = require('../services/imageSearch');
const { ImageSearchError } = require('../utils/errors');

const router = express.Router();

function clampCount(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_COUNT;
  return Math.min(Math.max(Math.trunc(n), 1), MAX_COUNT);
}

router.get('/search', async (req, res, next) => {
  const query = typeof req.query?.q === 'string' ? req.query.q.trim() : '';
  if (!query) {
    return res.status(400).json({ error: 'BadRequest', message: 'Provide a "q" query parameter.' });
  }
  try {
    const images = await searchImages(query, clampCount(req.query.count));
    res.json({ images, query, count: images.length });
  } catch (error) {
    next(new ImageSearchError('Could not find images — try another query.'));
  }
});

router.post('/search', async (req, res, next) => {
  const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
  if (!query) {
    return res.status(400).json({ error: 'BadRequest', message: 'Provide a "query" field in the JSON body.' });
  }
  try {
    const images = await searchImages(query, clampCount(req.body.count));
    res.json({ images, query, count: images.length });
  } catch (error) {
    next(new ImageSearchError('Could not find images — try another query.'));
  }
});

module.exports = router;