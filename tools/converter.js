const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const FFMPEG_TIMEOUT = 60000 // kill a hung ffmpeg instead of hanging forever

function ffmpeg(buffer, args = [], ext = '', ext2 = '') {
  return new Promise(async (resolve, reject) => {
    try {
      const tempDir = path.join(__dirname, '../temp')
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })
      const tmp = path.join(tempDir, Date.now() + '.' + ext)
      const out = tmp + '.' + ext2
      await fs.promises.writeFile(tmp, buffer)
      const child = spawn('ffmpeg', ['-y', '-i', tmp, ...args, out])
      const killTimer = setTimeout(() => child.kill('SIGKILL'), FFMPEG_TIMEOUT)
      child
        .on('error', (err) => {
          clearTimeout(killTimer)
          cleanup(tmp, out)
          reject(err)
        })
        .on('close', async (code) => {
          clearTimeout(killTimer)
          cleanup(tmp)
          if (code !== 0) { cleanup(out); return reject(code) }
          try {
            const result = await fs.promises.readFile(out)
            cleanup(out)
            resolve(result)
          } catch (e) {
            cleanup(out)
            reject(e)
          }
        })
    } catch (e) {
      reject(e)
    }
  })
}

function ffmpegFile(inputPath, args = [], ext2 = '') {
  return new Promise((resolve, reject) => {
    const tempDir = path.join(__dirname, '../temp')
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })
    const out = path.join(tempDir, Date.now() + '.' + ext2)
    const child = spawn('ffmpeg', ['-y', '-i', inputPath, ...args, out])
    const killTimer = setTimeout(() => child.kill('SIGKILL'), FFMPEG_TIMEOUT)
    child
      .on('error', (err) => {
        clearTimeout(killTimer)
        cleanup(out)
        reject(err)
      })
      .on('close', async (code) => {
        clearTimeout(killTimer)
        if (code !== 0) { cleanup(out); return reject(code) }
        try {
          const result = await fs.promises.readFile(out)
          cleanup(out)
          resolve(result)
        } catch (e) {
          cleanup(out)
          reject(e)
        }
      })
  })
}

function cleanup(...paths) {
  for (const p of paths) {
    try {
      if (p && fs.existsSync(p)) {
        fs.writeFileSync(p, Buffer.alloc(0));
        fs.unlinkSync(p);
      }
    } catch (_) {}
  }
}

function toAudio(buffer, ext) {
  return ffmpeg(buffer, [
    '-vn', '-ac', '2', '-b:a', '128k', '-ar', '44100', '-f', 'mp3'
  ], ext, 'mp3')
}

function toAudioFromFile(inputPath, ext) {
  return ffmpegFile(inputPath, [
    '-vn', '-ac', '2', '-b:a', '128k', '-ar', '44100', '-f', 'mp3'
  ], 'mp3')
}

function toPTT(buffer, ext) {
  return ffmpeg(buffer, [
    '-vn', '-c:a', 'libopus', '-b:a', '128k', '-vbr', 'on', '-compression_level', '10'
  ], ext, 'opus')
}

function toVideo(buffer, ext) {
  return ffmpeg(buffer, [
    '-c:v', 'libx264', '-c:a', 'aac', '-ab', '128k', '-ar', '44100',
    '-crf', '32', '-preset', 'slow'
  ], ext, 'mp4')
}

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

module.exports = { toAudio, toAudioFromFile, toPTT, toVideo, toSquarePadded, ffmpeg, ffmpegFile }
