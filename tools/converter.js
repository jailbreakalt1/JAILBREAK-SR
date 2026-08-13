/**
 * JAILBREAK-XMD - A WhatsApp Bot
 * Copyright (c) 2024 Ryan
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 * 
 * Credits:
 * - Baileys Library by @adiwajshing
 * - Pair Code implementation inspired by TechGod143 & DGXEON
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawn } = require('child_process')
// Use the SAME temp directory cleanup.js sweeps, instead of a separate
// hardcoded '../temp'. Previously these could be two different folders,
// meaning cleanup.js's periodic sweep never touched ffmpeg's leftovers.
const { getTempDir } = require('./tempManager')

function ffmpeg(buffer, args = [], ext = '', ext2 = '') {
  return new Promise(async (resolve, reject) => {
    const tempDir = getTempDir()
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true })
    }

    // Random suffix avoids collisions if two conversions land in the same
    // millisecond (Date.now() alone isn't unique under concurrent callers —
    // toPTT/toVideo/toSquarePadded aren't behind downloadQueue).
    const unique = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
    const tmp = path.join(tempDir, `${unique}.${ext}`)
    const out = `${tmp}.${ext2}`

    // Unconditional cleanup — runs whether we succeed, ffmpeg errors out,
    // or ffmpeg exits non-zero. Nothing gets orphaned on disk anymore.
    const cleanup = async () => {
      await fs.promises.unlink(tmp).catch(() => {})
      await fs.promises.unlink(out).catch(() => {})
    }

    let proc
    try {
      await fs.promises.writeFile(tmp, buffer)
      proc = spawn('ffmpeg', ['-y', '-i', tmp, ...args, out])
    } catch (e) {
      await cleanup()
      return reject(e)
    }

    proc.on('error', async (err) => {
      await cleanup()
      reject(err)
    })

    proc.on('close', async (code) => {
      try {
        if (code !== 0) {
          reject(new Error(`ffmpeg exited with code ${code}`))
          return
        }
        resolve(await fs.promises.readFile(out))
      } catch (e) {
        reject(e)
      } finally {
        await cleanup()
      }
    })
  })
}

/**
 * Convert Audio to Playable WhatsApp Audio
 * @param {Buffer} buffer Audio Buffer
 * @param {String} ext File Extension 
 */
function toAudio(buffer, ext) {
  return ffmpeg(buffer, [
    '-vn',
    '-ac', '2',
    '-b:a', '128k',
    '-ar', '44100',
    '-f', 'mp3'
  ], ext, 'mp3')
}

/**
 * Convert audio file to MP3 in-place using direct ffmpeg file I/O.
 * Never loads the full audio into a JS Buffer — peak RAM stays at
 * streaming chunk size regardless of file length.
 *
 * @param {string} inputPath  Path to source audio file
 * @param {string} outputPath Path for converted MP3 output
 * @returns {Promise<void>}
 */
function toAudioFile(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-y',
      '-i', inputPath,
      '-vn',
      '-ac', '2',
      '-b:a', '128k',
      '-ar', '44100',
      '-f', 'mp3',
      outputPath
    ], {
      stdio: ['ignore', 'ignore', 'pipe']
    });

    let stderr = '';
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    proc.on('error', reject);

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-200)}`));
      }
      resolve();
    });
  });
}

/**
 * Convert Audio to Playable WhatsApp PTT
 * @param {Buffer} buffer Audio Buffer
 * @param {String} ext File Extension 
 */
function toPTT(buffer, ext) {
  return ffmpeg(buffer, [
    '-vn',
    '-c:a', 'libopus',
    '-b:a', '128k',
    '-vbr', 'on',
    '-compression_level', '10'
  ], ext, 'opus')
}

/**
 * Convert Audio to Playable WhatsApp Video
 * @param {Buffer} buffer Video Buffer
 * @param {String} ext File Extension 
 */
function toVideo(buffer, ext) {
  return ffmpeg(buffer, [
    '-c:v', 'libx264',
    '-c:a', 'aac',
    '-ab', '128k',
    '-ar', '44100',
    '-crf', '32',
    '-preset', 'slow'
  ], ext, 'mp4')
}

/**
 * Pad a non-square image into a square canvas WITHOUT cropping any of the
 * original picture. WhatsApp (and Baileys' own updateProfilePicture resize
 * step) center-crops profile pictures to a square, which can cut off the
 * edges of a rectangular photo. Pre-padding the image to 1:1 here means
 * there's nothing left for that crop to cut - the "mandatory crop" just
 * crops empty padding/blur instead of your subject.
 *
 * @param {Buffer} buffer Image buffer
 * @param {String} ext Input file extension (e.g. 'jpg', 'png', 'webp')
 * @param {Object} [opts]
 * @param {Number} [opts.size=720] Output square canvas size in px
 * @param {String} [opts.style='blur'] 'blur' = blurred-background fill (like Instagram's "fit" mode), 'color' = solid background
 * @param {String} [opts.color='black'] Background color when style === 'color'
 */
function toSquarePadded(buffer, ext, opts = {}) {
  const size = opts.size || 720
  const style = opts.style === 'color' ? 'color' : 'blur'

  if (style === 'color') {
    const color = opts.color || 'black'
    const vf = `scale=${size}:${size}:force_original_aspect_ratio=decrease,pad=${size}:${size}:(ow-iw)/2:(oh-ih)/2:color=${color}`
    return ffmpeg(buffer, ['-vf', vf, '-frames:v', '1', '-f', 'mjpeg'], ext, 'jpg')
  }

  const filterComplex =
    `split=2[bg][fg];` +
    `[bg]scale=${size}:${size}:force_original_aspect_ratio=increase,crop=${size}:${size},gblur=sigma=20[bg2];` +
    `[fg]scale=${size}:${size}:force_original_aspect_ratio=decrease[fg2];` +
    `[bg2][fg2]overlay=(W-w)/2:(H-h)/2`
  return ffmpeg(buffer, ['-filter_complex', filterComplex, '-frames:v', '1', '-f', 'mjpeg'], ext, 'jpg')
}

module.exports = {
  toAudio,
  toAudioFile,
  toPTT,
  toVideo,
  toSquarePadded,
  ffmpeg,
}
