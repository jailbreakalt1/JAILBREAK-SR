/**
 * Ensure the local jailbreakdl downloader backend is reachable before the
 * bot connects. If it isn't running, boot it from BACKEND_DIR (default: the
 * downloader-backend folder next to this repo, or ~/Documents/downloader-backend)
 * and wait a short while for it to come up. Never fatal — the bot's own
 * yt-dlp fallbacks still work if the backend can't start.
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const config = require('../config');
const BACKEND_URL = config.localBackend.baseUrl;

function resolveBackendDir() {
  if (config.localBackend.dir) return config.localBackend.dir;
  const candidates = [
    path.join(__dirname, '..', '..', 'downloader-backend'),
    path.join(process.env.HOME || '', 'downloader-backend'),
    path.join(process.env.HOME || '', 'Documents', 'downloader-backend'),
    '/root/Documents/downloader-backend',
  ];
  for (const dir of candidates) {
    if (dir && fs.existsSync(path.join(dir, 'package.json')) &&
        fs.existsSync(path.join(dir, 'src', 'server.js'))) return dir;
  }
  return null;
}

async function backendUp() {
  try {
    const res = await axios.get(`${BACKEND_URL}/health`, { timeout: 2500 });
    return res.status === 200;
  } catch (_) {
    return false;
  }
}

async function ensureLocalBackend() {
  if (await backendUp()) return true;

  const dir = resolveBackendDir();
  if (!dir) {
    console.warn('[BACKEND] downloader-backend not found — continuing with bot-side yt-dlp fallback');
    return false;
  }

  console.log(`[BACKEND] ${BACKEND_URL} down — starting jailbreakdl from ${dir}...`);
  try {
    const proc = spawn('npm', ['start'], {
      cwd: dir,
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    });
    proc.unref();
  } catch (e) {
    console.error('[BACKEND] failed to spawn jailbreakdl:', e.message);
    return false;
  }

  for (let i = 0; i < 12; i++) { // up to ~30s
    await new Promise((r) => setTimeout(r, 2500));
    if (await backendUp()) {
      console.log('[BACKEND] jailbreakdl is up.');
      return true;
    }
  }

  console.warn('[BACKEND] jailbreakdl did not come up in time — continuing with bot-side fallback');
  return false;
}

module.exports = { ensureLocalBackend, backendUp, BACKEND_URL };