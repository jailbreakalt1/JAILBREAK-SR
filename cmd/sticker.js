/**
 * cmd/sticker.js
 *
 * Turn a replied image / gif into a WhatsApp sticker (webp) using ffmpeg.
 * Optional effect in the first arg: grayscale, bw, invert, blur.
 *
 * ffmpeg binary resolution order:
 *   1. FFMPEG_PATH env var
 *   2. downloader-backend/bin/ffmpeg (vendored, x86-64 / arm)
 *   3. plain `ffmpeg` on PATH
 */

const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { tempManager } = require('../tools/tempManager');

let cachedPath = null;
function smartResolveFfmpeg() {
    if (cachedPath) return cachedPath;
    const candidates = [];
    if (process.env.FFMPEG_PATH) candidates.push(process.env.FFMPEG_PATH);
    const repoRoot = path.join(__dirname, '..');
    for (const sub of ['bin/ffmpeg', 'downloader-backend/bin/ffmpeg']) {
        const p = path.join(repoRoot, sub);
        if (fs.existsSync(p)) candidates.push(p);
    }
    candidates.push('ffmpeg');
    for (const c of candidates) {
        try {
            const { spawnSync } = require('child_process');
            const probe = spawnSync(c, ['-version'], { timeout: 5000 });
            if (probe && !probe.error) { cachedPath = c; return c; }
        } catch (_) {}
    }
    return 'ffmpeg';
}

const EFFECT_VF = {
    grayscale: 'format=gray',
    bw:        'hue=s=0,format=gray',
    invert:    'negate',
    blur:      'boxblur=8:1',
};

function runFfmpeg(inputPath, vf, animated, outPath) {
    return new Promise((resolve, reject) => {
        const ff = smartResolveFfmpeg();
        const args = ['-y', '-i', inputPath, '-vf', vf];
        if (!animated) args.push('-frames:v', '1');
        args.push('-c:v', 'libwebp', '-loop', '0', '-q:v', '80', outPath);
        const child = spawn(ff, args, { stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        child.stderr.on('data', (d) => (stderr += d.toString()));
        const timer = setTimeout(() => child.kill('SIGKILL'), 45000);
        child.on('error', (err) => { clearTimeout(timer); reject(err); });
        child.on('close', (code) => {
            clearTimeout(timer);
            if (code === 0 && fs.existsSync(outPath)) resolve(outPath);
            else reject(new Error(`ffmpeg exited ${code}${stderr ? `: ${stderr.split('\n').slice(-2).join(' ')}` : ''}`));
        });
    });
}

function getReplyMedia(msg) {
    const ctx = msg?.message?.extendedTextMessage?.contextInfo;
    if (!ctx || !ctx.quotedMessage) return null;
    for (const key of ['imageMessage', 'stickerMessage', 'videoMessage']) {
        const m = ctx.quotedMessage[key];
        const mimetype = m?.mimetype || (key === 'stickerMessage' ? 'image/webp' : '');
        if (mimetype && /(image|video|webp)/.test(mimetype)) {
            return { key, mimetype, msg: m };
        }
    }
    return null;
}

module.exports = {
    name: 'sticker',
    aliases: ['stk', 's'],
    category: 'utility',
    description: 'Make a sticker from a replied image or gif.',
    usage: '[effect] on a replied image — effects: grayscale, bw, invert, blur',

    async execute(sock, msg, args, extra = {}) {
        const chatId = extra.from || msg.key.remoteJid;
        const effect = (args[0] || '').toLowerCase();

        const replyMedia = getReplyMedia(msg);
        if (!replyMedia) {
            const ask = 'reply to an image or gif with `.sticker` (optionally `.sticker invert`)';
            await extra.reply?.(ask);
            return { ok: true, summary: ask };
        }

        let tmp;
        try {
            const stream = await sock.downloadMediaMessage(replyMedia.msg, 'buffer', {});
            if (!stream || !stream.length) throw new Error('download came back empty');

            const ext = replyMedia.mimetype.split('/')[1] || 'jpg';
            let tryTemp = null;
            try {
                const tp = tempManager.createTempFilePath('sticker', `.${ext}`);
                fs.writeFileSync(tp, stream);
                tryTemp = tp;
            } catch (_) {}
            tmp = tryTemp
                ? tryTemp
                : await new Promise((res, rej) => {
                      const ext = replyMedia.mimetype.split('/')[1] || 'jpg';
                      const tp = path.join(require('os').tmpdir(), `jb-stk-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
                      fs.writeFile(tp, stream, (err) => (err ? rej(err) : res(tp)));
                  });

            const animated = /gif|video/.test(replyMedia.mimetype);
            let filter = 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000';
            if (EFFECT_VF[effect]) filter = `scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000,${EFFECT_VF[effect]}`;

            const outPath = tmp + '.webp';
            await runFfmpeg(tmp, filter, animated, outPath);

            const sticker = fs.readFileSync(outPath);
            await sock.sendMessage(chatId, { sticker }, { quoted: msg });
            console.log(`[STICKER] made ${sticker.length / 1024 | 0}KB sticker for ${chatId}`);
            return { ok: true, summary: 'stickered it for the user.' };
        } catch (err) {
            console.error('[STICKER] failed:', err.message);
            const note = `couldn't make that sticker — ${err.message}`;
            await extra.reply?.(note);
            return { ok: false, reason: 'sticker_failed', message: err.message };
        } finally {
            try { if (tmp) fs.unlinkSync(tmp); } catch (_) {}
        }
    },
};