'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileP = promisify(execFile);

const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
const FFMPEG_URL = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-linux-x64';
const MAX_BYTES = 250 * 1024 * 1024;

async function ensure(binDir, name, url, envKey) {
  // Termux/ARM: if the user points at a native binary via the env var, don't
  // fetch the x86_64 static build (it would never run on the phone's CPU).
  const override = process.env[envKey];
  if (override) {
    console.log(`[ensure-bins] ${envKey}=${override} — skipping bundled download`);
    return null;
  }
  const target = path.join(binDir, name);
  try {
    await fsp.access(target, fs.constants.X_OK);
    console.log(`[ensure-bins] ${name} already present`);
    return target;
  } catch {
    // missing or not executable — (re)download
  }
  console.log(`[ensure-bins] downloading ${name} ...`);
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(300000) });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status} for ${name}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error(`${name} too large: ${buf.length} bytes`);
  await fsp.mkdir(binDir, { recursive: true });
  await fsp.writeFile(target, buf, { mode: 0o755 });
  console.log(`[ensure-bins] ${name} ready (${(buf.length / 1048576).toFixed(1)} MiB)`);
  return target;
}

(async () => {
  try {
    const binDir = path.join(__dirname, '..', 'bin');
    const yt = await ensure(binDir, 'yt-dlp', YTDLP_URL, 'YTDLP_BINARY');
    const ff = await ensure(binDir, 'ffmpeg', FFMPEG_URL, 'FFMPEG_BINARY');
    const [ytRes, ffRes] = await Promise.all([
      yt ? execFileP(yt, ['--version']).catch(() => ({ stdout: '' })) : Promise.resolve({ stdout: '' }),
      ff ? execFileP(ff, ['-version']).catch(() => ({ stdout: '' })) : Promise.resolve({ stdout: '' }),
    ]);
    if (ytRes.stdout) console.log(`[ensure-bins] yt-dlp: ${ytRes.stdout.split('\n')[0]}`);
    if (ffRes.stdout) console.log(`[ensure-bins] ffmpeg: ${ffRes.stdout.split('\n')[0]}`);
    if (!yt && !ff) console.log('[ensure-bins] using system yt-dlp/ffmpeg (env overrides)');

    const cookiesB64 = process.env.COOKIES_B64;
    const cookiesPath = process.env.COOKIES_FILE || path.join(__dirname, '..', 'cookies.txt');
    let cookiesContent = null;
    if (cookiesB64) {
      await fsp.mkdir(path.dirname(cookiesPath), { recursive: true });
      cookiesContent = Buffer.from(cookiesB64, 'base64');
      await fsp.writeFile(cookiesPath, cookiesContent);
      console.log(`[ensure-bins] wrote ${cookiesContent.length} bytes of cookies to ${cookiesPath}`);
    } else {
      try {
        cookiesContent = await fsp.readFile(cookiesPath);
        console.log(`[ensure-bins] using committed cookies from ${cookiesPath}`);
      } catch {
        console.log('[ensure-bins] no cookies file present; running without cookies');
      }
    }

    // YouTube cookies are stripped into a second file: an authenticated YouTube
    // session removes the android/ios clients (no cookie support), and without
    // them yt-dlp never mints a player PO Token, so datacenter IPs stay stuck
    // on the "Sign in to confirm you're not a bot" wall. Other platforms
    // (tiktok/instagram/facebook) keep their cookies in both files.
    if (cookiesContent) {
      const noYtPath = path.join(path.dirname(cookiesPath), 'cookies-noyt.txt');
      const noYt = String(cookiesContent).split('\n').filter((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return true;
        const domain = trimmed.replace(/^#HttpOnly_/, '').split('\t')[0] || '';
        return !/youtube|google/.test(domain);
      }).join('\n');
      await fsp.writeFile(noYtPath, noYt);
      console.log(`[ensure-bins] wrote cookies-noyt.txt (${noYt.length} bytes, YouTube cookies stripped)`);
    }
  } catch (err) {
    console.error('[ensure-bins] FAILED:', err?.message || err);
    process.exit(1);
  }
})();