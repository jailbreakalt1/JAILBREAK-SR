const ACRCloud = require('acrcloud');
const yts = require('yt-search');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { sendInteractiveMessage } = require('@ryuu-reinzz/button-helper');
const songCommand = require('./fix-song');
const quota = require('../tools/quota');
const { buildCard, buildStatusCard } = require('../tools/style');
const downloadQueue = require('../tools/downloadQueue');

const SONG_REQUEST_CHANNEL_LINK = 'https://whatsapp.com/channel/0029Vb6zZKpKbYMFqRWgx62q';
const FALLBACK_THUMBNAIL = 'https://files.catbox.moe/s80m7e.png';
const MAX_BUFFER_SIZE = 8 * 1024 * 1024; // 8MB

const acr = new ACRCloud({
  host: process.env.ACRCLOUD_HOST || 'identify-us-west-2.acrcloud.com',
  access_key: process.env.ACRCLOUD_ACCESS_KEY || '4ee38e62e85515a47158aeb3d26fb741',
  access_secret: process.env.ACRCLOUD_ACCESS_SECRET || 'KZd3cUQoOYSmZQn1n5ACW5XSbqGlKLhg6G8S8EvJ'
});

const buildTargetMessage = (msg, from) => {
  const current = msg.message || {};
  if (current.videoMessage || current.audioMessage) return msg;

  const ctx = current.extendedTextMessage?.contextInfo;
  if (!ctx?.quotedMessage) return null;

  const quoted = ctx.quotedMessage;
  if (!quoted.videoMessage && !quoted.audioMessage) return null;

  return {
    key: {
      remoteJid: from,
      id: ctx.stanzaId,
      participant: ctx.participant
    },
    message: quoted
  };
};

const identifySong = async (buffer) => {
  const clip = buffer.length > MAX_BUFFER_SIZE ? buffer.slice(0, MAX_BUFFER_SIZE) : buffer;
  const result = await acr.identify(clip);

  if (result?.status?.code !== 0 || !result?.metadata?.music?.length) {
    return null;
  }

  return result.metadata.music[0];
};

module.exports = {
  name: 'find',
  aliases: ['shazam', 'id', 'whats', 'what is', 'name'],
  category: 'cmd',
  description: 'Identify a song from replied audio/video',
  usage: '.find (reply to audio/video)',

  async execute(sock, msg, _args, extra = {}) {
    const from = extra.from || msg.key.remoteJid;
    const targetMessage = buildTargetMessage(msg, from);

    if (!targetMessage) {
      await sock.sendMessage(from, {
        text: buildStatusCard({
          title: 'SONG ID',
          status: '⫎ Reply to an audio/video first.',
          lines: ['Use `.find`, `.shazam`, or `.id`.'],
        })
      }, { quoted: msg });
      return;
    }

    const sender = msg.key.participant || from;
    const senderNum = (sender || '').split('@')[0];
    const q = quota.getQuota(sender);
    if (!q.allowed) {
      const limitMsg = quota.buildLimitMessage({
        jid: sender,
        pushName: extra.pushName || '',
        senderNum,
        subject: 'songs',
      });
      await sock.sendMessage(from, { text: limitMsg.text }, { quoted: msg });
      return;
    }

    try {
      if (typeof extra.react === 'function') await extra.react('🔎');

      const mediaBuffer = await downloadQueue.run(() => downloadMediaMessage(
        targetMessage,
        'buffer',
        {},
        { logger: undefined, reuploadRequest: sock.updateMediaMessage }
      ));

      if (!mediaBuffer?.length) {
        throw new Error('Unable to download media.');
      }

      const song = await identifySong(mediaBuffer);
      if (!song) {
        await sock.sendMessage(from, {
          text: buildStatusCard({
            title: 'SONG ID',
            status: '❌ Failed to identify.',
            lines: ['Try a clearer part of the audio.'],
          })
        }, { quoted: msg });
        if (typeof extra.react === 'function') await extra.react('❌');
        return;
      }

      const title = song.title || 'Unknown';
      const artists = song.artists?.map((a) => a.name).join(', ') || 'Unknown';
      const album = song.album?.name || 'Single';
      const genres = song.genres?.map((g) => g.name).join(', ') || 'General';
      const query = `${title} ${artists}`.trim();

      const sent = await songCommand.sendSong(sock, msg, query, {
        ...extra,
        skipQuota: true,
        quietFailure: true,
      });
      if (sent) {
        quota.useQuota(sender);
        if (typeof extra.react === 'function') await extra.react('✅');
        return;
      }

      let thumbnail = FALLBACK_THUMBNAIL;
      try {
        const yt = await yts(query);
        thumbnail = yt?.videos?.[0]?.thumbnail || thumbnail;
      } catch (_) {}

      const responseText =
      buildCard({
        title: 'SONG IDENTIFIED',
        lines: [
          `◈ *SONG :* \`${title}\``,
          `◈ *ARTIST :* \`${artists}\``,
          `◈ *ALBUM :* \`${album}\``,
          `◈ *GENRE :* \`${genres}\``,
        ],
      });

      try {
        await sendInteractiveMessage(sock, from, {
          text: responseText,
          contextInfo: {
            externalAdReply: {
              title: `${artists} - ${title}`,
              body: 'JAILBREAK_SR BRINGS YOU',
              thumbnailUrl: thumbnail,
              mediaType: 1,
              renderLargerThumbnail: true,
            },
          },
          interactiveButtons: [
            {
              name: 'quick_reply',
              buttonParamsJson: JSON.stringify({
                display_text: '⬇ DOWNLOAD SONG',
                id: `finddl:${encodeURIComponent(query)}`,
              }),
            },
            {
              name: 'quick_reply',
              buttonParamsJson: JSON.stringify({
                display_text: '🎬 FETCH VIDEO',
                id: `viddl:${encodeURIComponent(query)}`,
              }),
            },
            {
              name: 'cta_url',
              buttonParamsJson: JSON.stringify({
                display_text: '▶ JOIN CHANNEL',
                url: SONG_REQUEST_CHANNEL_LINK,
              }),
            },
          ],
        }, { quoted: msg });
      } catch (error) {
        console.warn('[FIND] interactive send failed, falling back to plain text:', error?.message || error);
        await sock.sendMessage(from, {
          text: `${responseText}\nDownload: \`.song ${query}\``
        }, { quoted: msg });
      }

      quota.useQuota(sender);

      if (typeof extra.react === 'function') await extra.react('✅');
    } catch (error) {
      console.error('[FIND] command error:', error?.message || error);
      await sock.sendMessage(from, {
        text: buildStatusCard({
          title: 'SONG ID',
          status: '⚠️ System error during identification.',
          lines: [error?.message || 'Unknown error'],
        })
      }, { quoted: msg });
      if (typeof extra.react === 'function') await extra.react('❌');
    }
  }
};
