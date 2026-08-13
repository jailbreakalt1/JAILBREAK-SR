/**
 * Video Downloader - Download video from YouTube
 */

const yts = require('yt-search');
const APIs = require('../tools/api');

const config = require('../config');
const quota = require('../tools/quota');
const { cleanNumber, toPhoneJid } = require('../tools/jidCleanser');
const { buildStatusCard } = require('../tools/style');
const { sendInteractiveMessage } = require('@ryuu-reinzz/button-helper');
const CHANNEL_URL = 'https://whatsapp.com/channel/0029Vb6zZKpKbYMFqRWgx62q';
const downloadQueue = require('../tools/downloadQueue');

const buildJailbreakCaption = ({ title, senderNum, botName, emoji }) =>
  `⧯ *𝙹𝙰𝙸𝙻𝙱𝚁𝙴𝙰𝙺_𝚂𝚁* 𝙱𝚁𝙸𝙽𝙶𝚂 𝚈𝙾𝚄\n`
  + `⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯\n`
  + `◈ *𝚅𝙸𝙳𝙴𝙾 :* \`${title}\`\n`
  + `◈ *𝙳𝙾𝚆𝙽𝙻𝙾𝙰𝙳𝙴𝙳 𝙱𝚈 :* \`${botName}\`\n`
  + `⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯\n`
  + `⎆ @${senderNum} _ENJOY_ ${emoji}\n`
  + `▸ *CHANNEL:* ${CHANNEL_URL}\n`
  + `> ☬ *𝚂𝙾𝚄𝚁𝙲𝙴 :* 𝙹𝙰𝙸𝙻𝙱𝚁𝙴𝙰𝙺 ☬`;
module.exports = {
  name: 'ytvideo',
  aliases: ['ytv', 'ytmp4', 'ytvid', 'video'],
  category: 'cmd',
  description: 'Download video from YouTube',
  usage: '.video <video name or URL>',

  async execute(sock, msg, args, extra = {}) {
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
              lines: [`Example: ${config.prefix}video CHAMUNORWA`],
            })
          }, { quoted: msg });
        }

        let videoUrl = '';
        let videoTitle = '';

        if (searchQuery.startsWith('http://') || searchQuery.startsWith('https://')) {
          videoUrl = searchQuery;
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

          videoUrl = videos[0].url;
          videoTitle = videos[0].title;
        }

        const urls = videoUrl.match(/(?:https?:\/\/)?(?:youtu\.be\/|(?:www\.|m\.)?youtube\.com\/(?:watch\?v=|v\/|embed\/|shorts\/|playlist\?list=)?)([a-zA-Z0-9_-]{11})/gi);
        if (!urls) {
          return await sock.sendMessage(chatId, {
            text: buildStatusCard({
              title: 'VIDEO LINK',
              status: '❌ This is not a valid YouTube link.',
              lines: ['Send a full YouTube URL or a searchable video title.'],
            })
          }, { quoted: msg });
        }

        let videoData;
        try {
          videoData = await APIs.getEliteProTechVideoByUrl(videoUrl);
        } catch (e1) {
          try {
            videoData = await APIs.getYupraVideoByUrl(videoUrl);
          } catch (e2) {
            videoData = await APIs.getOkatsuVideoByUrl(videoUrl);
          }
        }

        const q2 = quota.useQuota(sender);
        const title = videoData.title || videoTitle || 'Video';
        const safeName = title.replace(/[^\w\s-]/g, '').trim() || 'video';

        await sock.sendMessage(chatId, {
          video: { url: videoData.download },
          mimetype: 'video/mp4',
          fileName: `${safeName}.mp4`,
          caption: buildJailbreakCaption({
            title,
            senderNum,
            botName: instanceConfig.botName || config.botName || 'JAILBREAK',
            emoji: '🎬',
          }) + `\n_@${senderNum}, you've used ${q2.used}/${q2.total} today — ${q2.total - q2.used} remaining_`,
          mentions: [senderJid]
        }, { quoted: msg });

        try {
          await sendInteractiveMessage(sock, chatId, {
            text: `🎬 *${title}* delivered to @${senderNum}. Want the audio instead?`,
            interactiveButtons: [
              {
                name: 'quick_reply',
                buttonParamsJson: JSON.stringify({
                  display_text: '🎵 GET MP3',
                  id: `finddl:${encodeURIComponent(title)}`,
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
      }
    });
  }
};
