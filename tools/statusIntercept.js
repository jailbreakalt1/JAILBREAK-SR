const chalk = require('chalk');
const moment = require('moment-timezone');
const { getContentType, jidNormalizedUser, normalizeMessageContent, isLidUser, isPnUser } = require('@whiskeysockets/baileys');
const config = require('../config');

const STATUS_REACTIONS = ['👍', '👀', '🔥', '🤐', '😮', '🍿', '💯', '😂', '👏', '🥂', '🤔', '🫡', '⚡', '🛸'];
const FALLBACK_PFP = 'https://placehold.co/150x150/1e293b/ffffff?text=JB';
const STATUS_JID = 'status@broadcast';
const CHANNEL_LINK = 'https://whatsapp.com/channel/0029VagJIAr3bbVzV70jSU1p';

const sanitizeNumberDigits = (value = '') => String(value).replace(/\D/g, '');

const isLikelyPhoneJid = (jid) => {
  if (!jid) return false;
  const user = jid.split('@')[0];
  const digits = user.replace(/\D/g, '');
  return digits.length > 0 && digits.length <= 15;
};

const formatTimestamp = (timestampSeconds = 0) => {
  const timestamp = Number(timestampSeconds || 0);
  return moment((timestamp > 0 ? timestamp : Math.floor(Date.now() / 1000)) * 1000)
    .tz(config.timezone || 'Africa/Harare') 
    .format('HH:mm • DD/MM/YY');
};

const getOwnJids = (sock) => [
  sock?.user?.id,
  sock?.user?.jid,
  sock?.user?.lid,
  sock?.authState?.creds?.me?.id,
  sock?.authState?.creds?.me?.jid,
  sock?.authState?.creds?.me?.lid
].map(jidNormalizedUser).filter(Boolean);

const isOwnStatus = (sock, posterJid) => {
  const normalizedPoster = jidNormalizedUser(posterJid);
  return Boolean(normalizedPoster && getOwnJids(sock).includes(normalizedPoster));
};

const isSocketConnected = (sock) => {
  try {
    return sock?.ws?.readyState === 1;
  } catch {
    return false;
  }
};

const resolvePosterJid = (sock, msg = {}) => {
  const message = normalizeMessageContent(msg.message || {});

  const candidates = [
    msg?.key?.participant_pn,
    msg?.participant_pn,
    msg?.key?.participant,
    msg?.participant,
    msg?.message?.protocolMessage?.key?.participant,
    msg?.message?.reactionMessage?.key?.participant,
    msg?.message?.messageContextInfo?.participant,
    message?.protocolMessage?.key?.participant,
    message?.reactionMessage?.key?.participant,
    message?.messageContextInfo?.participant,
    msg?.key?.remoteJid,
    msg?.key?.participant_lid,
    msg?.participant_lid
  ];

  const normalized = candidates.map(jidNormalizedUser).filter(Boolean);

  const pnJid = normalized.find((jid) => jid !== STATUS_JID && isPnUser(jid));
  if (pnJid) return pnJid;

  const nonLidJid = normalized.find((jid) => jid !== STATUS_JID && jid.includes('@') && !isLidUser(jid) && isLikelyPhoneJid(jid));
  if (nonLidJid) return nonLidJid;

  const lidJid = normalized.find((jid) => jid !== STATUS_JID && isLidUser(jid));
  if (lidJid) return lidJid;

  if (msg?.key?.fromMe) return getOwnJids(sock)[0] || null;

  console.warn('⚠️ [STATUS] resolvePosterJid failed - msg.key:', JSON.stringify(msg.key));
  return null;
};

const buildStatusKey = (msg, posterJid) => ({
  remoteJid: STATUS_JID,
  id: msg?.key?.id,
  participant: posterJid,
  fromMe: false
});

const logInterceptStep = ({ logTag, cmdTag, pushName, senderNumber, mtype, time, body }) => {
  console.log(
    chalk.gray(`\n┌─── `) + chalk.cyan(`JAILBREAK INTERCEPT`) + chalk.gray(` ───\n`) +
    chalk.gray(`│ `) + logTag + chalk.white(` From: ${pushName} (${senderNumber})\n`) +
    chalk.gray(`│ `) + cmdTag + chalk.gray(` | Type: ${mtype} | Time: ${time}\n`) +
    chalk.gray(`│ `) + chalk.magenta(`Content: `) + chalk.white((body || '').length > 50 ? `${(body || '').substring(0, 50)}...` : (body || '')) + `\n` +
    chalk.gray(`└───────────────────────────`)
  );
};

const configuredOwnerNumbers = () => {
  const envOwners = String(process.env.OWNER_NUMBER || '')
    .split(',')
    .map(sanitizeNumberDigits)
    .filter(Boolean);

  if (envOwners.length > 0) return envOwners;

  const configured = Array.isArray(config.ownerNumber)
    ? config.ownerNumber
    : String(config.ownerNumber || '').split(',');

  return configured.map(sanitizeNumberDigits).filter(Boolean);
};

const resolveOwnerJid = (sock, forwardJid) => {
  if (forwardJid) return jidNormalizedUser(forwardJid);

  const ownerNumber = configuredOwnerNumbers()[0];
  if (ownerNumber) return jidNormalizedUser(`${ownerNumber}@s.whatsapp.net`);

  return getOwnJids(sock)[0] || null;
};

