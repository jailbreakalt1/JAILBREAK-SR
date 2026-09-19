const ACRCloud = require('acrcloud');
const yts = require('yt-search');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');

const SONG_REQUEST_CHANNEL_LINK = 'https://whatsapp.com/channel/0029VagJIAr3bbVzV70jSU1p';
const FALLBACK_THUMBNAIL = 'https://files.catbox.moe/s80m7e.png';
const MAX_BUFFER_SIZE = 8 * 1024 * 1024; // 8MB
const MAX_DOWNLOAD_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2500;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const quota = require('../tools/quota');
const buttonContext = require('../tools/buttonContext');
const { sendInteractiveButtons } = require('../tools/buttonBuilder');

const acr = new ACRCloud({
  host: process.env.ACRCLOUD_HOST || 'identify-us-west-2.acrcloud.com',
  access_key: process.env.ACRCLOUD_ACCESS_KEY || '4ee38e62e85515a47158aeb3d26fb741',
  access_secret: process.env.ACRCLOUD_ACCESS_SECRET || 'KZd3cUQoOYSmZQn1n5ACW5XSbqGlKLhg6G8S8EvJ'
});

const buildTargetMessage = (msg, from) => {
  const current = msg.message || {};
  if (current.videoMessage || current.audioMessage) return msg;

  const ctx = current.extendedTextMessage?.contextInfo;
  if (!ctx?.quotedMessage) return null;

  const quoted = ctx.quotedMessage;
  if (!quoted.videoMessage && !quoted.audioMessage) return null;

  return {
    key: {
      remoteJid: from,
      id: ctx.stanzaId,
      participant: ctx.participant
    },
    message: quoted
  };
};

const identifySong = async (buffer) => {
  const clip = buffer.length > MAX_BUFFER_SIZE ? buffer.slice(0, MAX_BUFFER_SIZE) : buffer;
  const result = await acr.identify(clip);

  if (result?.status?.code !== 0 || !result?.metadata?.music?.length) {
    return null;
  }

  return result.metadata.music[0];
};

/**
 * Resolve a YouTube match (url + thumbnail) for an identified song.
 * Shared by the manual .find card and the auto-shazam pipeline.
 */
const resolveYoutubeMatch = async (query) => {
  try {
    const yt = await yts(query);
    const video = yt?.videos?.[0];
    return {
      url:       video?.url       || null,
      thumbnail: video?.thumbnail || FALLBACK_THUMBNAIL,
    };
  } catch (_) {
    return { url: null, thumbnail: FALLBACK_THUMBNAIL };
  }
};

/**
 * Download + send an already-identified song as an audio document.
 * Used by both the .find chain-download flow and the auto-shazam pipeline.
 * Returns true on success, false on failure (caller decides how to message that).
 */
const sendIdentifiedAudio = async (sock, msg, extra, { title, artists, ytUrl, thumbnail }) => {
  const from = extra.from || msg.key.remoteJid;
  try {
    const songCmd = extra.getCommands?.()?.get('song');
    if (!songCmd || !ytUrl) return false;

    // Sources can be flaky — retry automatically a few times before giving
    // up, so a single bad source doesn't require the user to ask again.
    const release = await songCmd.acquireDL();
    try {
      let payload, audio, lastErr;
      for (let attempt = 1; attempt <= MAX_DOWNLOAD_ATTEMPTS; attempt++) {
        try {
          const resolved = await songCmd.resolveAudioDownload(ytUrl);
          payload = resolved.payload;
          audio = resolved.audio;
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          console.error(`[FIND->SONG chain] download attempt ${attempt}/${MAX_DOWNLOAD_ATTEMPTS} failed: ${err.message}`);
          if (attempt < MAX_DOWNLOAD_ATTEMPTS) await sleep(RETRY_DELAY_MS);
        }
      }
      if (lastErr) throw lastErr;
      const { cleanNumber, toPhoneJid } = require('../tools/jidCleanser');
      const senderJid = toPhoneJid(extra.sender || msg.key.participant || msg.key.remoteJid);
      const senderNum = cleanNumber(senderJid);
      const fileName  = `${songCmd.sanitize(artists, 'Unknown Artist')} - ${songCmd.sanitize(payload?.title || title)}.${audio.ext}`;
      const songMeta  = { title: payload?.title || title, timestamp: '', thumbnail: thumbnail || FALLBACK_THUMBNAIL };

      await sock.sendMessage(from, {
        document: audio.buffer,
        mimetype: audio.mimetype,
        fileName,
        caption: songCmd.buildJailbreakCaption({ info: songMeta, author: artists, ago: 'Recently', senderNum, emoji: '🎧' }),
        mentions: [senderJid],
      }, { quoted: msg });

      return true;
    } finally {
      release();
    }
  } catch (err) {
    console.error('[FIND→SONG chain]', err.message);
    return false;
  }
};

