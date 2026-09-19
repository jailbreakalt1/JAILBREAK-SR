'use strict';

const express = require('express');
const config = require('../config');
const quotaStore = require('../core/quotaStore');

const router = express.Router();

function authorized(req) {
  return Boolean(config.quotaToken) && req.get('authorization') === `Bearer ${config.quotaToken}`;
}

function protect(req, res, next) {
  if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized', message: 'Quota authorization required.' });
  next();
}

router.use(protect);

router.post('/check', (req, res, next) => {
  try { res.json(quotaStore.get(req.body?.user, req.body?.command)); } catch (err) { next(err); }
});

router.post('/consume', (req, res, next) => {
  try { res.json(quotaStore.consume(req.body?.user, req.body?.command)); } catch (err) { next(err); }
});

module.exports = router;
