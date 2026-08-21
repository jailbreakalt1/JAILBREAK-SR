const { nowInConfiguredTimezone, resolveTimezone } = require('./timezone');

const UNIVERSAL_MESSAGE_CONTEXT = {
  forwardingScore: 1,
  isForwarded: false
};

if (process.env.NEWSLETTER_JID) {
  UNIVERSAL_MESSAGE_CONTEXT.forwardedNewsletterMessageInfo = {
    newsletterJid: process.env.NEWSLETTER_JID,
    newsletterName: process.env.NEWSLETTER_NAME || 'JAILBREAK HOME',
    serverMessageId: -1
  };
}

const STYLE_BYPASS_PREFIXES = [
  '‧₊˚♕‧₊˚',
  '*',
  '╔═',
  '⧯',
  '☬'
];

const MENTION_PATTERN = /@(\d{5,15})\b/g;

const extractMentions = (value) => {
  if (typeof value !== 'string' || !value) return [];
  const matches = [];
  const pattern = new RegExp(MENTION_PATTERN.source, 'g');
  let match;
  while ((match = pattern.exec(value)) !== null) {
    matches.push(`${match[1]}@s.whatsapp.net`);
  }
  return matches;
};

const mergeMentions = (...groups) => {
  const seen = new Set();
  const merged = [];
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const jid of group) {
      if (typeof jid !== 'string' || !jid) continue;
      if (seen.has(jid)) continue;
      seen.add(jid);
      merged.push(jid);
    }
  }
  return merged;
};

const decorateText = (value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;

  if (STYLE_BYPASS_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) {
    return value;
  }

  const now = nowInConfiguredTimezone();
  const dateLine = now.format('DD/MM/YYYY');
  const timeLine = now.format('hh:mm A');
  const timezoneLine = resolveTimezone().toUpperCase();

  const lines = trimmed.split('\n').map((line) => line.trim());
  const firstLine = lines[0] || '';
  const remainingLines = lines.slice(1).join('\n');
  const body = [
    `‧₊˚♕‧₊˚  ${firstLine} ̤̮̆̈ ₊˚⊹`,
    remainingLines ? `${remainingLines}ᯓ➤` : '🗁'
  ].join('\n');

  return `*⧯ 𝙹𝙰𝙸𝙻𝙱𝚁𝙴𝙰𝙺_SR ☬*\n`
    + `⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯\n\n`
    + `${body}\n\n`
    + `> ▶︎•၊၊||၊|။|||||။၊|။|၊၊||၊၊၊၊•\n`
    + `> ${dateLine}\n`
    + `> ${timeLine}\n`
    + `> ${timezoneLine}\n`
    + `> 𝄃𝄃𝄂𝄂𝄀𝄁𝄃𝄂𝄂𝄃𝄃𝄃𝄂𝄂𝄀𝄁𝄃𝄂𝄂𝄃𝄃𝄃𝄂𝄂𝄀𝄁𝄃𝄂𝄂𝄃\n`
    + `⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯`;
};

const attachUniversalContext = (content = {}) => {
  if (!content || typeof content !== 'object') return content;

  const unsupportedKeys = [
    'react',
    'delete',
    'edit',
    'protocolMessage',
    'contacts',
    'poll',
    'groupInviteMessage'
  ];

  if (unsupportedKeys.some((key) => key in content)) {
    return content;
  }

  const nextContent = {
    ...content,
    contextInfo: {
      ...(content.contextInfo || {}),
      ...UNIVERSAL_MESSAGE_CONTEXT
    }
  };

  const inferredMentions = mergeMentions(
    content.mentions,
    content.contextInfo?.mentionedJid,
    extractMentions(content.text),
    extractMentions(content.caption)
  );

  if (inferredMentions.length) {
    nextContent.mentions = inferredMentions;
    nextContent.contextInfo.mentionedJid = mergeMentions(
      nextContent.contextInfo.mentionedJid,
      inferredMentions
    );
  }

  if (typeof nextContent.text === 'string') {
    nextContent.text = decorateText(nextContent.text);
  }

  if (typeof nextContent.caption === 'string') {
    nextContent.caption = decorateText(nextContent.caption);
  }

  return nextContent;
};

const wrapSendMessageWithUniversalContext = (sock) => {
  if (!sock || typeof sock.sendMessage !== 'function' || sock.__jbxWrappedSendMessage) {
    return sock;
  }

  const originalSendMessage = sock.sendMessage.bind(sock);
  sock.sendMessage = (jid, content, options = {}) => {
    const { __skipStyle, ...safeOptions } = options || {};
    const payload = __skipStyle ? content : attachUniversalContext(content);
    return originalSendMessage(jid, payload, safeOptions);
  };
  sock.__jbxWrappedSendMessage = true;
  return sock;
};

module.exports = {
  UNIVERSAL_MESSAGE_CONTEXT,
  attachUniversalContext,
  wrapSendMessageWithUniversalContext,
  decorateText
};
