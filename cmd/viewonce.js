/**
 * Reveal view-once media and forward it to the configured owner.
 */

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const config = require('../config');
const downloadQueue = require('../tools/downloadQueue');
const { toPhoneJid, cleanNumber } = require('../tools/jidCleanser');

function resolveFirstOwnerJid() {
  const owners = Array.isArray(config.ownerNumber)
    ? config.ownerNumber
    : String(config.ownerNumber || '').split(',');

  const number = owners.map(cleanNumber).find(Boolean);
  return number ? toPhoneJid(number) : null;
}

function getMessageType(message) {
  if (!message) return null;
  if (message.imageMessage) return 'imageMessage';
  if (message.videoMessage) return 'videoMessage';
  if (message.audioMessage) return 'audioMessage';
  return null;
}

function unwrapViewOnceMessage(message) {
  if (!message) return null;

  const directType = getMessageType(message);
  if (directType) return { message, type: directType };

  const nested = message.viewOnceMessageV2?.message
    || message.viewOnceMessageV2Extension?.message
    || message.viewOnceMessage?.message
    || message.ephemeralMessage?.message;

  if (!nested) return null;
  const nestedType = getMessageType(nested);
  return nestedType ? { message: nested, type: nestedType } : null;
}

function getQuotedContext(message) {
  return message?.message?.extendedTextMessage?.contextInfo
    || message?.message?.imageMessage?.contextInfo
    || message?.message?.videoMessage?.contextInfo
    || message?.message?.audioMessage?.contextInfo
    || message?.message?.buttonsResponseMessage?.contextInfo
    || message?.message?.listResponseMessage?.contextInfo;
}

function buildDownloadableMessage(chatId, contextInfo, innerMessage) {
  return {
    key: {
      remoteJid: chatId,
      id: contextInfo?.stanzaId,
      participant: contextInfo?.participant
    },
    message: innerMessage
  };
}

function buildRevealCaption(msg, mediaType, caption) {
  const sender = cleanNumber(msg?.key?.participant || msg?.key?.remoteJid) || 'unknown';
  const origin = msg?.key?.remoteJid || 'unknown';
  const lines = [
    '╔════════════════════╗',
    '   ╼ VIEW ONCE REVEAL ╾',
    '╚════════════════════╝',
    '⎛',
    '  ⧯ 𝙸𝙽𝚃𝙴𝚁𝙲𝙴𝙿𝚃𝙴𝙳',
    `  ◈ From: @${sender}`,
    `  ◈ Origin Chat: ${origin}`,
    `  ◈ Type: \`${mediaType}\``,
    '⎝',
    '> ☬ *JAILBREAK SIGHT* ☬'
  ];

  if (caption) lines.push('', `📝 ${caption}`);
  return { text: lines.join('\n'), senderJid: toPhoneJid(sender) };
}

async function safeDeleteTrigger(sock, chatId, key) {
  try {
    await sock.sendMessage(chatId, { delete: key });
  } catch (_) {
    // Deletion is best effort and must not hide the recovered media.
  }
}

module.exports = {
  name: 'viewonce',
  aliases: ['readvo', 'read', 'vv', 'readviewonce'],
  category: 'general',
  description: 'Reveal view-once images, videos, and audio',
  usage: '.viewonce (reply to view-once media)',

  async execute(sock, msg) {
    const chatId = msg?.key?.remoteJid;
    if (!chatId) return;

    await downloadQueue.run(async () => {
      try {
        const ownerJid = resolveFirstOwnerJid();
        const contextInfo = getQuotedContext(msg);
        const viewOnceInfo = unwrapViewOnceMessage(contextInfo?.quotedMessage);

        if (!ownerJid || !contextInfo?.stanzaId || !viewOnceInfo) {
          await safeDeleteTrigger(sock, chatId, msg.key);
          return;
        }

        const downloadableMessage = buildDownloadableMessage(
          chatId,
          contextInfo,
          viewOnceInfo.message
        );
        const mediaBuffer = await downloadMediaMessage(
          downloadableMessage,
          'buffer',
          {},
          { logger: undefined, reuploadRequest: sock.updateMediaMessage?.bind(sock) }
        );

        if (!mediaBuffer?.length) {
          await safeDeleteTrigger(sock, chatId, msg.key);
          return;
        }

        const { message: actualMessage, type: mediaType } = viewOnceInfo;
        const caption = actualMessage[mediaType]?.caption || '';
        const reveal = buildRevealCaption(msg, mediaType, caption);
        const messageOptions = {
          caption: reveal.text,
          mentions: reveal.senderJid ? [reveal.senderJid] : [],
          contextInfo: {
            forwardingScore: 1,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
              newsletterJid: config.newsletterJid || '120363161513685998@newsletter',
              newsletterName: config.botName || 'JAILBREAK-SR',
              serverMessageId: -1
            }
          }
        };

        if (mediaType === 'videoMessage') {
          await sock.sendMessage(ownerJid, { video: mediaBuffer, mimetype: 'video/mp4', ...messageOptions });
        } else if (mediaType === 'imageMessage') {
          await sock.sendMessage(ownerJid, { image: mediaBuffer, mimetype: 'image/jpeg', ...messageOptions });
        } else {
          await sock.sendMessage(ownerJid, { text: reveal.text, mentions: messageOptions.mentions, contextInfo: messageOptions.contextInfo });
          await sock.sendMessage(ownerJid, { audio: mediaBuffer, mimetype: 'audio/mpeg', contextInfo: messageOptions.contextInfo });
        }

        await safeDeleteTrigger(sock, chatId, msg.key);
      } catch (error) {
        console.error('Error in viewonce command:', error);
        await safeDeleteTrigger(sock, chatId, msg.key);
      }
    });
  }
};