async function notifyCriticalStatusError(sock, error, msg) {
  const targetJid = resolveOwnerJid(sock);
  if (!targetJid) return;

  const detail = error?.stack || error?.message || String(error);
  try {
    await sock.sendMessage(targetJid, {
      text: `🚨 *STATUS INTERCEPT CRITICAL ERROR*\n\n${detail.slice(0, 1500)}`,
      contextInfo: {
        forwardingScore: 1,
        isForwarded: true
      }
    }, { ...(msg ? { quoted: msg } : {}), __skipStyle: true });
  } catch (notifyError) {
    console.error('❌ [STATUS] Failed to notify owner about critical error:', notifyError.message || notifyError);
  }
}

async function handleAutoStatusIntercept(sock, msg, options = {}) {
  const { downloadMediaMessage, forwardJid } = options;

  try {
    if (msg?.key?.remoteJid !== STATUS_JID) return false;
    if (!msg?.message) return true;

    const posterJid = resolvePosterJid(sock, msg);
    if (!posterJid || posterJid === STATUS_JID) {
      console.warn('⚠️ [STATUS] Skipping status without a resolvable poster JID:', msg?.key?.id || 'unknown-id');
      return true;
    }

    if (isOwnStatus(sock, posterJid)) return true;

    const statusKey = buildStatusKey(msg, posterJid);
    const posterNumber = sanitizeNumberDigits(posterJid.split('@')[0] || '');
    const randomEmoji = STATUS_REACTIONS[Math.floor(Math.random() * STATUS_REACTIONS.length)];
    const targetJid = resolveOwnerJid(sock, forwardJid);

    if (!targetJid) {
      console.warn('⚠️ [STATUS] Skipping status intercept because no owner JID is configured.');
      return true;
    }

    try {
      if (typeof sock.readMessages === 'function') {
        await sock.readMessages([statusKey]);
      }

      await sock.sendMessage(
        STATUS_JID,
        { react: { text: randomEmoji, key: statusKey, groupingKey: msg?.key?.id } },
        { statusJidList: [posterJid] }
      );

      console.log(`🟢 [STATUS] Viewed & Reacted (${randomEmoji}) to ${posterNumber}`);
    } catch (error) {
      console.error('⚠️ [STATUS] Auto view/react failed:', error.message || error);
    }

    const normalized = normalizeMessageContent(msg.message || {});
    const messageType = getContentType(normalized);
    const body = (
      messageType === 'conversation'
        ? normalized?.conversation
        : normalized?.[messageType]?.caption || normalized?.[messageType]?.text || ''
    ).trim();

    let profilePicUrl = FALLBACK_PFP;
    if (isSocketConnected(sock)) {
      try {
        profilePicUrl = await sock.profilePictureUrl(posterJid, 'image');
      } catch (_) {
        profilePicUrl = FALLBACK_PFP;
      }
    }

    const displayName = (msg.pushName || posterNumber || 'Unknown').trim();
    const postedTime = formatTimestamp(msg.messageTimestamp);

    logInterceptStep({
      logTag: chalk.yellow('[STATUS]'),
      cmdTag: chalk.cyan('status updated'),
      pushName: displayName,
      senderNumber: posterNumber || 'unknown',
      mtype: messageType || 'unknown',
      time: postedTime,
      body
    });

    const jbContext = {
      forwardingScore: 1,
      isForwarded: true,
      forwardedNewsletterMessageInfo: {
        newsletterJid: config.newsletterJid || '120363424536255731@newsletter',
        newsletterName: 'JAILBREAK_SR',
        serverMessageId: -1
      },
      externalAdReply: {
        title: `STATUS: ${displayName.toUpperCase()}`,
        body: `Captured by ${config.botName || 'Jailbreak System'} [${randomEmoji}]`,
        thumbnailUrl: profilePicUrl,
        mediaType: 1,
        renderLargerThumbnail: true,
        sourceUrl: CHANNEL_LINK
      }
    };

    const captionHeader = `${randomEmoji} *JAILBREAK STATUS INTERCEPT*\n\n` +
      `> 👤 ${displayName}\n` +
      `> 📱 ${posterNumber}\n` +
      `> 🕒 ${postedTime}\n`;
    const caption = body ? `${captionHeader}\n\n📝 *Caption:*\n${body}` : captionHeader;

    let messageToSend = {
      text: caption,
      ai: true,
      contextInfo: jbContext
    };

    if (['imageMessage', 'videoMessage', 'audioMessage'].includes(messageType) && typeof downloadMediaMessage === 'function') {
      try {
        const buffer = await downloadMediaMessage(msg, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage?.bind(sock) });
        if (buffer) {
          if (messageType === 'imageMessage') {
            messageToSend = { image: buffer, caption, ai: true, contextInfo: jbContext };
          } else if (messageType === 'videoMessage') {
            messageToSend = { video: buffer, caption, mimetype: normalized?.videoMessage?.mimetype || 'video/mp4', ai: true, contextInfo: jbContext };
          } else if (messageType === 'audioMessage') {
            messageToSend = { audio: buffer, mimetype: normalized?.audioMessage?.mimetype || 'audio/mp4', ptt: true, ai: true, contextInfo: jbContext };
          }
        }
      } catch (error) {
        console.error('❌ [STATUS] Media download failed:', error.message || error);
        messageToSend = { text: `${caption}\n\n⚠️ *Media Intercept Failed*`, ai: true, contextInfo: jbContext };
      }
    }

    await sock.sendMessage(targetJid, messageToSend, { __skipStyle: true });
    console.log(`✅ [STATUS] Intercept logged to owner: ${posterNumber}`);
    return true;
  } catch (error) {
    console.error('❌ [STATUS] Intercept error:', error.message || error);
    await notifyCriticalStatusError(sock, error, msg);
    return true;
  }
}

module.exports = {
  handleAutoStatusIntercept,
  STATUS_JID
};
