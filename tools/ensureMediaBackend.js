/**
 * Ensure the vendored Python media backend (JAILBREAK-MEDIA-BACKEND) is up on
 * 127.0.0.1:8000 before the bot serves social links. Same philosophy as
 * tools/ensureBackend.js: if it's down, bootstrap the venv + spawn uvicorn
 * detached, poll /api/health, and NEVER make it fatal. On Termux this also
 * works (plain `uvicorn` — no [standard] extras — so no uvloop/httptools
 * compile steps on ARM).
 */

const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const config = require('../config');
const MEDIA_BASE_URL = config.mediaBackend.baseUrl;
const MEDIA_PORT = config.mediaBackend.port;

const execFileP = promisify(execFile);

function resolveMediaBackendDir() {
  const override = config.mediaBackend.dir;
  if (override) return override;
  const candidates = [
    path.join(__dirname, '..', 'JAILBREAK-MEDIA-BACKEND'),
    path.join(__dirname, '..', 'media-backend'),
    path.join(__dirname, '..', '..', 'JAILBREAK-MEDIA-BACKEND'),
    path.join(process.env.HOME || '', 'JAILBREAK-MEDIA-BACKEND'),
    path.join(process.env.HOME || '', 'Documents', 'JAILBREAK-MEDIA-BACKEND'),
    '/root/Documents/JAILBREAK-MEDIA-BACKEND',
  ];
  for (const dir of candidates) {
    if (dir && fs.existsSync(path.join(dir, 'app.py')) &&
        fs.existsSync(path.join(dir, 'requirements.txt'))) return dir;
  }
  return null;
}

async function mediaBackendUp() {
  try {
    const res = await axios.get(`${MEDIA_BASE_URL}/api/health`, { timeout: 2500 });
    return res.status === 200 && res.data && res.data.ok === true;
  } catch (_) {
    return false;
  }
}

async function ensureVenv(dir) {
  const venvPy = path.join(dir, '.venv', 'bin', 'python');
  if (fs.existsSync(venvPy)) return venvPy;

  console.log('[MEDIA-BACKEND] creating .venv...');
  await execFileP('python3', ['-m', 'venv', path.join(dir, '.venv')], {
    cwd: dir,
    timeout: 300000,
  });

  console.log('[MEDIA-BACKEND] installing requirements (fastapi/uvicorn/requests/yt-dlp)...');
  await execFileP(venvPy, ['-m', 'pip', 'install', '--quiet', '-r', 'requirements.txt'], {
    cwd: dir,
    timeout: 600000,
  });
  return venvPy;
}

let state = 'unknown'; // 'up' | 'down' | 'booting' | 'disabled' | 'no-python'
let lastAttemptAt = 0;

async function pollUp(attempts) {
  for (let i = 0; i < attempts; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    if (await mediaBackendUp()) return true;
  }
  return false;
}

async function ensureMediaBackend() {
  if (await mediaBackendUp()) {
    state = 'up';
    return true;
  }

  const sinceLast = Date.now() - lastAttemptAt;
  if (state === 'booting' || (state === 'down' && sinceLast < 120000)) {
    // already (re)trying recently — just poll a little so the first social
    // request isn't a hard fail while bootstrapping
    const up = await pollUp(6);
    if (up) state = 'up';
    return up;
  }
  lastAttemptAt = Date.now();
  state = 'booting';

  const dir = resolveMediaBackendDir();
  if (!dir) {
    console.warn('[MEDIA-BACKEND] JAILBREAK-MEDIA-BACKEND not found — social downloads will be unavailable');
    state = 'disabled';
    return false;
  }

  try {
    const venvPy = await ensureVenv(dir);
    console.log(`[MEDIA-BACKEND] spawning uvicorn on 127.0.0.1:${MEDIA_PORT} from ${dir}`);
    const proc = execFile(venvPy, ['-m', 'uvicorn', 'app:app', '--host', '127.0.0.1', '--port', String(MEDIA_PORT), '--log-level', 'info'], {
      cwd: dir,
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    });
    proc.unref();
  } catch (err) {
    console.error('[MEDIA-BACKEND] bootstrap failed:', err?.message || err);
    state = 'no-python';
    return false;
  }

  const up = await pollUp(20); // up to ~40s
  if (up) {
    state = 'up';
    console.log('[MEDIA-BACKEND] jailbreak-media-backend is up.');
  } else {
    state = 'down';
    console.warn('[MEDIA-BACKEND] did not come up in time — continuing without it');
  }
  return up;
}

module.exports = { ensureMediaBackend, mediaBackendUp, MEDIA_BASE_URL };