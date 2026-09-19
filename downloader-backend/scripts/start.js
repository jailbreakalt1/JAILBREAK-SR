'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// Load local/container secrets before any module reads configuration.
// The env file is intentionally ignored by Git and may be absent.
const ROOT = path.join(__dirname, '..');
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

// Ensure yt-dlp/ffmpeg binaries and the cookies files exist before anything
// starts. Exits the process on failure.
require('./ensure-bins.js');

const POT_PORT = Number(process.env.POT_PORT || 4416);
const POT_RESTART_LIMIT = 5;
const POT_LOG = path.join(ROOT, 'pot-server', 'pot.log');

const portArg = process.argv.find((a) => a.startsWith('--port='));
if (portArg) process.env.PORT = portArg.split('=')[1];

fs.mkdirSync(path.dirname(POT_LOG), { recursive: true });

let potRestarts = 0;
function startPotServer() {
  const out = fs.openSync(POT_LOG, 'a');
  const child = spawn(process.execPath, ['build/main.js', '-p', String(POT_PORT)], {
    cwd: path.join(ROOT, 'pot-server'),
    stdio: ['ignore', out, out],
  });
  child.on('exit', (code, signal) => {
    fs.closeSync(out);
    if (code === 0) return;
    console.error(`[start] POT server exited (${signal || code}); restarts: ${potRestarts}`);
    if (potRestarts < POT_RESTART_LIMIT) {
      potRestarts += 1;
      setTimeout(startPotServer, 5000);
    } else {
      console.error('[start] POT server restart limit reached — continuing without PO tokens.');
    }
  });
  return child;
}

startPotServer();

const app = spawn(process.execPath, ['src/server.js'], { cwd: ROOT, stdio: 'inherit' });
app.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
