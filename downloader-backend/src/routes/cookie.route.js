'use strict';

const express = require('express');
const { checkCookieFile } = require('../core/cookieHealth');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json(checkCookieFile());
});

module.exports = router;
