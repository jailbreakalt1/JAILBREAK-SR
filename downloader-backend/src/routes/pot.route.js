'use strict';

const express = require('express');
const path = require('path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileP = promisify(execFile);

const router = express.Router();

const POT_PORT = Number(process.env.POT_PORT || 4416);
const PLUGIN_DIR = path.join(__dirname, '..', '..', 'bin', 'yt-dlp-plugins', 'bgutil-ytdlp-pot-provider');

router.get('/logs', (_req, res) => {
  const fs = require('fs');
  const logPath = path.join(__dirname, '..', '..', 'pot-server', 'pot.log');
  try {
    const content = fs.readFileSync(logPath, 'utf8');
    res.json({ log: content.split('\n').slice(-80).join('\n') });
  } catch (err) {
    res.status(404).json({ error: err?.message || 'no log file' });
  }
});

router.get('/status', async (req, res) => {
  const report = { potServer: null, plugin: null, ytDlp: null };

  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const ping = await fetch(`http://127.0.0.1:${POT_PORT}/ping`, { signal: AbortSignal.timeout(4000) });
        report.potServer = await ping.json();
        break;
      } catch (err) {
        if (attempt === 2) throw err;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  } catch (err) {
    report.potServer = { error: err?.message || String(err) };
  }

  const fs = require('fs');
  report.plugin = fs.existsSync(PLUGIN_DIR) ? { dir: PLUGIN_DIR, present: true } : { present: false };

  try {
    const cookiesMode = req.query.cookies || 'noyt';
    const cookiesFile = cookiesMode === 'full'
      ? path.join(__dirname, '..', '..', 'cookies.txt')
      : cookiesMode === 'none' ? undefined
        : path.join(__dirname, '..', '..', 'cookies-noyt.txt');
    const clients = req.query.clients
      || 'web,web_safari,web_embedded,web_creator,tv_embedded,mweb,tv,ios,android';
    const probeArgs = ['--plugin-dirs', PLUGIN_DIR, '-v', '--simulate', '--no-warnings'];
    if (cookiesFile) probeArgs.push('--cookies', cookiesFile);
    else probeArgs.push('--no-cookies');
    probeArgs.push('--extractor-args', `youtube:player_client=${clients}`);
    probeArgs.push('https://www.youtube.com/watch?v=jNQXAC9IVRw');

    const { stdout, stderr } = await execFileP(
      path.join(__dirname, '..', '..', 'bin', 'yt-dlp'),
      probeArgs,
      { timeout: 45000, maxBuffer: 4 * 1024 * 1024 },
    );
    const combined = `${stdout}\n${stderr}`;
    const potLine = (combined.match(/PO Token Providers:[^\n]*/) || [])[0] || null;
    const fetchLine = (combined.match(/Retrieved a [A-Z]+ PO Token[^\n]*/) || [])[0] || null;
    const signIn = combined.includes("Sign in to confirm you're not a bot");
    const playability = [...combined.matchAll(/(\w+) player response playability status: (\w+)/g)]
      .map((m) => `${m[1]}=${m[2]}`).join(' ');
    report.ytDlp = {
      version: (combined.match(/yt-dlp version[^\n]*|yt-dlp[^\n]*\(c\)[^\n]*/) || ['unknown'])[0].trim(),
      potLine,
      fetchLine,
      signIn,
      playability: playability || null,
    };
  } catch (err) {
    report.ytDlp = { error: err?.message || String(err) };
  }

  res.json(report);
});

module.exports = router;