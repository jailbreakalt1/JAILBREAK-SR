const ACRCloud = require('acrcloud');
const yts = require('yt-search');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');

const SONG_REQUEST_CHANNEL_LINK = 'https://whatsapp.com/channel/0029VagJIAr3bbVzV70jSU1p';
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
  category: 'media',
  description: 'Identify a song from replied audio/video',
  usage: '.find (reply to audio/video)',

  async execute(sock, msg, _args, extra = {}) {
    const from = extra.from || msg.key.remoteJid;
    const targetMessage = buildTargetMessage(msg, from);

    if (!targetMessage) {
      await sock.sendMessage(from, {
        text: '🎵 Reply to an audio/video with .find, .shazam, or .id.'
      }, { quoted: msg });
      return;
    }

    try {
      if (typeof extra.react === 'function') await extra.react('🔎');

      const mediaBuffer = await downloadMediaMessage(
        targetMessage,
        'buffer',
        {},
        { logger: undefined, reuploadRequest: sock.updateMediaMessage }
      );

      if (!mediaBuffer?.length) {
        throw new Error('Unable to download media.');
      }

      const song = await identifySong(mediaBuffer);
      if (!song) {
        await sock.sendMessage(from, {
          text: '⫎ Failed to identify. Try a clearer part of the audio.'
        }, { quoted: msg });
        if (typeof extra.react === 'function') await extra.react('❌');
        return;
      }

      const title = song.title || 'Unknown';
      const artists = song.artists?.map((a) => a.name).join(', ') || 'Unknown';
      const album = song.album?.name || 'Single';
      const genres = song.genres?.map((g) => g.name).join(', ') || 'General';
      const query = `${title} ${artists}`.trim();

      let ytLink = 'Not available';
      let thumbnail = FALLBACK_THUMBNAIL;
      try {
        const yt = await yts(query);
        ytLink = yt?.videos?.[0]?.url || ytLink;
        thumbnail = yt?.videos?.[0]?.thumbnail || thumbnail;
      } catch (_) {}

      const responseText =
`╼ 𝚂𝙾𝙽𝙶 𝙸𝙳𝙴𝙽𝚃𝙸𝙵𝙸𝙴𝙳 ╾
⎛
  ◈ 𝚂𝙾𝙽𝙶 : \`${title}\`
  ◈ 𝙰𝚁𝚃𝙸𝚂𝚃 : \`${artists}\`
  ◈ 𝙰𝙻𝙱𝚄𝙼 : \`${album}\`
  ◈ 𝙶𝙴𝙽𝚁𝙴 : \`${genres}\`
⎝

⧯ *YouTube Link:* ${ytLink}

 ☬ *JAILBREAK HUB* ☬`;

      await sock.sendMessage(from, {
        text: `${responseText}\n\n*Copy:* \`${artists} - ${title}\``
      }, { quoted: msg });

      if (typeof extra.react === 'function') await extra.react('✅');
    } catch (error) {
      console.error('[FIND] command error:', error?.message || error);
      await sock.sendMessage(from, {
        text: '⚠️ System error during identification.'
      }, { quoted: msg });
      if (typeof extra.react === 'function') await extra.react('❌');
    }
  }
};
