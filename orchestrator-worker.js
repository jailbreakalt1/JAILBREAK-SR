'use strict';

const fsp = require('fs/promises');
const yts = require('yt-search');
const path = require('path');
const { OrchestratorWorker } = require('../../jailbreak_orchestrator/src/worker.js');
const { createTempFilePath, deleteTempFiles } = require('./tools/tempManager');
const { toAudioFile } = require('./tools/converter');
const { downloadToDisk } = require('./tools/mediaDownloader');
const APIs = require('./tools/api');

const config = require('../config');

const detectExt = async (filePath) => {
  const fd = await fsp.open(filePath, 'r');
  try {
    const header = Buffer.alloc(12);
    await fd.read(header, 0, 12, 0);
    const ascii4 = header.slice(4, 8).toString('ascii');
    if (header.toString('ascii', 0, 4) === 'OggS') return 'ogg';
    if (header.toString('ascii', 0, 4) === 'RIFF') return 'wav';
    if (ascii4 === 'ftyp' || header.toString('hex').startsWith('000000')) return 'm4a';
    return 'mp3';
  } finally {
    await fd.close();
  }
};

const sanitize = (value, fallback = 'song') => String(value || fallback).replace(/[\\/:*?"<>|]+/g, '').trim() || fallback;

const getLiveState = async (videoId) => {
  try {
    const { getLiveState } = require('./tools/liveDetector');
    return await getLiveState(videoId);
  } catch (_) {
    return null;
  }
};

const resolveSongCandidates = async (query) => {
  const search = await yts(query);
  return (search?.videos?.slice(0, 5) || []).map((video) => ({
    url: video.url,
    videoId: video.videoId,
    info: {
      title: video.title || 'Unknown Title',
      timestamp: video.timestamp || 'Unknown',
      thumbnail: video.thumbnail || 'https://files.catbox.moe/s80m7e.png'
    },
    author: String(video.author?.name || 'Unknown Artist'),
    ago: video.ago || 'Recently'
  }));
};

const resolveAudioDownload = async (query, youtubeUrls) => {
  // 1) EliteProTech
  for (const youtubeUrl of youtubeUrls) {
    try {
      const payload = await APIs.getEliteProTechDownloadByUrl(youtubeUrl, 'mp3');
      const mediaUrl = payload?.download;
      if (mediaUrl) {
        return { payload: { title: payload.title || 'Song' }, mediaUrl };
      }
    } catch (err) {
      console.warn('[worker:song] EliteProTech failed:', err.message);
    }
  }

  // 2) OriHost jailbreakdl — final fallback
  const { getSong } = require('./tools/mediaDownloader');
  for (const youtubeUrl of youtubeUrls) {
    try {
      const media = await getSong(youtubeUrl);
      if (media?.filePath) {
        return { payload: { title: media.title || 'Song' }, localPath: media.filePath };
      }
    } catch (err) {
      console.warn('[worker:song] jailbreakdl failed:', err.message);
    }
  }

  throw new Error('All audio sources failed.');
};

const scheduleCleanup = (...filePaths) => {
  const unique = [...new Set(filePaths.filter(Boolean))];
  if (!unique.length) return;
  setImmediate(() => deleteTempFiles(unique));
};

async function handleDownloadSong(job) {
  const { query, videoId, youtubeUrls, songInfo, author, ago, from, sender, senderNum, pushName, isDM } = job.payload;

  console.log(`[worker] Processing song job ${job.id}: "${query}" for ${senderNum}`);

  // Check live state
  const liveState = await getLiveState(videoId);
  if (liveState) {
    throw new Error(liveState === 'live'
      ? 'Live streams cannot be downloaded'
      : 'That stream has not started yet');
  }

  // Download audio
  const { payload, mediaUrl, localPath } = await resolveAudioDownload(query, youtubeUrls);

  let rawPath = null;
  let finalPath = null;

  if (localPath) {
    rawPath = localPath;
  } else {
    rawPath = createTempFilePath('song', 'raw');
    await downloadToDisk(mediaUrl, rawPath);
  }

  const ext = await detectExt(rawPath);
  let mimetype = 'audio/mpeg';

  if (ext === 'mp3') {
    finalPath = rawPath;
  } else {
    finalPath = createTempFilePath('song', 'mp3');
    await toAudioFile(rawPath, finalPath);
    const stat = await fsp.stat(finalPath);
    if (!stat.size) throw new Error('Converted audio is empty.');
  }

  const title = payload.title || songInfo.title;
  const fileName = `${sanitize(author, 'Unknown Artist')} - ${sanitize(title)}.mp3`;

  // Return result with file path
  const result = {
    filePath: finalPath,
    title,
    ext,
    mimetype,
    fileName,
    captionData: {
      info: songInfo,
      author,
      ago,
      senderNum,
      emoji: '🎧',
    },
    videoQuery: `${author} - ${title}`,
  };

  scheduleCleanup(rawPath);

  return result;
}

async function handleDownloadVideo(job) {
  const { query, videoId, youtubeUrls, title: candidateTitle, from, sender, senderNum, pushName, isDM } = job.payload;

  console.log(`[worker] Processing video job ${job.id}: "${query}" for ${senderNum}`);

  const { getLiveState } = require('./tools/liveDetector');
  const { downloadToDisk, getVideo } = require('./tools/mediaDownloader');
  const { createTempFilePath, deleteTempFile, deleteTempFiles } = require('./tools/tempManager');
  const APIs = require('./tools/api');

  const VIDEO_URL_REGEX = /(?:https?:\/\/)?(?:youtu\.be\/|(?:www\.|m\.)?youtube\.com\/(?:watch\?v=|v\/|embed\/|shorts\/))([a-zA-Z0-9_-]{11})/gi;
  const VIDEO_ID_REGEX = /[?&]v=([a-zA-Z0-9_-]{11})|youtu\.be\/([a-zA-Z0-9_-]{11})|shorts\/([a-zA-Z0-9_-]{11})|embed\/([a-zA-Z0-9_-]{11})/;

  // Check live state
  if (videoId) {
    const liveState = await getLiveState(videoId);
    if (liveState) {
      throw new Error(liveState === 'live'
        ? 'Live streams cannot be downloaded'
        : 'That stream has not started yet');
    }
  }

  let finalPath = null;
  let videoData = null;
  let pickedTitle = candidateTitle;

  for (const candidateUrl of youtubeUrls) {
    if (!candidateUrl.match(VIDEO_URL_REGEX)) continue;

    const sources = [
      () => APIs.getEliteProTechDownloadByUrl(candidateUrl, 'mp4'),
      () => getVideo(candidateUrl),
    ];

    for (const method of sources) {
      try {
        const data = await method();
        if (data?.filePath) {
          finalPath = data.filePath;
          videoData = { download: data.filePath, title: data.title };
          pickedTitle = data.title || pickedTitle;
          break;
        }
        if (!data?.download) continue;
        finalPath = createTempFilePath('video', 'mp4');
        await downloadToDisk(data.download, finalPath);
        videoData = data;
        pickedTitle = data.title || pickedTitle;
        break;
      } catch (err) {
        console.warn('[worker:video] source failed:', err?.message || err);
        if (finalPath) {
          try { deleteTempFile(finalPath); } catch (_) {}
          finalPath = null;
        }
      }
    }
    if (videoData && finalPath) break;
  }

  if (!videoData || !finalPath) throw new Error('All video sources failed.');

  const title = videoData.title || pickedTitle || 'Video';
  const safeName = String(title).replace(/[^\w\s-]/g, '').trim() || 'video';

  return {
    filePath: finalPath,
    title,
    safeName,
    mimetype: 'video/mp4',
    captionData: {
      title,
      senderNum,
      botName: 'JAILBREAK-SR',
      emoji: '🎬',
    },
    videoQuery: title,
  };
}

async function handleDownloadImage(job) {
  const { query, from, sender, senderNum, pushName, isDM } = job.payload;

  console.log(`[worker] Processing image job ${job.id}: "${query}" for ${senderNum}`);

  const { imageSearch } = require('./tools/mediaDownloader');
  const { artistClean } = require('./tools/songRecommend')._internals;

  const MAX_IMG_RESULTS = 5;

  // Try to resolve artist from query
  let resolved = null;
  try {
    const yts = require('yt-search');
    const { videos } = await yts(query);
    const v = videos && videos[0];
    if (v) {
      const raw = String(v.author?.name || '');
      resolved = {
        artist: raw,
        searchArtist: artistClean(raw) || raw,
        title: String(v.title || ''),
        videoId: v.videoId || '',
      };
    }
  } catch (_) {}

  const searchQuery = resolved?.searchArtist ? `${resolved.searchArtist} artist` : query;

  let images = [];
  try {
    images = await imageSearch(searchQuery, MAX_IMG_RESULTS);
  } catch (err) {
    console.warn('[worker:img] artist search failed:', err?.message || err);
  }

  if (!images.length && searchQuery !== query) {
    try {
      images = await imageSearch(query, MAX_IMG_RESULTS);
    } catch (err) {
      console.warn('[worker:img] fallback search failed:', err?.message || err);
    }
  }

  if (!images.length) throw new Error('No images found.');

  const results = images.slice(0, MAX_IMG_RESULTS);
  const captionTitle = resolved?.title || query;

  return {
    images: results,
    captionTitle,
    resolvedArtist: resolved?.artist,
    captionData: {
      title: captionTitle,
      senderNum,
      botName: 'JAILBREAK-SR',
      emoji: '📸',
    },
  };
}

async function main() {
  const orchestratorUrl = config.orchestrator?.url || 'http://localhost:30202';
  const token = config.orchestrator?.token || '';
  const workerId = config.orchestrator?.workerId || `worker-${require('crypto').randomUUID().slice(0, 8)}`;
  const capacity = config.orchestrator?.workerCapacity || 1;

  if (!token) {
    console.error('ORCHESTRATOR_TOKEN not set in config');
    process.exit(1);
  }

  const worker = new OrchestratorWorker({
    baseUrl: orchestratorUrl,
    token,
    workerId,
    capacity,
    pollIntervalMs: 5000,
    jobHandler: async (job) => {
      console.log(`[worker] Received job ${job.id}: ${job.command}`);

      let result;
      switch (job.command) {
        case 'download-song':
          result = await handleDownloadSong(job);
          break;
        case 'download-video':
          result = await handleDownloadVideo(job);
          break;
        case 'download-image':
          result = await handleDownloadImage(job);
          break;
        default:
          throw new Error(`Unknown command: ${job.command}`);
      }

      // Store result in job for bot to retrieve
      // Note: This requires the orchestrator to support result storage
      // For now, we'll need to extend the orchestrator or use a different approach
      console.log(`[worker] Job ${job.id} completed, result:`, Object.keys(result));
      return result;
    },
  });

  await worker.start();
  console.log(`[worker] ${workerId} started, waiting for jobs...`);

  process.on('SIGTERM', async () => {
    console.log('[worker] Shutting down...');
    await worker.stop();
    process.exit(0);
  });
  process.on('SIGINT', async () => {
    console.log('[worker] Shutting down...');
    await worker.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[worker] Fatal error:', err);
  process.exit(1);
});