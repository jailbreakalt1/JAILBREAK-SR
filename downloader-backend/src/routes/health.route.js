const express = require('express');
const { execa } = require('execa');
const config = require('../config');

const router = express.Router();

router.get('/', (_req, res) => res.json({ status: 'ok' }));

router.get('/health', async (_req, res) => {
  let ytDlpVersion = 'unknown';
  try {
    const { stdout } = await execa(config.ytDlpBinary, ['--version'], { timeout: 10000 });
    ytDlpVersion = stdout.trim() || 'unknown';
  } catch (err) {
    ytDlpVersion = `probe-failed ${err?.code || err?.cause?.code || ''}`.trim();
    console.error('[health] yt-dlp version probe failed:', err?.message || err, '| binary:', config.ytDlpBinary);
  }

  res.json({ status: 'ok', ytDlpVersion });
});

module.exports = router;