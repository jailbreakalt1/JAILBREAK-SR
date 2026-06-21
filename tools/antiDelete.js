const fs = require('fs');
const path = require('path');

const { downloadMediaMessage } = require('@whiskeysockets/baileys');

const config = require('../config');

const STORAGE_LIMIT_HOURS = 6;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const TEMP_DIR = path.join(__dirname, '..', 'temp', 'anti-delete');

const ownerNumbers = Array.isArray(config.ownerNumber)
  ? config.ownerNumber
  : String(config.ownerNumber || '').split(',');

const OWNER_NUMBER = ownerNumbers
  .map((n) => String(n || '').trim().replace(/\D/g, ''))
  .filter(Boolean)[0];

const OWNER_JID = OWNER_NUMBER ? `${OWNER_NUMBER}@s.whatsapp.net` : null;

const storeByChatAndId = new Map();
const storeById = new Map();

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

const makeStoreKey = (remoteJid = '', msgId = '') => `${remoteJid}:${msgId}`;

const isInboxJid = (jid = '') =>
  jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid') || jid.endsWith('@hosted');

const getMessageContent = (msg) => {
  if (!msg?.message) return null;
  let m = msg.message;

  if (m.ephemeralMessage?.message) m = m.ephemeralMessage.message;
  if (m.viewOnceMessageV2Extension?.message) m = m.viewOnceMessageV2Extension.message;
  if (m.viewOnceMessageV2?.message) m = m.viewOnceMessageV2.message;
  if (m.viewOnceMessage?.message) m = m.viewOnceMessage.message;
  if (m.documentWithCaptionMessage?.message) m = m.documentWithCaptionMessage.message;

  return m;
};

const getTextContent = (content = {}) => {
  if (content.conversation) return content.conversation;
  if (content.extendedTextMessage?.text) return content.extendedTextMessage.text;
  if (content.imageMessage?.caption) return content.imageMessage.caption;
  if (content.videoMessage?.caption) return content.videoMessage.caption;
  return '';
};

