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
  '*╔═══════════════════╗*',
  '╔═══════════════════╗',
  '⧯ *𝙹𝙰𝙸𝙻𝙱𝚁𝙴𝙰𝙺_𝙰𝙸* 𝙱𝚁𝙸𝙽𝙶𝚂 𝚈𝙾𝚄'
];

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

  return `*⧯ 𝙹𝙰𝙸𝙻𝙱𝚁𝙴𝙰𝙺_𝙰𝙸 ☬*\n`
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
