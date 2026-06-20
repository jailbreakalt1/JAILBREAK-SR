/**
 * SetPP Command - Set profile/group picture without WhatsApp's mandatory crop cutting off content.
 *
 * WhatsApp (and Baileys' internal resize step) center-crops whatever you
 * upload into a square. If your photo isn't already square, that crop can
 * chop off heads, edges, etc. This command pads the image to a square
 * canvas first (blurred-background fill by default, or a solid color),
 * so the forced crop has nothing meaningful left to cut.
 */

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { toSquarePadded } = require('./converter');

const buildTargetMessage = (msg, from) => {
  const current = msg.message || {};
  if (current.imageMessage) return msg;

  const ctx = current.extendedTextMessage?.contextInfo;
  if (!ctx?.quotedMessage?.imageMessage) return null;

  return {
    key: {
      remoteJid: from,
      id: ctx.stanzaId,
      participant: ctx.participant
    },
    message: ctx.quotedMessage
  };
};

const extFromMimetype = (mimetype = '') => {
  if (mimetype.includes('png')) return 'png';
  if (mimetype.includes('webp')) return 'webp';
  return 'jpg';
};

const bareJid = (jid = '') => {
  const [user] = jid.split(':');
  return user.includes('@') ? user : `${user}@s.whatsapp.net`;
};

module.exports = {
  name: 'setpp',
  aliases: ['setpfp', 'pp', 'padpp'],
  category: 'owner',
  description: 'Set profile/group picture padded to square (avoids WhatsApp\'s forced crop cutting off content)',
  usage: '.setpp [color|blur] (send/reply to an image)',
  ownerOnly: true,
  botAdminNeeded: true,

  async execute(sock, msg, args, extra = {}) {
    const from = extra.from || msg.key.remoteJid;
    const isGroup = from.endsWith('@g.us');

    const targetMessage = buildTargetMessage(msg, from);
    if (!targetMessage) {
      return extra.reply('🖼️ Send or reply to an image with .setpp');
    }

    const style = (args[0] || '').toLowerCase() === 'color' ? 'color' : 'blur';
    const color = args[1] || 'black';

    try {
      if (typeof extra.react === 'function') await extra.react('🖼️');

      const imageMessage = targetMessage.message.imageMessage;
      const mediaBuffer = await downloadMediaMessage(
        targetMessage,
        'buffer',
        {},
        { logger: undefined, reuploadRequest: sock.updateMediaMessage }
      );

      if (!mediaBuffer?.length) {
        throw new Error('Unable to download image.');
      }

      const ext = extFromMimetype(imageMessage?.mimetype);
      const padded = await toSquarePadded(mediaBuffer, ext, { style, color, size: 720 });

      const targetJid = isGroup ? from : bareJid(sock.user.id);
      await sock.updateProfilePicture(targetJid, { url: padded });

      await extra.reply(`✅ ${isGroup ? 'Group' : 'Profile'} picture updated (padded to square, style: ${style}).`);
      if (typeof extra.react === 'function') await extra.react('✅');
    } catch (error) {
      await extra.reply(`❌ Failed to set picture: ${error.message}`);
      if (typeof extra.react === 'function') await extra.react('❌');
    }
  }
};
