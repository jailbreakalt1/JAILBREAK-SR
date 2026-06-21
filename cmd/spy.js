const axios = require('axios');

// Global metadata attached to outgoing intel messages
const jbContext = {
  forwardingScore: 1,
  isForwarded: true,
  forwardedNewsletterMessageInfo: {
    newsletterJid: '120363424536255731@newsletter',
    newsletterName: 'JAILBREAK HOME',
    serverMessageId: -1
  }
};

const DEFAULT_PROFILE_PIC = 'https://files.catbox.moe/s80m7e.png';
const ABSTRACT_API_KEY = '028b996094b545c8beb77eee1cf632bd';

const extractMentionedJid = (msg) => {
  const contextInfo = msg.message?.extendedTextMessage?.contextInfo
    || msg.message?.imageMessage?.contextInfo
    || msg.message?.videoMessage?.contextInfo
    || msg.message?.documentMessage?.contextInfo;

  return contextInfo?.mentionedJid?.[0] || null;
};

const extractQuotedSender = (msg) => {
  const contextInfo = msg.message?.extendedTextMessage?.contextInfo
    || msg.message?.imageMessage?.contextInfo
    || msg.message?.videoMessage?.contextInfo
    || msg.message?.documentMessage?.contextInfo;

  return contextInfo?.participant
    || msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
    || null;
};

module.exports = {
  name: 'spy',
  aliases: ['whois', 'userinfo'],
  category: 'general',
  description: 'Get information about a WhatsApp user',
  usage: '.spy @user | .spy 2637xxxxxx | reply to a message',

  async execute(sock, msg, args, extra) {
    try {
      const from = extra.from || msg.key.remoteJid;
      let targetJid;

      // TARGET RESOLUTION
      const rawArg = (args || []).join(' ').trim();
      const rawNumber = rawArg.replace(/\D/g, '');

      if (rawNumber.length >= 6) {
        targetJid = `${rawNumber}@s.whatsapp.net`;
      } else {
        const mentionedJid = extractMentionedJid(msg);
        if (mentionedJid) {
          targetJid = mentionedJid;
        } else {
          const quotedSender = extractQuotedSender(msg);
          if (quotedSender) {
            targetJid = quotedSender;
          } else {
            targetJid = msg.key.participant || from;
          }
        }
      }

      if (!targetJid) {
        return extra.reply('⧯ `Error: Tag, reply, or provide a valid number.` ❌');
      }

      // PROFILE PICTURE
      let profilePic;
      try {
        profilePic = await sock.profilePictureUrl(targetJid, 'image');
      } catch {
        profilePic = DEFAULT_PROFILE_PIC;
      }

      // ABOUT / BIO
      let about = 'No bio found';
      try {
        const statusResult = await sock.fetchStatus(targetJid);
        about = statusResult?.status || about;
      } catch {
        // Ignore if status is unavailable
      }

      // PHONE VALIDATION
      const phoneNumber = targetJid.split('@')[0];
      let validation = '  ⫎ `Signal Interrupted`';

      try {
        const { data } = await axios.get(
          `https://phonevalidation.abstractapi.com/v1/?api_key=${ABSTRACT_API_KEY}&phone=${phoneNumber}`
        );

        validation =
          `  ⨇ Valid: \`${data.valid}\`\n`
          + `  ⨇ Country: \`${data.country?.name || 'Unknown'}\`\n`
          + `  ⨇ Carrier: \`${data.carrier || 'Unknown'}\`\n`
          + `  ⨇ Location: \`${data.location || 'Unknown'}\`\n`
          + `  ⨇ Type: \`${data.type || 'Unknown'}\``;
      } catch {
        validation = '  ⫎ `Abstract API Limit Reached`';
      }

      const responseText = `
      ╼ USER INTEL ╾ 
⎛ ⧯ 𝙸𝙳𝙴𝙽𝚃𝙸𝚃𝚈 𝙳𝙰𝚃𝙰
  ◈ JID: \`${targetJid}\`
  ◈ Bio: \`${about}\`
  ◈ Status: \`Online/Visible\`

  ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
  ֎ 𝙿𝙷𝙾𝙽𝙴 𝚅𝙰𝙻𝙸𝙳𝙰𝚃𝙸𝙾𝙽
${validation}
⎝
> ☬ *J~B F.B.I* ☬`;

      await sock.sendMessage(from, {
        image: { url: profilePic },
        caption: responseText,
        contextInfo: {
          ...jbContext,
          externalAdReply: {
            title: `INTEL DECODED: ${phoneNumber}`,
            body: 'Jailbreak OS Security Module',
            mediaType: 1,
            thumbnailUrl: DEFAULT_PROFILE_PIC,
            sourceUrl: 'https://whatsapp.com/channel/0029VagJIAr3bbVzV70jSU1p'
          }
        }
      }, { quoted: msg });
    } catch (error) {
      console.error('❌ Spy command error:', error);
      await extra.reply('⧯ `Critical Error: Intel gathering failed.` ❌');
    }
  }
};
