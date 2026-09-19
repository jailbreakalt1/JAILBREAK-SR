/**
 * Native interactive-message with quick_reply buttons — built directly on
 * Baileys' proto (no third-party helper package). Taps come back as
 * interactiveResponseMessage/nativeFlowResponseMessage (with paramsJson
 * { display_text, id }) or, on some clients, as
 * templateButtonReplyMessage / buttonsResponseMessage.
 *
 * Example button:
 *   { name: 'quick_reply', displayText: '⬇ DOWNLOAD SONG', id: 'finddl:...' }
 *   { name: 'cta_url',      displayText: '▶ JOIN',        url: 'https://...' }
 */

const { proto, generateWAMessageFromContent } = require('@whiskeysockets/baileys');

async function sendInteractiveButtons(sock, jid, opts = {}, { quoted } = {}) {
  const userJid = opts.userJid || (sock && sock.user ? sock.user.id : undefined);
  const flowButtons = (opts.buttons || []).map((b) => {
    const params = { display_text: b.displayText };
    if (b.name === 'cta_url') {
      params.url = b.url || '';
    } else {
      params.id = b.id || '';
    }
    return { name: b.name || 'quick_reply', buttonParamsJson: JSON.stringify(params) };
  });

  const content = {
    interactiveMessage: {
      header: {
        title: opts.headerTitle || '',
        subtitle: opts.headerSubtitle || '',
        hasMediaAttachment: false,
      },
      body: { text: opts.bodyText || '' },
      footer: { text: opts.footerText || '' },
      contextInfo: opts.thumbnail ? {
        externalAdReply: {
          title: opts.headerTitle || '',
          body: opts.headerSubtitle || 'JAILBREAK-SR',
          thumbnailUrl: opts.thumbnail,
          sourceUrl: '',
          mediaType: 1,
          renderLargerThumbnail: true,
        },
      } : undefined,
      nativeFlowMessage: {
        buttons: flowButtons,
        messageVersion: 1,
      },
    },
  };

  const generated = generateWAMessageFromContent(jid, content, { timestamp: new Date(), quoted, userJid });
  if (sock && typeof sock.relayMessage === 'function') {
    await sock.relayMessage(jid, generated.message, { messageId: generated.key.id });
  }
  return generated;
}

module.exports = { sendInteractiveButtons, proto };