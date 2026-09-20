/**
 * API Integration Utilities
 */

const axios = require('axios');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const api = axios.create({
  timeout: 30000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  }
});

const CACHE_DIR = path.join(__dirname, '..', 'temp', 'songcache');
// Bot-side fallback binary — on Termux/ARM point YTDLP_BINARY at the native
// yt-dlp (pkg install yt-dlp) so the fallback path works on the phone.
const YT_DLP_BIN = process.env.YTDLP_BINARY || path.join(__dirname, '..', 'bin', 'yt-dlp');

// ── Local downloader backend (jailbreakdl) ─────────────────────────────────
// Runs on the same box as the bot (default 127.0.0.1:30102) — cookies + POT +
// yt-dlp handled server-side, so songs/videos no longer depend on hosted APIs.
const config = require('../config');
const BACKEND_BASE_URL = config.localBackend.baseUrl;

/**
 * Download media through the local jailbreakdl backend: POST /api/media/(audio|video).
 * Returns { buffer, mimetype, ext }. Throws when the backend is unreachable/busy.
 */
async function getBackendMediaByUrl(youtubeUrl, kind) {
  const url = `${BACKEND_BASE_URL}/api/media/${kind === 'video' ? 'video' : 'audio'}`;
  const response = await axios.post(url, { url: youtubeUrl }, { responseType: 'arraybuffer', timeout: 180000 });
  const ct = String(response.headers['content-type'] || '');
  let buffer = response.data;
  let ext, mimetype;
  if (kind === 'video') {
    ext = 'mp4'; mimetype = ct || 'video/mp4';
  } else {
    const ascii0 = buffer.slice(4, 8).toString('ascii');
    if (buffer.toString('ascii', 0, 4) === 'OggS') { ext = 'ogg'; mimetype = 'audio/ogg'; }
    else if (buffer.toString('hex', 0, 4).startsWith('1a45dfa3')) { ext = 'webm'; mimetype = 'audio/webm'; }
    else if (ascii0 === 'ftyp' || (buffer.length >= 12 && buffer.toString('hex').slice(0, 12) === '000000')) { ext = 'm4a'; mimetype = 'audio/mp4'; }
    else { ext = 'mp3'; mimetype = 'audio/mpeg'; }
  }
  console.log(`[API] local backend downloaded ${(buffer.length / 1024 / 1024).toFixed(1)}MB ${kind} (${ext})`);
  return { buffer, mimetype, ext };
}

