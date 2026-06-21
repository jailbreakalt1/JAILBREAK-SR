const { jidNormalizedUser } = require('@whiskeysockets/baileys');

function cleanJid(jid) {
  if (!jid) return '';
  return jid.split('@')[0].split(':')[0] || '';
}

function cleanJidWithDevice(jid) {
  if (!jid) return '';
  return jid.split('@')[0] || '';
}

function toPhoneJid(number) {
  if (!number) return '';
  const clean = cleanJid(number);
  return clean ? `${clean}@s.whatsapp.net` : '';
}

function areSameUser(jid1, jid2) {
  return cleanJid(jid1) === cleanJid(jid2);
}

function isLikelyPhoneJid(jid) {
  if (!jid) return false;
  const user = jid.split('@')[0];
  const digits = user.replace(/\D/g, '');
  return digits.length > 0 && digits.length <= 15;
}

async function resolveJid(sock, jid) {
  if (!jid) return jid;
  if (jid.endsWith('@lid')) {
    try {
      const pn = await sock.signalRepository.lidMapping.getPNForLID(jid);
      if (pn) return pn;
    } catch (_) {}
  }
  return jid;
}

async function jidToCleanPhone(sock, jid) {
  const resolved = await resolveJid(sock, jid);
  return cleanJid(resolved);
}

module.exports = {
  cleanJid,
  cleanJidWithDevice,
  toPhoneJid,
  areSameUser,
  isLikelyPhoneJid,
  resolveJid,
  jidToCleanPhone,
  jidNormalizedUser,
};
