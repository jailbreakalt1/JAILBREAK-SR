/**
 * Video Downloader - Download video from YouTube
 */

const yts = require('yt-search');
const APIs = require('../tools/api');

const config = require('../config');
const quota = require('../tools/quota');
const MAX_MEM_RSS = 350 * 1024 * 1024;
module.exports = {
  name: 'ytvideo',
  aliases: ['ytv', 'ytmp4', 'ytvid', 'video'],
  category: 'cmd',
  description: 'Download video from YouTube',
  usage: '.video <video name or URL>',

  async execute(sock, msg, args, extra = {}) {
    try {
      // Get instance-specific config
      const instanceConfig = typeof config.getConfigFromSocket === 'function'
        ? config.getConfigFromSocket(sock)
        : config;

      if (process.memoryUsage().rss > MAX_MEM_RSS) {
        await sock.sendMessage(msg.key.remoteJid, {
          text: `⧯ Server is busy right now, try again in ${config.spam.duplicateCooldown}s.`
        }, { quoted: msg });
        return { ok: false, reason: 'memory_pressure', message: 'Server RAM too high — told the user to try again.' };
      }

      const sender = msg.key.participant || msg.key.remoteJid;
      const senderNum = (sender || '').split('@')[0];
      const q = quota.getQuota(sender);
      if (!q.allowed) {
        await sock.sendMessage(msg.key.remoteJid, {
          text: `Dear @${extra.pushName || senderNum}, you requested ${q.used} songs today. I can no longer be of service. Limit resets in ${quota.timeUntilReset()}.`
        }, { quoted: msg });
        return { ok: false, reason: 'quota_exhausted', message: `Daily request limit ${q.used}/${q.total} reached — told the user.` };
      }

      const text = args.join(' ');
      const chatId = msg.key.remoteJid;

      const searchQuery = text.trim();

      if (!searchQuery) {
        await sock.sendMessage(chatId, {
          text: 'What video do you want to download?'
        }, { quoted: msg });
        return { ok: false, reason: 'no_query', message: 'No video name/link was given — asked the user to provide one.' };
      }

      // Determine if input is a YouTube link
      let videoUrl = '';
      let videoTitle = '';
      let videoThumbnail = '';

      if (searchQuery.startsWith('http://') || searchQuery.startsWith('https://')) {
        videoUrl = searchQuery;
      } else {
        // Search YouTube for the video
        const { videos } = await yts(searchQuery);
        if (!videos || videos.length === 0) {
          await sock.sendMessage(chatId, {
            text: 'No videos found!'
          }, { quoted: msg });
          return { ok: false, reason: 'not_found', message: 'No YouTube results for that search — told the user.' };
        }
        videoUrl = videos[0].url;
        videoTitle = videos[0].title;
        videoThumbnail = videos[0].thumbnail;
      }

      // Send thumbnail immediately
      try {
        const ytId = (videoUrl.match(/(?:youtu\.be\/|v=)([a-zA-Z0-9_-]{11})/) || [])[1];
        const thumb = videoThumbnail || (ytId ? `https://i.ytimg.com/vi/${ytId}/sddefault.jpg` : undefined);
        const captionTitle = videoTitle || searchQuery;
        if (thumb) {
          await sock.sendMessage(chatId, {
            image: { url: thumb },
            caption: `*${captionTitle}*\nDownloading...`
          }, { quoted: msg });
        }
      } catch (e) {
        console.error('[VIDEO] thumb error:', e?.message || e);
      }

      // Validate YouTube URL
      let urls = videoUrl.match(/(?:https?:\/\/)?(?:youtu\.be\/|(?:www\.|m\.)?youtube\.com\/(?:watch\?v=|v\/|embed\/|shorts\/|playlist\?list=)?)([a-zA-Z0-9_-]{11})/gi);
      if (!urls) {
        await sock.sendMessage(chatId, {
          text: 'This is not a valid YouTube link!'
        }, { quoted: msg });
        return { ok: false, reason: 'invalid_link', message: 'The link/query did not resolve to a valid YouTube URL — told the user.' };
      }

      // Get video: local jailbreakdl backend first (cookies + POT + yt-dlp on
      // the same box) → EliteProTech/Yupra/Okatsu paid APIs → local yt-dlp.
      let videoData = null;
      let localBuffer = null;
      try {
        localBuffer = await APIs.getBackendMediaByUrl(videoUrl, 'video');
      } catch (e) {
        console.log('[VIDEO] local backend failed:', e?.message || e);
      }

      if (!localBuffer) {
        try {
          try {
            videoData = await APIs.getEliteProTechVideoByUrl(videoUrl);
          } catch (e1) {
            try {
              videoData = await APIs.getYupraVideoByUrl(videoUrl);
            } catch (e2) {
              videoData = await APIs.getOkatsuVideoByUrl(videoUrl);
            }
          }
        } catch (e) {
          videoData = null;
        }

        if (!videoData?.download) {
          console.log('[VIDEO] API sources failed — falling through to local yt-dlp...');
          localBuffer = await APIs.getLocalVideoByUrl(videoUrl);
        }
      }

      const finalTitle = videoData?.title || videoTitle || 'Video';
      const fileName = `${finalTitle.replace(/[^\w\s-]/g, '')}.mp4`;
      const preQ = quota.getQuota(sender);
      const q2 = { used: preQ.used + 1, total: preQ.total, remaining: preQ.remaining - 1 };
      await sock.sendMessage(chatId, localBuffer
        ? { video: localBuffer.buffer, mimetype: 'video/mp4', fileName,
            caption: `*${finalTitle}*\n\n> *_Downloaded by ${instanceConfig.botName}_*\n_@${senderNum}, you've used ${q2.used}/${q2.total} today — ${q2.total - q2.used} remaining_` }
        : { video: { url: videoData.download }, mimetype: 'video/mp4', fileName,
            caption: `*${finalTitle}*\n\n> *_Downloaded by ${instanceConfig.botName}_*\n_@${senderNum}, you've used ${q2.used}/${q2.total} today — ${q2.total - q2.used} remaining_` }, { quoted: msg });
      quota.useQuota(sender);

      return { ok: true };
    } catch (error) {
      console.error('[VIDEO] Command Error:', error?.message || error);
      await sock.sendMessage(msg.key.remoteJid, {
        text: 'Download failed: ' + (error?.message || 'Unknown error')
      }, { quoted: msg });
      return { ok: false, reason: 'download_failed', message: error?.message || 'Unknown error' };
    }
  }
};
