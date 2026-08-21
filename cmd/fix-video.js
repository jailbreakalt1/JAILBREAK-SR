/**
 * Video Downloader - Download video from YouTube
 */

const yts = require('yt-search');
const { sendInteractiveMessage } = require('@ryuu-reinzz/button-helper');

const config = require('../config');
const quota = require('../tools/quota');
const { cleanNumber, toPhoneJid } = require('../tools/jidCleanser');
const { buildStatusCard } = require('../tools/style');
const CHANNEL_URL = 'https://whatsapp.com/channel/0029Vb6zZKpKbYMFqRWgx62q';
const downloadQueue = require('../tools/downloadQueue');
const { getLiveState } = require('../tools/liveDetector');
const { downloadToDisk, getVideo } = require('../tools/mediaDownloader');
const { createTempFilePath, deleteTempFile, deleteTempFiles } = require('../tools/tempManager');
const buttonContext = require('../tools/buttonContext');

const buildJailbreakCaption = ({ title, senderNum, botName, emoji }) =>
  `⧯ *𝙹𝙰𝙸𝙻𝙱𝚁𝙴𝙰𝙺_𝚂𝚁* 𝙱𝚁𝙸𝙽𝙶𝚂 𝚈𝙾𝚄\n`
  + `⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯\n`
  + `◈ *𝚅𝙸𝙳𝙴𝙾 :* \`${title}\`\n`
  + `◈ *𝙳𝙾𝚆𝙽𝙻𝙾𝙰𝙳𝙴𝙳 𝙱𝚈 :* \`${botName}\`\n`
  + `⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯\n`
  + `⎆ @${senderNum} _ENJOY_ ${emoji}\n`
  + `> ☬ *𝚂𝙾𝚄𝚁𝙲𝙴 :* 𝙹𝙰𝙸𝙻𝙱𝚁𝙴𝙰𝙺 ☬`;