// ── Social platforms via the vendored Python backend (JAILBREAK-MEDIA-BACKEND) ─
// Facebook/Instagram/TikTok/Pinterest go through 127.0.0.1:8000
// (tools/ensureMediaBackend.js auto-boots it). If the Python service is down,
// we degrade to the Node backend's POST /api/download (yt-dlp only). No hosted
// shims here anymore.
const SOCIAL_PATTERNS = [
  { platform: 'facebook',   re: /https?:\/\/(?:[a-z0-9-]+\.)?(?:facebook\.com|fb\.com|fb\.watch)\/[^\s<>"']+/i },
  { platform: 'instagram',  re: /https?:\/\/(?:[a-z0-9-]+\.)?(?:instagram\.com|instagr\.am)\/[^\s<>"']+/i },
  { platform: 'tiktok',    re: /https?:\/\/(?:[a-z0-9-]+\.)?tiktok\.com\/[^\s<>"']+/i },
  { platform: 'pinterest',  re: /https?:\/\/(?:[a-z0-9-]+\.)?(?:pin\.it|pinterest\.[a-z.]+)\/[^\s<>"']+/i },
];

const SOCIAL_PATH_EXCLUDES = ['/accounts/', '/login', '/signup', '/direct/', '/explore/', '/search', '/settings', '/sharer', '/share.php', '/plugins', '/events', '/watchparty'];

function detectSocialUrl(text) {
  if (!text) return null;
  for (const { platform, re } of SOCIAL_PATTERNS) {
    const m = text.match(re);
    if (m) {
      const url = m[0];
      const pathPart = url.replace(/^https?:\/\/[^/]+/, '');
      if (SOCIAL_PATH_EXCLUDES.some((p) => pathPart.startsWith(p))) continue;
      return { platform, url };
    }
  }
  return null;
}

async function getBackendSocialManifest(url) {
  const detected = detectSocialUrl(url);
  const platform = detected ? detected.platform : null;
  if (!platform) return null;

  // Primary: vendored Python backend (rich chains: siputzx/imginn/ryzendesu…)
  try {
    const headers = config.mediaBackend.token
      ? { Authorization: `Bearer ${config.mediaBackend.token}` }
      : {};
    const res = await axios.get(
      `${config.mediaBackend.baseUrl}/api/download/${platform}`,
      {
        params: { url },
        headers,
        timeout: 60000,
        validateStatus: (s) => s < 500,
      }
    );
    const data = res.data;
    if (data && data.ok === true && Array.isArray(data.data)) {
      const items = data.data
        .filter((it) => it && typeof it.url === 'string' && it.url)
        .map((it) => ({
          type: /video/i.test(String(it.type)) ? 'video' : 'image',
          url: it.url,
          thumbnail: it.thumbnail,
        }));
      if (items.length) {
        console.log(`[API] python media backend manifest: ${platform} → ${items.length} item(s)`);
        return { items, source: 'python' };
      }
    }
  } catch (err) {
    console.warn(`[API] python media backend unavailable (${err.code || err.message}) – trying node backend`);
  }

  // Degraded: node backend streams a single file (yt-dlp, no third-party).
  try {
    const res = await axios.post(
      `${BACKEND_BASE_URL}/api/download`,
      { url },
      { responseType: 'arraybuffer', timeout: 180000, validateStatus: (s) => s < 500 }
    );
    const ct = String(res.headers['content-type'] || '');
    if (res.status === 200 && Buffer.byteLength(res.data) > 0) {
      const type = ct.includes('video') ? 'video' : ct.includes('image') ? 'image' : null;
      if (type) {
        console.log(`[API] node backend degraded download: ${platform} → ${type}`);
        return {
          items: [{ type, buffer: Buffer.from(res.data), mimetype: ct }],
          source: 'node',
        };
      }
    }
  } catch (err) {
    console.warn(`[API] node backend fallback failed: ${err.code || err.message}`);
  }
  return null;
}

async function fetchSocialItem(url) {
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
  return { buffer: Buffer.from(res.data), mimetype: String(res.headers['content-type'] || '') };
}

async function searchBackendImages(query, count = 4) {
  const res = await axios.get(`${BACKEND_BASE_URL}/api/img/search`, {
    params: { q: query, count },
    timeout: 30000,
    validateStatus: (s) => s < 500,
  });
  if (res.status !== 200) throw new Error('image search failed');
  const images = res.data?.images;
  return Array.isArray(images) ? images.slice(0, count) : [];
}

// API Endpoints
const APIs = {
  // Image Generation
  generateImage: async (prompt) => {
    try {
      const response = await api.get(`https://api.siputzx.my.id/api/ai/stablediffusion`, {
        params: { prompt }
      });
      return response.data;
    } catch (error) {
      throw new Error('Failed to generate image');
    }
  },
  
  // YouTube Download
  ytDownload: async (url, type = 'audio') => {
    try {
      const response = await api.get(`https://api.siputzx.my.id/api/d/ytmp3`, {
        params: { url }
      });
      return response.data;
    } catch (error) {
      throw new Error('Failed to download YouTube video');
    }
  },
  
  // Instagram Download
  igDownload: async (url) => {
    try {
      const response = await api.get(`https://api.siputzx.my.id/api/d/igdl`, {
        params: { url }
      });
      return response.data;
    } catch (error) {
      throw new Error('Failed to download Instagram content');
    }
  },
  
  // TikTok Download
  tiktokDownload: async (url) => {
    try {
      const response = await api.get(`https://api.siputzx.my.id/api/d/tiktok`, {
        params: { url }
      });
      return response.data;
    } catch (error) {
      throw new Error('Failed to download TikTok video');
    }
  },
  
  // Translate
  translate: async (text, to = 'en') => {
    try {
      const response = await api.get(`https://api.siputzx.my.id/api/tools/translate`, {
        params: { text, to }
      });
      return response.data;
    } catch (error) {
      throw new Error('Translation failed');
    }
  },
  
  // Random Meme
  getMeme: async () => {
    try {
      const response = await api.get('https://meme-api.com/gimme');
      return response.data;
    } catch (error) {
      throw new Error('Failed to fetch meme');
    }
  },
  
  // Random Quote
  getQuote: async () => {
    try {
      const response = await api.get('https://api.quotable.io/random');
      return response.data;
    } catch (error) {
      throw new Error('Failed to fetch quote');
    }
  },
  
  // Random Joke
  getJoke: async () => {
    try {
      const response = await api.get('https://official-joke-api.appspot.com/random_joke');
      return response.data;
    } catch (error) {
      throw new Error('Failed to fetch joke');
    }
  },
  
  // Weather
  getWeather: async (city) => {
    try {
      const response = await api.get(`https://api.siputzx.my.id/api/tools/weather`, {
        params: { city }
      });
      return response.data;
    } catch (error) {
      throw new Error('Failed to fetch weather');
    }
  },
  
  // Shorten URL
  shortenUrl: async (url) => {
    try {
      const response = await api.get(`https://tinyurl.com/api-create.php`, {
        params: { url }
      });
      return response.data;
    } catch (error) {
      throw new Error('Failed to shorten URL');
    }
  },
  
  // Wikipedia Search
  wikiSearch: async (query) => {
    try {
      const response = await api.get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`);
      return response.data;
    } catch (error) {
      throw new Error('Wikipedia search failed');
    }
  },
  
  // ── Audio Download: EliteProTech API (primary) ──────────────────────────
  // Single attempt with generous timeout — audio processing on the remote end
  // can take 30-60 seconds.
  getEliteProTechDownloadByUrl: async (youtubeUrl) => {
    const apiUrl = `https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(youtubeUrl)}&format=mp3`;
    const res = await axios.get(apiUrl, {
      timeout: 90000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
      }
    });
    if (res?.data?.success && res?.data?.downloadURL) {
      return { download: res.data.downloadURL, title: res.data.title };
    }
    throw new Error('EliteProTech ytdown returned no download');
  },

  // ── Audio Download: local yt-dlp (fallback) ─────────────────────────────
  // Spawns yt-dlp directly to download + convert audio. Requires ffmpeg on
  // the system. Used when the API path fails or is unavailable.
  getLocalAudioByUrl: async (youtubeUrl) => {
    const tmpDir = path.join(__dirname, '..', 'temp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const outBase = path.join(tmpDir, `ytdl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    const outFile = `${outBase}.mp3`;

    await new Promise((resolve, reject) => {
      const proc = spawn(YT_DLP_BIN, [
        '-x', '--audio-format', 'mp3',
        '--audio-quality', '128k',
        '-o', outFile,
        '--no-playlist',
        '--no-warnings',
        '--progress', '--no-progress',
        youtubeUrl,
      ], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });

      let stderr = '';
      proc.stderr.on('data', d => { stderr += d.toString(); });
      proc.on('close', code => {
        if (code === 0 && fs.existsSync(outFile)) return resolve(outFile);
        reject(new Error(`yt-dlp exited ${code}: ${stderr.slice(-300)}`));
      });
      proc.on('error', err => reject(err));
    });

    const buffer = fs.readFileSync(outFile);
    fs.unlinkSync(outFile);
    console.log(`[API] yt-dlp downloaded ${(buffer.length / 1024 / 1024).toFixed(1)}MB audio`);
    return { buffer, mimetype: 'audio/mpeg', ext: 'mp3' };
  },

  // ── Video Download: local yt-dlp (fallback) ─────────────────────────────
  // Spawns yt-dlp to grab best ≤480p video + audio, muxes to mp4 via ffmpeg.
  // Free path for when paid video APIs 402. 480p keeps WhatsApp-friendly size.
  getLocalVideoByUrl: async (youtubeUrl) => {
    const tmpDir = path.join(__dirname, '..', 'temp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const outBase = path.join(tmpDir, `ytdlv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    const outFile = `${outBase}.mp4`;

    await new Promise((resolve, reject) => {
      const proc = spawn(YT_DLP_BIN, [
        '-f', 'bv*[height<=480]+ba[ext=m4a]/b[height<=480]/b',
        '--merge-output-format', 'mp4',
        '--max-filesize', '60M',
        '-o', outFile,
        '--no-playlist',
        '--no-warnings',
        '--progress', '--no-progress',
        youtubeUrl,
      ], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000 });

      let stderr = '';
      proc.stderr.on('data', d => { stderr += d.toString(); });
      proc.on('close', code => {
        if (code === 0 && fs.existsSync(outFile)) return resolve(outFile);
        reject(new Error(`yt-dlp exited ${code}: ${stderr.slice(-300)}`));
      });
      proc.on('error', err => reject(err));
    });

    const buffer = fs.readFileSync(outFile);
    fs.unlinkSync(outFile);
    console.log(`[API] yt-dlp downloaded ${(buffer.length/1024/1024).toFixed(1)}MB video`);
    return { buffer, mimetype: 'video/mp4', ext: 'mp4' };
  },
  
    getEliteProTechVideoByUrl: async (youtubeUrl) => {
    const AXIOS_DEFAULTS = {
      timeout: 60000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
      }
    };
    
    const tryRequest = async (getter, attempts = 3) => {
      let lastError;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          return await getter();
        } catch (err) {
          lastError = err;
          if (attempt < attempts) {
            await new Promise(r => setTimeout(r, 1000 * attempt));
          }
        }
      }
      throw lastError;
    };
    
    const apiUrl = `https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(youtubeUrl)}&format=mp4`;
    const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS));
    if (res?.data?.success && res?.data?.downloadURL) {
      return {
        download: res.data.downloadURL,
        title: res.data.title
      };
    }
    throw new Error('EliteProTech ytdown video returned no download');
  },
  
  // Video Download APIs
  getYupraVideoByUrl: async (youtubeUrl) => {
    const AXIOS_DEFAULTS = {
      timeout: 60000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
      }
    };
    
    const tryRequest = async (getter, attempts = 3) => {
      let lastError;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          return await getter();
        } catch (err) {
          lastError = err;
          if (attempt < attempts) {
            await new Promise(r => setTimeout(r, 1000 * attempt));
          }
        }
      }
      throw lastError;
    };
    
    const apiUrl = `https://api.yupra.my.id/api/downloader/ytmp4?url=${encodeURIComponent(youtubeUrl)}`;
    const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS));
    if (res?.data?.success && res?.data?.data?.download_url) {
      return {
        download: res.data.data.download_url,
        title: res.data.data.title,
        thumbnail: res.data.data.thumbnail
      };
    }
    throw new Error('Yupra returned no download');
  },
  
  getOkatsuVideoByUrl: async (youtubeUrl) => {
    const AXIOS_DEFAULTS = {
      timeout: 60000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
      }
    };
    
    const tryRequest = async (getter, attempts = 3) => {
      let lastError;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          return await getter();
        } catch (err) {
          lastError = err;
          if (attempt < attempts) {
            await new Promise(r => setTimeout(r, 1000 * attempt));
          }
        }
      }
      throw lastError;
    };
    
    const apiUrl = `https://okatsu-rolezapiiz.vercel.app/downloader/ytmp4?url=${encodeURIComponent(youtubeUrl)}`;
    const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS));
    if (res?.data?.result?.mp4) {
      return { download: res.data.result.mp4, title: res.data.result.title };
    }
    throw new Error('Okatsu ytmp4 returned no mp4');
  },
  
  // TikTok Download API
  getTikTokDownload: async (url) => {
    const apiUrl = `https://api.siputzx.my.id/api/d/tiktok?url=${encodeURIComponent(url)}`;
    try {
      const response = await axios.get(apiUrl, { 
        timeout: 15000,
        headers: {
          'accept': '*/*',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      if (response.data && response.data.status && response.data.data) {
        let videoUrl = null;
        let title = null;
        
        if (response.data.data.urls && Array.isArray(response.data.data.urls) && response.data.data.urls.length > 0) {
          videoUrl = response.data.data.urls[0];
          title = response.data.data.metadata?.title || 'TikTok Video';
        } else if (response.data.data.video_url) {
          videoUrl = response.data.data.video_url;
          title = response.data.data.metadata?.title || 'TikTok Video';
        } else if (response.data.data.url) {
          videoUrl = response.data.data.url;
          title = response.data.data.metadata?.title || 'TikTok Video';
        } else if (response.data.data.download_url) {
          videoUrl = response.data.data.download_url;
          title = response.data.data.metadata?.title || 'TikTok Video';
        }
        
        return { videoUrl, title };
      }
      throw new Error('Invalid API response');
    } catch (error) {
      throw new Error('TikTok download failed');
    }
  },
  
  // Screenshot Website API
  screenshotWebsite: async (url) => {
    try {
      const apiUrl = `https://eliteprotech-apis.zone.id/ssweb?url=${encodeURIComponent(url)}`;
      const response = await axios.get(apiUrl, {
        timeout: 30000,
        responseType: 'arraybuffer',
        headers: {
          'accept': '*/*',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      // Return the image buffer directly (API returns PNG binary)
      if (response.headers['content-type']?.includes('image')) {
        return Buffer.from(response.data);
      }
      
      // If API returns JSON with URL, try to parse it
      try {
        const data = JSON.parse(Buffer.from(response.data).toString());
        return data.url || data.data?.url || data.image || apiUrl;
      } catch (e) {
        // If not JSON, assume it's image data and return buffer
        return Buffer.from(response.data);
      }
    } catch (error) {
      throw new Error('Failed to take screenshot');
    }
  },
  
  // Text to Speech API
  textToSpeech: async (text) => {
    try {
      const apiUrl = `https://www.laurine.site/api/tts/tts-nova?text=${encodeURIComponent(text)}`;
      const response = await axios.get(apiUrl, {
        timeout: 30000,
        headers: {
          'accept': '*/*',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      if (response.data) {
        // Check if response.data is a string (direct URL)
        if (typeof response.data === 'string' && (response.data.startsWith('http://') || response.data.startsWith('https://'))) {
          return response.data;
        }
        
        // Check nested data structure
        if (response.data.data) {
          const data = response.data.data;
          if (data.URL) return data.URL;
          if (data.url) return data.url;
          if (data.MP3) return `https://ttsmp3.com/created_mp3_ai/${data.MP3}`;
          if (data.mp3) return `https://ttsmp3.com/created_mp3_ai/${data.mp3}`;
        }
        
        // Check top-level URL fields
        if (response.data.URL) return response.data.URL;
        if (response.data.url) return response.data.url;
        if (response.data.MP3) return `https://ttsmp3.com/created_mp3_ai/${response.data.MP3}`;
        if (response.data.mp3) return `https://ttsmp3.com/created_mp3_ai/${response.data.mp3}`;
      }
      
      throw new Error('Invalid API response structure');
    } catch (error) {
      throw new Error(`Failed to generate speech: ${error.message}`);
    }
  },
};

module.exports = APIs;
module.exports.getBackendMediaByUrl = getBackendMediaByUrl;
module.exports.detectSocialUrl = detectSocialUrl;
module.exports.getBackendSocialManifest = getBackendSocialManifest;
module.exports.fetchSocialItem = fetchSocialItem;
module.exports.searchBackendImages = searchBackendImages;