module.exports = {
  name: 'find',
  aliases: ['shazam', 'id', 'whats', 'what is', 'name'],
  category: 'cmd',
  description: 'Identify a song from replied audio/video',
  usage: '.find (reply to audio/video)',

  // Exposed for handler.js's auto-shazam-via-brain pipeline
  identifySong,
  resolveYoutubeMatch,
  sendIdentifiedAudio,

  async execute(sock, msg, _args, extra = {}) {
    const from = extra.from || msg.key.remoteJid;
    const targetMessage = buildTargetMessage(msg, from);

    if (!targetMessage) {
      await sock.sendMessage(from, {
        text: '🎵 Reply to an audio/video with .find, .shazam, or .id.'
      }, { quoted: msg });
      return { ok: false, reason: 'no_target', message: 'No audio/video was replied to — told the user to reply to one.' };
    }

    const sender = msg.key.participant || from;
    const senderNum = (sender || '').split('@')[0];
    const q = quota.getQuota(sender);
    if (!q.allowed) {
      await sock.sendMessage(from, {
        text: `Dear @${extra.pushName || senderNum}, you requested ${q.used} songs today. I can no longer be of service. Limit resets in ${quota.timeUntilReset()}.`
      }, { quoted: msg });
      return { ok: false, reason: 'quota_exhausted', message: `Daily request limit ${q.used}/${q.total} reached — told the user.` };
    }

    try {
      if (typeof extra.react === 'function') await extra.react('🔎');

      const mediaBuffer = await downloadMediaMessage(
        targetMessage,
        'buffer',
        {},
        { logger: undefined, reuploadRequest: sock.updateMediaMessage }
      );

      if (!mediaBuffer?.length) {
        throw new Error('Unable to download media.');
      }

      const song = await identifySong(mediaBuffer);
      if (!song) {
        await sock.sendMessage(from, {
          text: '⫎ Failed to identify. Try a clearer part of the audio.'
        }, { quoted: msg });
        if (typeof extra.react === 'function') await extra.react('❌');
        return { ok: false, reason: 'identify_failed', message: 'Could not identify the song from that clip — told the user.' };
      }

      const title = song.title || 'Unknown';
      const artists = song.artists?.map((a) => a.name).join(', ') || 'Unknown';
      const album = song.album?.name || 'Single';
      const genres = song.genres?.map((g) => g.name).join(', ') || 'General';
      const query = `${title} ${artists}`.trim();

      const { url: ytUrl, thumbnail } = await resolveYoutubeMatch(query);
      const ytLink = ytUrl || 'Not available';

      // ── Chain: identify + download in one go ──────────────────────────────
      // Triggered when brain uses action "find" with extra.__chainDownload = true
      // (set by handler when it sees action "download_song" from the brain)
      if (extra.__chainDownload && ytUrl) {
        if (typeof extra.react === 'function') await extra.react('🎵');
        const sent = await sendIdentifiedAudio(sock, msg, extra, { title, artists, ytUrl, thumbnail });
        if (sent) {
          quota.useQuota(sender);
          if (typeof extra.react === 'function') await extra.react('✅');
          return { ok: true }; // sent the audio — don't also send the identify card
        }
        // Fall through to normal identify card if download fails — audio was
        // NOT sent, only the identify card below will be, so the caller must
        // be told the download specifically failed.
      }

      const q2 = quota.useQuota(sender);
      const senderNum = (sender || '').split('@')[0];
      const responseText =
`╼ 𝚂𝙾𝙽𝙶 𝙸𝙳𝙴𝙽𝚃𝙸𝙵𝙸𝙴𝙳 ╾
⎛
  ◈ 𝚂𝙾𝙽𝙶 : \`${title}\`
  ◈ 𝙰𝚁𝚃𝙸𝚂𝚃 : \`${artists}\`
  ◈ 𝙰𝙻𝙱𝚄𝙼 : \`${album}\`
  ◈ 𝙶𝙴𝙽𝚁𝙴 : \`${genres}\`
⎝

⧯ *YouTube Link:* ${ytLink}

 ☬ *JAILBREAK HUB* ☬`;

      const footer = `*Copy:* \`${artists} - ${title}\`\n_@${senderNum}, you've used ${q2.used}/${q2.total} today — ${q2.total - q2.used} remaining_`;

      // Keep the query per chat so taps that only deliver the label (buttons
      // with no id) can still be resolved back to a real query.
      buttonContext.set(from, { videoQuery: query });

      let buttonsSent = false;
      try {
        await sendInteractiveButtons(sock, from, {
          headerTitle: `${artists} - ${title}`,
          headerSubtitle: 'JAILBREAK-SR BRINGS YOU',
          bodyText: responseText,
          footerText: footer,
          thumbnail: thumbnail || FALLBACK_THUMBNAIL,
          buttons: [
            { name: 'quick_reply', displayText: '⬇ DOWNLOAD SONG', id: `finddl:${encodeURIComponent(query)}` },
            { name: 'quick_reply', displayText: '🎬 FETCH VIDEO',   id: `viddl:${encodeURIComponent(query)}` },
            { name: 'quick_reply', displayText: '📸 FETCH PHOTOS',  id: `imgdl:${encodeURIComponent(query)}` },
          ],
        }, { quoted: msg });
        buttonsSent = true;
      } catch (err) {
        console.warn('[FIND] interactive send failed, falling back to plain text:', err?.message || err);
      }

      if (!buttonsSent) {
        await sock.sendMessage(from, {
          text: `${responseText}\n\n${footer}\n\nDownload: \`.song ${query}\``
        }, { quoted: msg });
      }

      if (typeof extra.react === 'function') await extra.react('✅');

      // If a download was requested (__chainDownload) but we got here, the
      // audio send failed and we fell back to this identify card instead —
      // the song WAS identified/sent-as-card, but the actual download did not
      // happen, so the caller must be told that explicitly.
      return extra.__chainDownload
        ? { ok: true, reason: 'identified_only', message: 'Identified the song and sent the info card, but the audio download itself failed — tell the user the file could not be downloaded, only what it is.' }
        : { ok: true };
    } catch (error) {
      console.error('[FIND] command error:', error?.message || error);
      await sock.sendMessage(from, {
        text: '⚠️ System error during identification.'
      }, { quoted: msg });
      if (typeof extra.react === 'function') await extra.react('❌');
      return { ok: false, reason: 'error', message: error?.message || 'Unknown error' };
    }
  }
};
