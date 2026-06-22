/**
 * ViewOnce Command - Reveal view-once messages
 */

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const config = require('../config');

const resolveFirstOwnerJid = () => {
  const ownerNumbers = Array.isArray(config.ownerNumber)
    ? config.ownerNumber
    : String(config.ownerNumber || '').split(',');

  const first = ownerNumbers
    .map((value) => String(value || '').trim().replace(/\D/g, ''))
    .filter(Boolean)[0];

  return first ? `${first}@s.whatsapp.net` : null;
};

const buildOwnerHeader = (msg, mediaType) => {
  const origin = msg?.key?.remoteJid || 'unknown';
  const sender = (msg?.key?.participant || msg?.key?.remoteJid || 'unknown').split('@')[0];

  return `╔════════════════════╗\n   ╼ VIEW ONCE REVEAL ╾\n╚════════════════════╝\n⎛\n  ⧯ 𝙸𝙽𝚃𝙴𝚁𝙲𝙴𝙿𝚃𝙴𝙳\n  ◈ From: @${sender}\n  ◈ Origin Chat: ${origin}\n  ◈ Type: \`${mediaType}\`\n⎝\n> ☬ *JAILBREAK SIGHT* ☬`;
};

const buildDownloadableMessage = (chatId, contextInfo, innerMessage) => ({
  key: {
    remoteJid: chatId,
    id: contextInfo?.stanzaId,
    participant: contextInfo?.participant
  },
  message: innerMessage
});

const getMessageType = (message) => {
  if (!message) return null;
  if (message.imageMessage) return 'imageMessage';
  if (message.videoMessage) return 'videoMessage';
  if (message.audioMessage) return 'audioMessage';
  return null;
};

const unwrapViewOnceMessage = (message) => {
  if (!message) return null;

  const directType = getMessageType(message);
  if (directType) return { message, type: directType };

  const nested = message.viewOnceMessageV2?.message
    || message.viewOnceMessageV2Extension?.message
    || message.viewOnceMessage?.message;

  if (nested) {
    const nestedType = getMessageType(nested);
    if (nestedType) return { message: nested, type: nestedType };
  }

  return null;
};

const safeDeleteTrigger = async (sock, chatId, msgKey) => {
  try {
    await sock.sendMessage(chatId, { delete: msgKey });
  } catch (_) {
    // Best effort only
  }
};

module.exports = {
  name: 'viewonce',
  aliases: ['readvo', 'read', 'vv', 'readviewonce'],
  category: 'general',
  description: 'Reveal view-once messages (images/videos/audio)',
  usage: '.viewonce (reply to view-once message)',

  async execute(sock, msg) {
    const chatId = msg.key.remoteJid;

    try {
      const ownerJid = resolveFirstOwnerJid();
      if (!ownerJid) {
        await safeDeleteTrigger(sock, chatId, msg.key);
        return;
      }

      const ctx = msg.message?.extendedTextMessage?.contextInfo
        || msg.message?.imageMessage?.contextInfo
        || msg.message?.videoMessage?.contextInfo
        || msg.message?.buttonsResponseMessage?.contextInfo
        || msg.message?.listResponseMessage?.contextInfo;

      if (!ctx?.quotedMessage || !ctx?.stanzaId) {
        await safeDeleteTrigger(sock, chatId, msg.key);
        return;
      }

      const quotedMsg = ctx.quotedMessage;
      const viewOnceInfo = unwrapViewOnceMessage(quotedMsg);

      if (!viewOnceInfo) {
        await safeDeleteTrigger(sock, chatId, msg.key);
        return;
      }

      const { message: actualMsg, type: mtype } = viewOnceInfo;
      const downloadableMsg = buildDownloadableMessage(chatId, ctx, actualMsg);
      const mediaBuffer = await downloadMediaMessage(
        downloadableMsg,
        'buffer',
        {},
        { logger: undefined, reuploadRequest: sock.updateMediaMessage?.bind(sock) }
      );

      if (!mediaBuffer?.length) {
        await safeDeleteTrigger(sock, chatId, msg.key);
        return;
      }

      const caption = actualMsg[mtype]?.caption || '';
      const revealHeader = buildOwnerHeader(msg, mtype);
      const contextInfo = {
        forwardingScore: 1,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
          newsletterJid: config.newsletterJid || '120363161513685998@newsletter',
          newsletterName: config.botName || 'JAILBREAK-XMD',
          serverMessageId: -1
        }
      };

      if (/video/.test(mtype)) {
        await sock.sendMessage(ownerJid, {
          video: mediaBuffer,
          caption: `${revealHeader}${caption ? `\n\n📝 ${caption}` : ''}`,
          mimetype: 'video/mp4',
          contextInfo
        });
      } else if (/image/.test(mtype)) {
        await sock.sendMessage(ownerJid, {
          image: mediaBuffer,
          caption: `${revealHeader}${caption ? `\n\n📝 ${caption}` : ''}`,
          mimetype: 'image/jpeg',
          contextInfo
        });
      } else if (/audio/.test(mtype)) {
        await sock.sendMessage(ownerJid, { text: revealHeader, contextInfo });
        await sock.sendMessage(ownerJid, {
          audio: mediaBuffer,
          mimetype: 'audio/mpeg',
          contextInfo
        });
      }

      // Leave no trail in origin chat.
      await safeDeleteTrigger(sock, chatId, msg.key);
    } catch (error) {
      console.error('Error in viewonce command:', error);
      await safeDeleteTrigger(sock, chatId, msg.key);
    }
  }
};