const VIDEO_URL_REGEX = /(?:https?:\/\/)?(?:youtu\.be\/|(?:www\.|m\.)?youtube\.com\/(?:watch\?v=|v\/|embed\/|shorts\/))([a-zA-Z0-9_-]{11})/gi;
const VIDEO_ID_REGEX = /[?&]v=([a-zA-Z0-9_-]{11})|youtu\.be\/([a-zA-Z0-9_-]{11})|shorts\/([a-zA-Z0-9_-]{11})|embed\/([a-zA-Z0-9_-]{11})/;
module.exports = {
  name: 'ytvideo',
  aliases: ['ytv', 'ytmp4', 'ytvid', 'video'],
  category: 'cmd',
  description: 'Download video from YouTube',
  usage: '.video <video name or URL>',

  async execute(sock, msg, args, extra = {}) {
    let finalPath = null;
    return downloadQueue.run(async () => {
      try {
        const instanceConfig = typeof config.getConfigFromSocket === 'function'
          ? config.getConfigFromSocket(sock)
          : config;

        if (process.memoryUsage().rss > 350 * 1024 * 1024) {
          await sock.sendMessage(msg.key.remoteJid, {
            text: buildStatusCard({
              title: 'VIDEO DOWNLOAD',
              status: '⫎ Server is busy right now.',
              lines: [`Try again in ${config.spam.duplicateCooldown}s.`],
            })
          }, { quoted: msg });
          return { ok: false, reason: 'memory_pressure', message: 'Server RAM too high — told the user to try again.' };
        }

        const sender = msg.key.participant || msg.key.remoteJid;
        const senderJid = toPhoneJid(sender);
        const senderNum = cleanNumber(senderJid);
        const q = quota.getQuota(sender);
        if (!q.allowed) {
          const limitMsg = quota.buildLimitMessage({
            jid: sender,
            pushName: extra.pushName || '',
            senderNum,
            subject: 'videos',
          });
          await sock.sendMessage(msg.key.remoteJid, { text: limitMsg.text }, { quoted: msg });
          return { ok: false, reason: 'quota_exhausted', message: `Daily request limit ${q.used}/${q.total} reached — told the user.` };
        }

        if (typeof extra.react === 'function') await extra.react('🔥');

        const searchQuery = args.join(' ').trim();
        const chatId = msg.key.remoteJid;

        if (!searchQuery) {
          return await sock.sendMessage(chatId, {
            text: buildStatusCard({
              title: 'VIDEO REQUEST',
              status: '⫎ Provide a video name or YouTube link.',
              lines: [`Example: ${config.prefix}video Alan Walker Faded`],
            })
          }, { quoted: msg });
        }

        let candidates = [];

        if (searchQuery.startsWith('http://') || searchQuery.startsWith('https://')) {
          if (!searchQuery.match(VIDEO_URL_REGEX)) {
            return await sock.sendMessage(chatId, {
              text: buildStatusCard({
                title: 'VIDEO LINK',
                status: '❌ This is not a valid YouTube link.',
                lines: ['Send a full YouTube URL or a searchable video title.'],
              })
            }, { quoted: msg });
          }
          candidates = [{ url: searchQuery, title: '' }];
        } else {
          const { videos } = await yts(searchQuery);
          if (!videos || videos.length === 0) {
            return await sock.sendMessage(chatId, {
              text: buildStatusCard({
                title: 'VIDEO SEARCH',
                status: '❌ No videos found.',
                lines: ['Try a different name or paste a direct link.'],
              })
            }, { quoted: msg });
          }

          candidates = videos.slice(0, 5).map((v) => ({ url: v.url, title: v.title || '' }));
        }

        // Try each candidate video (top 5 search results) × each download
        // API. A source only counts when its link actually downloads to
        // disk, and a video that 403s on every source falls through to the
        // next result instead of failing the whole command.
        let videoData = null;
        let pickedTitle = '';
        for (const candidate of candidates) {
          if (!candidate.url.match(VIDEO_URL_REGEX)) continue;

          const idMatch = candidate.url.match(VIDEO_ID_REGEX);
          const videoId = idMatch ? (idMatch[1] || idMatch[2] || idMatch[3] || idMatch[4]) : null;

          if (videoId) {
            const liveState = await getLiveState(videoId);
            if (liveState) {
              if (candidates.length === 1) {
                if (typeof extra.react === 'function') await extra.react('❌');
                return await sock.sendMessage(chatId, {
                  text: buildStatusCard({
                    title: 'VIDEO DOWNLOAD',
                    status: liveState === 'live'
                      ? '❌ Live streams cannot be downloaded'
                      : '❌ That stream has not started yet',
                    lines: [
                      liveState === 'live'
                        ? 'This is a live stream — there\'s no finished video file to grab.'
                        : 'This is a scheduled stream that hasn\'t aired yet.',
                      'Try a regular video or paste a different link.',
                    ],
                  })
                }, { quoted: msg });
              }
              console.warn('[VIDEO] skipped live candidate:', candidate.title);
              continue;
            }
          }

          // Try each candidate video (top 5 search results). The jailbreakdl
          // backend is the source — it downloads the file itself, so the
          // local path comes straight back. No external API is trusted here:
          // EliteProTech/Yupra/Okatsu all died (dead links, dead DNS, 402).
          // External API (siputzx) first — light on our VPS.
// Falls back to VPS backend (jailbreakdl).
const sources = [
  () => APIs.tiktokDownload(candidate.url).then(r => ({ download: r.download || r.url, title: r.title })),
  () => APIs.igDownload(candidate.url).then(r => ({ download: r.download || r.url, title: r.title })),
  () => APIs.ytDownload(candidate.url, 'video').then(r => ({ download: r.download || r.url, title: r.title })),
  () => getVideo(candidate.url),
];
          for (const method of sources) {
            try {
              const data = await method();
              if (data?.filePath) {
                finalPath = data.filePath;
                videoData = { download: data.filePath, title: data.title || candidate.title };
                pickedTitle = candidate.title;
                break;
              }
              if (!data?.download) continue;
              finalPath = createTempFilePath('video', 'mp4');
              await downloadToDisk(data.download, finalPath);
              videoData = data;
              pickedTitle = candidate.title;
              break;
            } catch (err) {
              console.warn('[VIDEO] source failed:', err?.message || err);
              if (finalPath) {
                try { deleteTempFile(finalPath); } catch (_) {}
                finalPath = null;
              }
            }
          }
          if (videoData && finalPath) break;
        }
        if (!videoData || !finalPath) throw new Error('All video sources failed.');

        const q2 = quota.useQuota(sender);
        const title = videoData.title || pickedTitle || 'Video';
        const safeName = String(title).replace(/[^\w\s-]/g, '').trim() || 'video';
        const captionText = buildJailbreakCaption({
          title,
          senderNum,
          botName: instanceConfig.botName || config.botName || 'JAILBREAK',
          emoji: '🎬',
        }) + `\n_@${senderNum}, used ${q2.used}/${q2.total} today — ${q2.total - q2.used} remaining_`;

        // 1) The media goes out as a plain video message — the same
        //    proven path songRecommend uses. No interactive fusion.
        await sock.sendMessage(chatId, {
          video: { url: finalPath },
          mimetype: 'video/mp4',
          fileName: `${safeName}.mp4`,
          caption: captionText,
          mentions: [senderJid],
        }, { quoted: msg, __skipStyle: true });

        // 2) Buttons are a separate follow-up message, sent only after
        //    the media itself was delivered. The query is remembered so a
        //    tap that arrives without a proper id can still be resolved.
        buttonContext.set(chatId, { videoQuery: title });
        try {
          await sendInteractiveMessage(sock, chatId, {
            text: `🎬 *${title}* delivered to @${senderNum}. \n > Want the audio instead?`,
            interactiveButtons: [
              {
                name: 'quick_reply',
                buttonParamsJson: JSON.stringify({
                  display_text: '🎵 GET MP3',
                  id: `finddl:${encodeURIComponent(title)}`,
                }),
              },
              {
                name: 'quick_reply',
                buttonParamsJson: JSON.stringify({
                  display_text: '📸 FETCH PHOTOS',
                  id: `imgdl:${encodeURIComponent(title)}`,
                }),
              },
              {
                name: 'cta_url',
                buttonParamsJson: JSON.stringify({
                  display_text: '▶ JOIN CHANNEL',
                  url: CHANNEL_URL,
                }),
              },
            ],
          }, { quoted: msg });
        } catch (error) {
          console.warn('[VIDEO] follow-up buttons failed:', error?.message || error);
        }

        if (typeof extra.react === 'function') await extra.react('✅');

        return { ok: true };
      } catch (error) {
        console.error('[VIDEO] Command Error:', error?.message || error);
        if (typeof extra.react === 'function') await extra.react('❌');
        await sock.sendMessage(msg.key.remoteJid, {
          text: buildStatusCard({
            title: 'VIDEO ERROR',
            status: '❌ Download failed.',
            lines: [error?.message || 'Unknown error'],
          })
        }, { quoted: msg });
        return { ok: false, reason: 'download_failed', message: error?.message || 'Unknown error' };
      } finally {
        if (finalPath) setImmediate(() => deleteTempFiles([finalPath]));
      }
    });
  }
};