const saveMediaToTemp = (msgId, mtype, buffer) => {
  const extMap = {
    imageMessage: 'jpg',
    videoMessage: 'mp4',
    audioMessage: 'ogg',
    stickerMessage: 'webp',
    documentMessage: 'bin'
  };

  const ext = extMap[mtype] || 'bin';
  const filePath = path.join(TEMP_DIR, `${Date.now()}-${msgId}.${ext}`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
};

const persistEntry = (chatJid, msgId, entry) => {
  const byChatKey = makeStoreKey(chatJid, msgId);
  storeByChatAndId.set(byChatKey, entry);
  storeById.set(msgId, entry);
};

setInterval(() => {
  const now = Date.now();

  for (const [key, value] of storeByChatAndId.entries()) {
    if (now - value.timestamp > STORAGE_LIMIT_HOURS * 60 * 60 * 1000) {
      if (value.mediaPath && fs.existsSync(value.mediaPath)) {
        fs.unlinkSync(value.mediaPath);
      }

      storeByChatAndId.delete(key);

      const idMatches = Array.from(storeById.entries())
        .filter(([, idEntry]) => idEntry === value)
        .map(([id]) => id);

      idMatches.forEach((id) => storeById.delete(id));
    }
  }
}, CLEANUP_INTERVAL_MS);

async function extractMediaBuffer(msg, messageType, options = {}) {
  const downloader = options.downloadMediaMessage;

  if (typeof downloader === 'function') {
    try {
      const media = await downloader(
        msg,
        'buffer',
        {},
        { logger: undefined, reuploadRequest: msg?.key ? undefined : undefined }
      );
      if (media && media.length) return media;
    } catch (_) {
      // Fall back to Baileys direct downloader below.
    }
  }

  try {
    const media = await downloadMediaMessage(
      msg,
      'buffer',
      {},
      {
        logger: undefined,
        reuploadRequest: undefined
      }
    );
    if (media && media.length) return media;
  } catch (_) {}

  return null;
}

async function storeInboxMessage(sock, msg, options = {}) {
  try {
    if (!msg?.message) return;

    const from = msg.key?.remoteJid;
    if (!from || !isInboxJid(from)) return;

    const content = getMessageContent(msg);
    if (!content) return;

    const messageType = Object.keys(content)[0];
    if (!messageType || messageType === 'protocolMessage') return;

    const msgId = msg.key?.id;
    if (!msgId) return;

    const entry = {
      timestamp: Date.now(),
      type: messageType,
      senderJid: msg.key?.participant || from,
      chatJid: from,
      text: getTextContent(content),
      mediaPath: null
    };

    const mediaTypes = ['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage'];
    if (mediaTypes.includes(messageType)) {
      const mediaBuffer = await extractMediaBuffer(msg, messageType, options);
      if (mediaBuffer && mediaBuffer.length) {
        entry.mediaPath = saveMediaToTemp(msgId, messageType, mediaBuffer);
      }
    }

    persistEntry(from, msgId, entry);
  } catch (error) {
    console.error('AntiDelete store error:', error.message || error);
  }
}

async function notifyOwner(sock, text, quoted) {
  if (!OWNER_JID) return;

  try {
    await sock.sendMessage(
      OWNER_JID,
      { text },
      quoted ? { quoted } : {}
    );
  } catch (error) {
    console.error('AntiDelete notify error:', error.message || error);
  }
}

async function recoverDeletedInboxMessage(sock, msg) {
  try {
    if (!OWNER_JID) return;

    const protocol = msg?.message?.protocolMessage;
    if (!protocol || protocol.type !== 0) return;

    const chatJid = msg.key?.remoteJid;
    if (!chatJid || !isInboxJid(chatJid)) return;

    const deletedKey = protocol.key || {};
    const deletedId = deletedKey.id;
    const deletedRemoteJid = deletedKey.remoteJid || chatJid;
    if (!deletedId) return;

    let data = storeByChatAndId.get(makeStoreKey(deletedRemoteJid, deletedId));
    if (!data) {
      data = storeById.get(deletedId) || null;
    }

    if (!data && deletedKey.participant) {
      data = storeByChatAndId.get(makeStoreKey(deletedKey.participant, deletedId)) || null;
    }

    if (!data) {
      await notifyOwner(
        sock,
        `⚠️ *ANTI-DELETE Fallback:* delete detected in ${chatJid}, but original message was not in cache.`,
        msg
      );
      return;
    }

    const senderNumber = (data.senderJid || '').split('@')[0] || 'unknown';
    const header = `╔════════════════════╗\n   ╼ RECOVERY ACTIVE ╾\n╚════════════════════╝\n⎛\n  ⧯ 𝙳𝙴𝙻𝙴𝚃𝙴𝙳 𝙸𝙽𝙱𝙾𝚇\n  ◈ Sender: @${senderNumber}\n  ◈ Chat: ${data.chatJid}\n  ◈ Type: \`${data.type}\`\n⎝\n> ☬ *JAILBREAK ANTI-DELETE* ☬`;
    const sendOptions = {
      quoted: msg,
      mentions: [data.senderJid]
    };

    if (data.mediaPath && fs.existsSync(data.mediaPath)) {
      const media = fs.readFileSync(data.mediaPath);

      if (data.type === 'imageMessage') {
        await sock.sendMessage(OWNER_JID, { image: media, caption: header }, sendOptions);
      } else if (data.type === 'videoMessage') {
        await sock.sendMessage(OWNER_JID, { video: media, caption: header }, sendOptions);
      } else if (data.type === 'audioMessage') {
        await sock.sendMessage(OWNER_JID, { text: header }, sendOptions);
        await sock.sendMessage(OWNER_JID, { audio: media, mimetype: 'audio/ogg; codecs=opus', ptt: true }, sendOptions);
      } else if (data.type === 'stickerMessage') {
        await sock.sendMessage(OWNER_JID, { text: header }, sendOptions);
        await sock.sendMessage(OWNER_JID, { sticker: media }, sendOptions);
      } else if (data.type === 'documentMessage') {
        await sock.sendMessage(
          OWNER_JID,
          { document: media, fileName: 'deleted-inbox-file', mimetype: 'application/octet-stream', caption: header },
          sendOptions
        );
      } else {
        await notifyOwner(sock, `${header}\n\n⚠️ Unsupported stored media type.`, msg);
      }

      return;
    }

    if (data.text) {
      await sock.sendMessage(OWNER_JID, { text: `${header}\n\n📝 *Content:* \`${data.text}\`` }, sendOptions);
      return;
    }

    await notifyOwner(sock, `${header}\n\n⚠️ Delete detected but no text/media payload was available.`, msg);
  } catch (error) {
    console.error('AntiDelete recover error:', error.message || error);
  }
}

async function handleAntiDelete(sock, msg, options = {}) {
  await storeInboxMessage(sock, msg, options);
  await recoverDeletedInboxMessage(sock, msg);
}

module.exports = {
  handleAntiDelete
};
