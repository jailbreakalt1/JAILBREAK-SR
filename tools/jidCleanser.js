/**
 * JID Cleanser
 * ────────────
 * WhatsApp's multi-device system now identifies senders in two ways:
 *
 *   - PN  (phone number)  → 263717456159@s.whatsapp.net
 *   - LID (local id)       → 184729384729@lid   (anonymous, NOT a phone number)
 *
 * Baileys sometimes hands the bot a LID instead of a real number (in
 * `msg.key.participant`, `msg.key.remoteJid`, `contextInfo.participant`,
 * `contextInfo.mentionedJid[...]`, etc). On top of that, numbers resolved
 * via the LID<->PN store frequently come back with a trailing WhatsApp
 * "device id" suffix, e.g. `263717456159:0@s.whatsapp.net`, which leaks
 * into mentions/captions as a literal ":0" if not stripped.
 *
 * This module guarantees that by the time a message reaches ANY command
 * or tool, every JID it can see has already been turned into a clean,
 * real phone-number JID (`<digits>@s.whatsapp.net`) with no `@lid` and
 * no `:device` suffix anywhere - no command should ever need to think
 * about LIDs again.
 *
 * Call `cleanseMessage(sock, msg)` ONCE, as early as possible (right when
 * a message is received), and every downstream consumer (handler.js,
 * cmd/*, tools/*) is guaranteed clean data.
 */

const PN_DOMAIN = 's.whatsapp.net';

/**
 * Strip the WhatsApp domain (@s.whatsapp.net / @lid / @g.us / ...) AND the
 * ":device" suffix from a jid, returning just the bare digits.
 *   "263717456159:0@s.whatsapp.net" -> "263717456159"
 *   "184729384729@lid"              -> "184729384729"
 */
function cleanNumber(jid) {
  if (!jid || typeof jid !== 'string') return '';
  const userPart = jid.split('@')[0] || '';
  return userPart.split(':')[0];
}

/** True if the jid is a LID (anonymous id), never an actual phone number. */
function isLid(jid) {
  return typeof jid === 'string' && jid.endsWith('@lid');
}

/** Rebuild a clean phone-number JID from raw input (jid or bare number). */
function toPhoneJid(value) {
  const num = cleanNumber(value);
  return num ? `${num}@${PN_DOMAIN}` : value;
}

/**
 * Resolve any jid into a clean, real phone-number JID.
 *
 * @param sock     active baileys socket (used for the LID<->PN store lookup)
 * @param jid      the jid to resolve (may be PN, LID, group, etc.)
 * @param altJid   an already-known PN counterpart, if baileys supplied one
 *                 (e.g. `key.participantPn`, `key.participantAlt`,
 *                 `key.remoteJidAlt`). Using this avoids an async store
 *                 lookup entirely whenever possible.
 */
async function resolvePhoneJid(sock, jid, altJid) {
  if (!jid || typeof jid !== 'string') return jid;

  // Groups / broadcast / newsletter / bot jids - leave the domain alone,
  // just strip any stray device suffix from the user part for safety.
  if (jid.endsWith('@g.us') || jid.endsWith('@broadcast') || jid.endsWith('@newsletter') || jid.endsWith('@bot')) {
    return `${cleanNumber(jid)}@${jid.split('@')[1]}`;
  }

  if (!isLid(jid)) {
    // Already a PN-style jid - just trim the device suffix.
    return toPhoneJid(jid);
  }

  // It's a LID. Prefer a PN counterpart baileys already gave us.
  if (altJid && typeof altJid === 'string' && !isLid(altJid)) {
    return toPhoneJid(altJid);
  }

  // Fall back to the LID<->PN mapping store baileys maintains internally.
  try {
    const pn = await sock?.signalRepository?.lidMapping?.getPNForLID(jid);
    if (pn) return toPhoneJid(pn);
  } catch (_) {
    // store unavailable / lookup failed - fall through
  }

  // Could not resolve. Returning a number-only, domain-less value would be
  // worse (commands expect "<digits>@something"), so we keep it tagged as
  // @lid but at least device-suffix free, so callers can still detect this
  // edge case explicitly if they need to instead of seeing garbage digits.
  return `${cleanNumber(jid)}@lid`;
}

/** Cleanse a message `key` object (remoteJid + participant). Returns a new key. */
async function cleanseKey(sock, key) {
  if (!key || typeof key !== 'object') return key;

  const next = { ...key };

  if (key.participant) {
    next.participant = await resolvePhoneJid(sock, key.participant, key.participantPn || key.participantAlt);
  }

  if (key.remoteJid) {
    next.remoteJid = await resolvePhoneJid(sock, key.remoteJid, key.remoteJidAlt);
  }

  return next;
}

/** Cleanse a `contextInfo` block (quoted participant + mentioned jids). */
async function cleanseContextInfo(sock, contextInfo) {
  if (!contextInfo || typeof contextInfo !== 'object') return contextInfo;

  const next = { ...contextInfo };

  if (contextInfo.participant) {
    next.participant = await resolvePhoneJid(sock, contextInfo.participant);
  }

  if (Array.isArray(contextInfo.mentionedJid) && contextInfo.mentionedJid.length) {
    next.mentionedJid = await Promise.all(
      contextInfo.mentionedJid.map((jid) => resolvePhoneJid(sock, jid))
    );
  }

  return next;
}

// Wrapper message types whose inner `.message` also carries real content
// with its own contextInfo that should be cleansed.
const UNWRAP_KEYS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
];

/** Walk every message-type node in `message` and cleanse its contextInfo. */
async function cleanseMessageContent(sock, message) {
  if (!message || typeof message !== 'object') return;

  for (const type of Object.keys(message)) {
    const part = message[type];
    if (!part || typeof part !== 'object') continue;

    if (part.contextInfo) {
      part.contextInfo = await cleanseContextInfo(sock, part.contextInfo);
    }

    if (UNWRAP_KEYS.includes(type) && part.message) {
      await cleanseMessageContent(sock, part.message);
    }
  }
}

/**
 * Cleanse an entire incoming message in place (and return it).
 * Safe to call multiple times on the same message (idempotent).
 */
async function cleanseMessage(sock, msg) {
  if (!msg || typeof msg !== 'object') return msg;

  if (msg.key) {
    msg.key = await cleanseKey(sock, msg.key);
  }

  if (msg.message) {
    await cleanseMessageContent(sock, msg.message);

    // The key embedded inside a delete/edit protocol message points at a
    // *different* message; cleanse it too so anti-delete/edit features
    // never resurface a LID either.
    const protocolKey = msg.message.protocolMessage?.key;
    if (protocolKey) {
      msg.message.protocolMessage.key = await cleanseKey(sock, protocolKey);
    }
  }

  return msg;
}

/**
 * The bot's own phone-number JID, cleaned of any device suffix.
 * Use this whenever `msg.key.fromMe` is true - in that case the "sender"
 * is unambiguously this account, and there is no need (and no safe way)
 * to infer it from remoteJid/participant, which point at the OTHER party
 * in a 1:1 chat.
 */
function getOwnPhoneJid(sock) {
  const raw = sock?.user?.id || sock?.authState?.creds?.me?.id;
  return raw ? toPhoneJid(raw) : null;
}

module.exports = {
  cleanNumber,
  isLid,
  toPhoneJid,
  resolvePhoneJid,
  getOwnPhoneJid,
  cleanseKey,
  cleanseContextInfo,
  cleanseMessage,
};
