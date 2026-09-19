/**
 * Zero-dependency .env loader for self-hosted (Termux/old-phone) installs.
 * Loading this at the very top of index.js populates process.env from a
 * local .env file BEFORE any module reads environment variables, so a bare
 * `git clone` + `npm i` + copy `.env.example .env` works with no shell env.
 */

const fs = require('fs');
const path = require('path');

function loadEnvFile(envPath) {
  let raw;
  try {
    raw = fs.readFileSync(envPath, 'utf8');
  } catch (_) {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      process.env[key] = value;
    }
  }
}

function loadDotEnv() {
  const here = __dirname;
  const candidates = [
    path.join(here, '.env'),
    path.join(here, '..', '.env'),
  ];
  for (const p of candidates) {
    loadEnvFile(p);
  }
}

module.exports = { loadDotEnv, loadEnvFile };