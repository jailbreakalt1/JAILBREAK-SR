const fs   = require('fs');
const path = require('path');
const config   = require('./config');
const database = require('./database');
const chalk    = require('chalk');
const { normalizeMessageContent, downloadMediaMessage } = require('@whiskeysockets/baileys');
const { cleanNumber, resolvePhoneJid, getOwnPhoneJid } = require('./tools/jidCleanser');
const brain      = require('./brain/ai');
const visionBrain = require('./brain/visionAi');
const memory     = require('./brain/memory');
const userProfiles = require('./brain/userProfiles');
const checkIn    = require('./brain/checkIn');
const tts        = require('./brain/tts');
const quota      = require('./tools/quota');
const apiTools   = require('./tools/api');
const buttonContext = require('./tools/buttonContext');
const songRecommend = require('./brain/songRecommend');
const toolRunner = require('./brain/toolRunner');
const stt        = require('./brain/stt');
const celebrate  = require('./tools/celebrate');
const xpTools    = require('./tools/xp');
const blacklist  = require('./tools/blacklist');

const badWords = [
  'fuck', 'fck', 'fuk', 'fvck', 'shit', 'sh1t', 'ass', 'azz', 'arse',
  'bitch', 'b1tch', 'damn', 'damm', 'dick', 'd1ck', 'bastard',
  'piss', 'slut', 'whore', 'cock', 'c0ck', 'crap', 'cr4p', 'cunt',
  'porn', 'pr0n', 'sex', 's3x', 'pussy', 'penis', 'vagina', 'dildo',
  'nude', 'naked', 'nigger', 'nigga', 'faggot', 'fag', 'retard',
  'motherfucker', 'motherfuck', 'bullshit', 'jackass', 'xvideo',
  'bollocks', 'bloody', 'wanker', 'pornhub', 'xvideos', 'xhamster',
  'mhata', 'mudhidhi', 'mboro', 'dako', 'garo', 'hure', 'mai vako',
  'mbuya vako', 'brazzer', 'brazzers', 'milf', 'dhodhi', 'duzvi'
];

function normalizeBody(text) {
  return text.toLowerCase()
    .replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e')
    .replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't')
    .replace(/8/g, 'b').replace(/@/g, 'a').replace(/\$/g, 's')
    .replace(/!/g, 'i').replace(/\|/g, 'i').replace(/[-*._+]/g, '');
}

const badWordRegex = new RegExp(badWords.map(w => `\\b${w}\\b`).join('|'), 'i');

const spamTracker = {
  duplicates:    new Map(),
  userHistory:   new Map(),
  globalHistory: [],
  warnings:      new Map(),
};

const commands = new Map();

function loadCommands() {
  const commandDirs = ['cmd', 'tools'];
  const thisFile    = path.basename(__filename);

  for (const dir of commandDirs) {
    const fullDir = path.join(__dirname, dir);
    let files;
    try {
      files = fs.readdirSync(fullDir).filter(f => f.endsWith('.js'));
    } catch (_) {
      continue;
    }

    for (const file of files) {
      if (file === thisFile) continue;
      const filePath = path.join(fullDir, file);
      let cmd;
      try {
        cmd = require(filePath);
      } catch (err) {
        console.log(chalk.gray('  ⧈ ') + chalk.cyan('LOADER') + chalk.gray(' ── ') + chalk.red(`FAILED TO LOAD ${dir}/${file}: ${err.message}`));
        continue;
      }

      if (!cmd || !cmd.name) continue;

      if (commands.has(cmd.name.toLowerCase())) {
        console.log(chalk.gray('  ⧈ ') + chalk.cyan('LOADER') + chalk.gray(' ── ') + chalk.yellowBright(`DUPLICATE COMMAND NAME "${cmd.name}" IN ${dir}/${file} (overwritten)`));
      }

      commands.set(cmd.name.toLowerCase(), cmd);
      if (cmd.aliases && Array.isArray(cmd.aliases)) {
        cmd.aliases.forEach(alias => commands.set(alias.toLowerCase(), cmd));
      }
    }
  }

  console.log(chalk.gray('  ⧈ ') + chalk.cyan('LOADER') + chalk.gray(' ── ') + chalk.green(`${new Set(commands.values()).size} COMMANDS LOADED`));
}

loadCommands();

setInterval(() => {
  const now = Date.now();
  const globalWindow = config.spam.globalWindow * 1000;
  spamTracker.globalHistory = spamTracker.globalHistory.filter(t => now - t < globalWindow);
  for (const [key, ts] of spamTracker.duplicates) {
    if (now - ts > config.spam.duplicateCooldown * 1000) spamTracker.duplicates.delete(key);
  }
  for (const [key, ts] of socialSeen) {
    if (now - ts > 60000) socialSeen.delete(key);
  }
  for (const [user, history] of spamTracker.userHistory) {
    const active = history.filter(t => now - t < config.spam.perUserWindow * 1000);
    if (active.length) spamTracker.userHistory.set(user, active);
    else spamTracker.userHistory.delete(user);
  }
  for (const [user, data] of spamTracker.warnings) {
    const strikesDecayMs = config.spam.perUserWindow * 1000 * 6; // decay unused strikes after ~6 windows
    if ((data.mutedUntil && now > data.mutedUntil) || (data.updatedAt && now - data.updatedAt > strikesDecayMs)) {
      spamTracker.warnings.delete(user);
    }
  }
}, 30 * 1000);

function isOwner(jid, pushName) {
  const sender = cleanNumber(jid);
  return config.ownerNumber.map(n => n.replace(/[^0-9]/g, '')).includes(sender) ||
    config.ownerName.some(name => name.toLowerCase() === (pushName || '').toLowerCase());
}

async function participantMatches(sock, participantId, cleanSenderJid) {
  if (!participantId || !cleanSenderJid) return false;
  if (participantId === cleanSenderJid) return true;
  const resolved = await resolvePhoneJid(sock, participantId);
  return cleanNumber(resolved) === cleanNumber(cleanSenderJid);
}

async function isGroupAdmin(sock, jid, participant) {
  try {
    const meta = await sock.groupMetadata(jid);
    const participants = meta.participants || [];
    for (const p of participants) {
      if (p.admin !== 'admin' && p.admin !== 'superadmin') continue;
      if (await participantMatches(sock, p.id, participant)) return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}

async function isBotAdmin(sock, jid) {
  try {
    const meta = await sock.groupMetadata(jid);
    const participants = meta.participants || [];
    const botJid = sock.user?.id;
    if (!botJid) return false;
    const botNumber = cleanNumber(botJid);
    for (const p of participants) {
      if (p.admin !== 'admin' && p.admin !== 'superadmin') continue;
      if (cleanNumber(p.id) === botNumber) return true;
      if (p.id.endsWith('@lid')) {
        const resolved = await resolvePhoneJid(sock, p.id);
        if (cleanNumber(resolved) === botNumber) return true;
      }
    }
    return false;
  } catch (_) {
    return false;
  }
}

// ── (relayDataReply removed) ────────────────────────────────────────────────
// The old single-shot dispatch needed a separate "relay" call to phrase tool
// results in JB's voice, since the brain only ever got one shot per turn.
// The agentic tool loop in brain/ai.js now handles this natively — the model
// sees tool results directly in its own reasoning loop and produces the
// final phrased reply itself, with the same C→A→B fallback waterfall already
// applied to every step. One text-generation path instead of two.

// ── Auto-shazam (audio/video → brain → auto-download) ──────────────────────────
// Triggered when a bare audio clip OR video lands in a DM with no command/caption.
// Identifies the song, hands the brain a synthetic note so it can react in
// character ("yo i heard X by Y, hold on i gatchu"), then downloads and sends
// the track automatically — no follow-up command needed from the user.
const AUTO_SHAZAM_BRAIN_TIMEOUT = 20000;

/**
 * Voice-note → text → brain. Returns true when STT did NOT handle it (so the
 * caller should fall back to auto-shazam), false when a speech transcript was
 * processed and replied to.
 */
async function handleVoiceSTT(sock, msg, { from, sender, pushName, commands }) {
  try {
    const audioMessage = normalizeMessageContent(msg.message)?.audioMessage;
    if (!audioMessage?.ptt) return true;              // music clip, not a voice note
    if (!config.stt?.enabled) return true;

    const buf = await downloadMediaMessage(
      msg, 'buffer', {},
      { logger: undefined, reuploadRequest: sock.updateMediaMessage }
    );
    if (!buf?.length) return true;

    const text = await stt.transcribe(buf, audioMessage.mimetype);
    if (!text) return true;                           // music / failure → shazam path

    // Speech heuristic — a music transcription comes back as short symbol
    // noise or a tiny token count; real speech has words and letters.
    const letters = (text.match(/[a-zA-Z]/g) || []).length;
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    if (words < 3 || letters / Math.max(text.length, 1) < 0.55) return true;

    console.log(chalk.gray('  ⧈ ') + chalk.yellow('VOICE') + chalk.gray(' ── ') + chalk.white(senderNum) + chalk.gray(' heard: ') + chalk.white(JSON.stringify(text.slice(0, 80))));

    await sock.sendPresenceUpdate('composing', from).catch(() => {});
    await sock.sendMessage(from, { text: `🦻 heard it — "${text.slice(0, 200)}"`, __skipStyle: true }, { quoted: msg }).catch(() => {});

    const brainExtra = {
      from, sender, pushName,
      getCommands: () => commands,
      reply: async (replyText, extraContent = {}) => {
        await sock.sendMessage(from, { text: String(replyText), ...extraContent }, { quoted: msg, __skipStyle: true });
      },
      react: async () => {},
    };

    const result = await brain.think(
      from, `[Voice note transcribed by the user: "${text}"]\n${text}`,
      { pushName, sender, sock, msg, commands, brainExtra }
    );
    if (result?.remember) userProfiles.save(from, result.remember);
    if (result?.reply) {
      const voiceSent =
        !from.endsWith('@g.us') && tts.tick(from) &&
        await tts.sendVoiceReply(sock, from, result.reply);
      if (!voiceSent) {
        await sock.sendMessage(from, { text: result.reply, __skipStyle: true }, { quoted: msg }).catch(() => {});
      }
    }
    await sock.sendPresenceUpdate('paused', from).catch(() => {});
    return false;
  } catch (err) {
    console.error(chalk.red('[VOICE-STT] error:'), err.message);
    return true;
  }
}

async function handleAutoShazam(sock, msg, { from, sender, pushName, commands, mediaType }) {
  const senderNum = sender?.split('@')[0] || '?';
  const tag = mediaType === 'video' ? 'video' : 'audio';
  const findCmd = commands.get('find');
  if (!findCmd) return;

  const q = quota.getQuota(sender);
  if (!q.allowed) {
    console.log(chalk.gray('  ⧈ ') + chalk.cyan('AUTO-SHAZAM') + chalk.gray(` [${tag}]`) + chalk.gray(' ── ') + chalk.white(senderNum) + chalk.yellow(` quota ${q.used}/${q.total}`));
    return;
  }

  const shazamExtra = {
    from, sender, pushName,
    getCommands: () => commands,
    reply: async (text, extraContent) => {
      await sock.sendMessage(from, { text: String(text), ...(extraContent || {}) }, { quoted: msg, __skipStyle: true });
    },
    react: async (emoji) => {
      try { await sock.sendMessage(from, { react: { text: emoji, key: msg.key } }); } catch (_) {}
    },
  };

  try {
    await shazamExtra.react('🔎');

    const mediaBuffer = await downloadMediaMessage(
      msg, 'buffer', {},
      { logger: undefined, reuploadRequest: sock.updateMediaMessage }
    );
    if (!mediaBuffer?.length) throw new Error(`could not download ${tag}`);

    const song = await findCmd.identifySong(mediaBuffer);

    let note;
    if (!song) {
      console.log(chalk.gray('  ⧈ ') + chalk.cyan('AUTO-SHAZAM') + chalk.gray(` [${tag}]`) + chalk.gray(' ── ') + chalk.white(senderNum) + chalk.yellow(' no match'));
      note = `[SHAZAM] The user just sent a ${tag} clip but it could NOT be identified. Tell them you couldn't place it and to try sending a clearer/longer clip. Don't trigger any action.`;
      await shazamExtra.react('❌');
    } else {
      const title   = song.title || 'Unknown';
      const artists = song.artists?.map(a => a.name).join(', ') || 'Unknown';
      console.log(chalk.gray('  ⧈ ') + chalk.cyan('AUTO-SHAZAM') + chalk.gray(` [${tag}]`) + chalk.gray(' ── ') + chalk.white(senderNum) + chalk.green(` heard: ${title} by ${artists}`));
      // Persist this permanently so "the song"/"that track" resolves correctly
      // later in the chat, even after normal history gets summarized away.
      memory.addSong(from, `${title} by ${artists}`);
      note = `[SHAZAM] USER: sent a ${tag} clip containing "${title}" by ${artists}. Tell them what you heard in your own words (e.g. "yo i heard ${title} by ${artists}, hold on i gatchu") then say you're sending it now. Keep it short. Do NOT return a JSON action — the track is already being sent for you.`;

      // Fire the brain reply and the YouTube resolve in parallel — both are independent.
      const brainPromise = Promise.race([
        brain.think(from, note, { pushName }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('brain timeout')), AUTO_SHAZAM_BRAIN_TIMEOUT)),
      ]).catch(err => {
        console.error(chalk.red('[AUTO-SHAZAM BRAIN]'), err.message);
        return { type: 'text', reply: `yo i heard ${title} by ${artists}, hold on i gatchu` };
      });

      const query = `${title} ${artists}`.trim();
      const { url: ytUrl, thumbnail } = await findCmd.resolveYoutubeMatch(query);

      const result = await brainPromise;
      if (result?.reply) await shazamExtra.reply(result.reply);

      await shazamExtra.react('🎵');
      const sent = await findCmd.sendIdentifiedAudio(sock, msg, shazamExtra, { title, artists, ytUrl, thumbnail });
      if (sent) {
        const q2 = quota.useQuota(sender);
        await shazamExtra.react('✅');
        // sendIdentifiedAudio already retries internally on flaky sources —
        // record the outcome so future turns know this request was fulfilled.
        memory.add(from, 'assistant', `[sent the audio file for "${title}" by ${artists}]`);
      } else {
        const failMsg = `couldn't grab the file for ${title} though, source is acting up — try again in ${config.spam.duplicateCooldown}s`;
        await shazamExtra.reply(failMsg);
        await shazamExtra.react('❌');
        // Record the failure in memory (this used to be invisible to the
        // brain — it would think the download succeeded and get confused
        // when asked about it later, sometimes leaking raw tool syntax
        // while trying to retry blindly).
        memory.add(from, 'assistant', failMsg);
      }
      return;
    }

    // No-match path — just relay the brain's reaction, no download to attempt.
    const result = await Promise.race([
      brain.think(from, note, { pushName }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('brain timeout')), AUTO_SHAZAM_BRAIN_TIMEOUT)),
    ]).catch(() => ({ type: 'text', reply: "couldn't catch that one, send a clearer clip?" }));

    if (result?.reply) await shazamExtra.reply(result.reply);

  } catch (err) {
    console.error(chalk.red('[AUTO-SHAZAM]'), err.message);
    await shazamExtra.reply(`something broke trying to catch that ${tag}, try again in ${config.spam.duplicateCooldown}s`).catch(() => {});
    await shazamExtra.react('❌').catch(() => {});
  }
}

// ── Social link auto-download (Owner-only) ──────────────────────────────────
// Facebook / Instagram / TikTok / Pinterest links pasted in chat are detected
// here (no prefix needed). Media comes from the vendored Python backend on
// 127.0.0.1:8000 (yt-dlp + its own fallbacks), gracefully degrading to the
// Node backend's yt-dlp download if :8000 is down.
const socialSeen = new Map(); // URL → timestamp (dedupe window)

async function handleSocialDownload(sock, msg, { from, url }) {
  console.log(chalk.gray('  ⧈ ') + chalk.cyan('SOCIAL') + chalk.gray(' ── ') + chalk.white(url.slice(0, 60)));

  try {
    await sock.sendPresenceUpdate('composing', from).catch(() => {});
    await sock.sendMessage(from, { react: { text: '📥', key: msg.key } }).catch(() => {});

    const manifest = await apiTools.getBackendSocialManifest(url);

    await sock.sendPresenceUpdate('paused', from).catch(() => {});

    if (!manifest || !manifest.items || !manifest.items.length) {
      await sock.sendMessage(from, { text: '❌ Could not grab media from that link — it may be private or unsupported. Try later.' }, { quoted: msg });
      return;
    }

    const items = manifest.items.slice(0, 10);
    const caption = `*DOWNLOADED BY ${(config.botName || 'JB').toUpperCase()}*`;
    let sent = 0;

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      try {
        let buffer = it.buffer;
        let mimetype = it.mimetype || (it.type === 'video' ? 'video/mp4' : 'image/jpeg');
        if (!buffer) {
          const fetched = await apiTools.fetchSocialItem(it.url);
          if (!fetched.buffer.length) continue;
          buffer = fetched.buffer;
          mimetype = fetched.mimetype || mimetype;
        }

        if (it.type === 'video') {
          await sock.sendMessage(from, { video: buffer, mimetype: 'video/mp4', caption }, { quoted: msg });
        } else {
          await sock.sendMessage(from, { image: buffer, caption }, { quoted: msg });
        }
        sent++;
      } catch (itemErr) {
        console.error(chalk.red('[SOCIAL item]'), itemErr.message);
      }
      if (i < items.length - 1) await new Promise((r) => setTimeout(r, 800));
    }

    await sock.sendMessage(from, { react: { text: sent ? '✅' : '❌', key: msg.key } }).catch(() => {});
    if (!sent) {
      await sock.sendMessage(from, { text: '❌ Found media but failed to send it. Try again in a bit.' }, { quoted: msg });
    }
  } catch (err) {
    console.error(chalk.red('[SOCIAL]'), err.message);
    await sock.sendMessage(from, { text: '❌ That link failed to download — try again in a minute.' }, { quoted: msg }).catch(() => {});
  }
}

// ── Interactive button taps (native flow + clients that deliver label-only) ──
// A .find identify card sends quick_reply buttons carrying callbacks like
// `finddl:<query>`. Taps arrive as nativeFlowResponseMessage (paramsJson with
// id/display_text) or, on some clients, templateButtonReplyMessage /
// buttonsResponseMessage — which may only include the display label. In that
// case we match the label and pull the query from buttonContext.

const BUTTON_LABEL_PREFIXES = {
  '⬇ DOWNLOAD SONG': 'finddl:',
  '🎬 FETCH VIDEO':   'viddl:',
  '📸 FETCH PHOTOS':  'imgdl:',
};

function extractButtonTap(msg, body, from) {
  const raw = msg.message || {};
  const nativeFlow = raw.interactiveResponseMessage?.nativeFlowResponseMessage;
  const templateReply = raw.templateButtonReplyMessage;
  const buttonsReply = raw.buttonsResponseMessage;
  const motionTap = raw.interactiveResponseMessage?.motionResponseMessage;
  const hasTapShape = !!(nativeFlow || templateReply || buttonsReply || motionTap);

  let tapId = '';
  let tapLabel = '';
  if (nativeFlow?.paramsJson) {
    try {
      const p = JSON.parse(nativeFlow.paramsJson);
      tapId = typeof p.id === 'string' ? p.id : '';
      tapLabel = typeof p.display_text === 'string' ? p.display_text : '';
    } catch (_) {}
  }
  if (!tapId) tapId = templateReply?.selectedId || templateReply?.id || '';
  if (!tapId) tapId = buttonsReply?.selectedButtonId || buttonsReply?.selectedId || '';
  if (!tapId && motionTap?.id) tapId = motionTap.id;
  tapLabel = tapLabel || templateReply?.selectedDisplayText || buttonsReply?.selectedDisplayText || '';

  if (!tapId && hasTapShape) {
    const prefix = BUTTON_LABEL_PREFIXES[tapLabel || body];
    if (prefix) {
      const ctx = buttonContext.get(from);
      tapId = prefix + encodeURIComponent(ctx?.videoQuery || '');
    }
  }

  if (!tapId && hasTapShape) {
    const rawShape = nativeFlow || templateReply || buttonsReply || motionTap || {};
    console.log(chalk.gray('  ⧈ ') + chalk.cyan('BUTTON') + chalk.gray(' ── ') + chalk.red('UNHANDLED TAP ') + chalk.gray(JSON.stringify(rawShape).slice(0, 160)));
    return { id: '' };
  }

  return tapId ? { id: tapId, label: tapLabel, hasTapShape } : null;
}

function makeTapExtra(sock, from, sender, msg) {
  return {
    from,
    sender,
    pushName: '',
    react: async (emoji) => {
      try {
        await sock.sendMessage(from, { react: { text: emoji, key: msg?.key } });
      } catch (_) {}
    },
  };
}

async function handleFindDownloadTap(sock, msg, from, sender, senderNum, tapId) {
  const query = decodeURIComponent(tapId.slice('finddl:'.length));
  console.log(chalk.gray('  ⧈ ') + chalk.cyan('BUTTON') + chalk.gray(' ── ') + chalk.white(senderNum) + chalk.yellow(' FIND-DL ') + chalk.white(query));
  try {
    const songCmd = commands.get('song');
    if (!songCmd) return;
    await songCmd.execute(sock, msg, [query], makeTapExtra(sock, from, sender, msg));
  } catch (err) {
    console.error('[BUTTON] song tap failed:', err?.message || err);
    await sock.sendMessage(from, { text: '❌ Button download failed. Try `.song ' + query + '` directly.' }, { quoted: msg }).catch(() => {});
  }
}

async function handleFindVideoTap(sock, msg, from, sender, senderNum, tapId) {
  const query = decodeURIComponent(tapId.slice('viddl:'.length));
  console.log(chalk.gray('  ⧈ ') + chalk.cyan('BUTTON') + chalk.gray(' ── ') + chalk.white(senderNum) + chalk.yellow(' FIND-VID ') + chalk.white(query));
  try {
    const videoCmd = commands.get('ytvideo');
    if (!videoCmd) return;
    await videoCmd.execute(sock, msg, [query], makeTapExtra(sock, from, sender, msg));
  } catch (err) {
    console.error('[BUTTON] video tap failed:', err?.message || err);
    await sock.sendMessage(from, { text: '❌ Button video fetch failed. Try `.video ' + query + '` directly.' }, { quoted: msg }).catch(() => {});
  }
}

async function handleFindImageTap(sock, msg, from, sender, senderNum, tapId) {
  const query = decodeURIComponent(tapId.slice('imgdl:'.length));
  console.log(chalk.gray('  ⧈ ') + chalk.cyan('BUTTON') + chalk.gray(' ── ') + chalk.white(senderNum) + chalk.yellow(' FIND-IMG ') + chalk.white(query));
  try {
    await sock.sendPresenceUpdate('composing', from).catch(() => {});
    const urls = await apiTools.searchBackendImages(query, 4);
    await sock.sendPresenceUpdate('paused', from).catch(() => {});

    if (!urls.length) {
      await sock.sendMessage(from, { text: '📸 No photos found for that artist.' }, { quoted: msg });
      return;
    }

    let sent = 0;
    for (const url of urls) {
      try {
        const { buffer, mimetype } = await apiTools.fetchSocialItem(url);
        if (!buffer?.length) continue;
        await sock.sendMessage(from, {
          image: buffer,
          mimetype: mimetype || 'image/jpeg',
          caption: `*${query.toUpperCase()}* — JAILBREAK-SR`,
        }, { quoted: msg });
        sent++;
      } catch (itemErr) {
        console.error('[BUTTON img item]', itemErr?.message || itemErr);
      }
      if (sent < 4) await new Promise((r) => setTimeout(r, 700));
    }

    if (!sent) {
      await sock.sendMessage(from, { text: '❌ Found photos but failed to send them. Try `.img ' + query + '` directly.' }, { quoted: msg });
    }
  } catch (err) {
    console.error('[BUTTON] image tap failed:', err?.message || err);
    await sock.sendMessage(from, { text: '❌ Artist photos failed. Try again later.' }, { quoted: msg }).catch(() => {});
  }
}

// ── Main message handler ──────────────────────────────────────────────────────

async function handleMessage(sock, msg) {
  const from = msg.key?.remoteJid;
  let sender = msg.key?.fromMe
    ? (getOwnPhoneJid(sock) || msg.key.participant || from)
    : (msg.key.participant || from);
  const senderNum = sender?.split('@')[0] || '?';

  try {
    songRecommend.clear(sender);

    // ── Bot-wide ban gate (owner always passes) ───────────────────────────
    const banNumber = cleanNumber(senderNum);
    if (config.ownerNumber && !config.ownerNumber.includes(banNumber) && blacklist.isBanned(banNumber)) {
      console.log(chalk.gray('  ⧈ ') + chalk.cyan('BAN') + chalk.gray(' ── ') + chalk.white(banNumber) + chalk.red(' BLOCKED'));
      return;
    }

    // ── Birthday wishes — fires once per day for anyone celebrating today ──
    try { celebrate.maybeCelebrate(sock).catch(() => {}); } catch (_) {}

    // ── XP: human messages earn activity points (rate-limited 1/min) ──────
    if (!msg.key?.fromMe && config.xp?.enabled) {
      try { xpTools.bump(banNumber || cleanNumber(sender), pushName); } catch (_) {}
    }

    if (!from || !msg.message) { console.log(chalk.gray('  ⧈ ') + chalk.cyan('HANDLER') + chalk.gray(' ── ') + chalk.white(senderNum) + chalk.red(' NO MSG')); return; }

    const messageType = Object.keys(msg.message).find(k => k !== 'messageContextInfo');
    if (!messageType) { console.log(chalk.gray('  ⧈ ') + chalk.cyan('HANDLER') + chalk.gray(' ── ') + chalk.white(senderNum) + chalk.red(' NO TYPE')); return; }

    const normalizedMsg = normalizeMessageContent(msg.message);
    const body = normalizedMsg?.conversation ||
      normalizedMsg?.extendedTextMessage?.text ||
      normalizedMsg?.imageMessage?.caption ||
      normalizedMsg?.videoMessage?.caption ||
      normalizedMsg?.documentMessage?.caption ||
      '';

    const pushName = msg.pushName || '';

    // ── Interactive button taps (from .find cards) ─────────────────────────
    const tap = extractButtonTap(msg, body, from);
    if (tap) {
      if (!tap.id) return; // observed a tap shape but couldn't resolve it
      console.log(chalk.gray('  ⧈ ') + chalk.cyan('TAP') + chalk.gray(' ── ') + chalk.gray(' ') + chalk.yellowBright(tap.id.slice(0, 40)));
      if (tap.id.startsWith('finddl:')) { await handleFindDownloadTap(sock, msg, from, sender, senderNum, tap.id); return; }
      if (tap.id.startsWith('viddl:'))  { await handleFindVideoTap(sock, msg, from, sender, senderNum, tap.id); return; }
      if (tap.id.startsWith('imgdl:'))  { await handleFindImageTap(sock, msg, from, sender, senderNum, tap.id); return; }
      console.log(chalk.gray('  ⧈ ') + chalk.cyan('TAP') + chalk.gray(' ── ') + chalk.white(senderNum) + chalk.red(' UNHANDLED ') + chalk.gray(tap.id.slice(0, 40)));
      return;
    }

    if (!body.startsWith(config.prefix)) {
      // ── Auto-shazam: bare video OR audio in a DM → identify, brain reacts, auto-send ─
      const isDM = !from.endsWith('@g.us');
      const isVideoMessage = !!(normalizedMsg?.videoMessage);
      const isAudioMessage = !!(normalizedMsg?.audioMessage);

      if (isDM && isAudioMessage && !body.trim()) {
        console.log(chalk.gray('  ⧈ ') + chalk.cyan('AUTO-SHAZAM') + chalk.gray(' [audio→brain]') + chalk.gray(' ── ') + chalk.white(senderNum));
        // ptt voice notes → try speech-to-text first, fall back to music detection
        const notHandled = await handleVoiceSTT(sock, msg, { from, sender, pushName, commands });
        if (notHandled) {
          await handleAutoShazam(sock, msg, { from, sender, pushName, commands, mediaType: 'audio' });
        }
        return;
      }

      if (isDM && isVideoMessage && !body.trim()) {
        console.log(chalk.gray('  ⧈ ') + chalk.cyan('AUTO-SHAZAM') + chalk.gray(' [video→brain]') + chalk.gray(' ── ') + chalk.white(senderNum));
        await handleAutoShazam(sock, msg, { from, sender, pushName, commands, mediaType: 'video' });
        return;
      }

      // ── AI Vision: handle messages containing images ─────────────────────
      const imageMessage = normalizedMsg?.imageMessage;
      if (imageMessage) {
        const aiAccessImg = config.ai?.access || 'all';
        if (aiAccessImg === 'owner' && !isOwner(sender, pushName)) {
          console.log(chalk.gray('  ⧈ ') + chalk.cyan('VISION') + chalk.gray(' ── ') + chalk.white(senderNum) + chalk.red(' AI ACCESS DENIED'));
          return;
        }

        if (from.endsWith('@g.us')) {
          const gSettings = database.getGroupSettings(from);
          if (!gSettings.aiEnabled) return;
        }

        const VISION_MIN_REPLY_DELAY = 4000;
        let _lastVisionReply = 0;
        const visionReply = async (text, extraContent) => {
          const elapsed = Date.now() - _lastVisionReply;
          if (elapsed < VISION_MIN_REPLY_DELAY) {
            await new Promise(resolve => setTimeout(resolve, VISION_MIN_REPLY_DELAY - elapsed));
          }
          _lastVisionReply = Date.now();
          await sock.sendMessage(from, { text: String(text), ...(extraContent || {}) }, { quoted: msg, __skipStyle: true });
        };

        console.log(chalk.gray('  ⧈ ') + chalk.green('VISION') + chalk.gray(' ── ') + chalk.white(senderNum) + chalk.gray(' looking: ') + chalk.white(JSON.stringify(body.slice(0, 60))));

        try {
          await sock.sendPresenceUpdate('composing', from).catch(() => {});

          const mediaBuffer = await downloadMediaMessage(
            msg, 'buffer', {},
            { logger: undefined, reuploadRequest: sock.updateMediaMessage }
          );
          if (!mediaBuffer?.length) throw new Error('could not download image');

          const VISION_TIMEOUT = 40000;
          const result = await Promise.race([
            visionBrain.see(
              from, body,
              [{ mimetype: imageMessage.mimetype, base64: mediaBuffer.toString('base64') }],
              { pushName, sender }
            ),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('vision timeout')), VISION_TIMEOUT)
            ),
          ]);

          await sock.sendPresenceUpdate('paused', from).catch(() => {});
          if (result?.reply) {
            const voiceSent =
              !from.endsWith('@g.us') && tts.tick(from) &&
              await tts.sendVoiceReply(sock, from, result.reply);
            if (!voiceSent) await visionReply(result.reply);
          }

        } catch (visionErr) {
          await sock.sendPresenceUpdate('paused', from).catch(() => {});
          if (visionErr.message === 'vision timeout') {
            console.error(chalk.red('[VISION TIMEOUT]'), from);
            await visionReply(`took too long looking at that, try again in ${config.spam.duplicateCooldown}s`).catch(() => {});
          } else {
            console.error(chalk.red('[VISION ERROR]'), visionErr.message);
            await visionReply(`something broke looking at that, try again in ${config.spam.duplicateCooldown}s`).catch(() => {});
          }
        }
        return;
      }
      // ── End AI Vision ────────────────────────────────────────────────────

      // ── Social link auto-download (FB/IG/TikTok/Pinterest, owner-only) ──
      const social = apiTools.detectSocialUrl(body);
      if (social) {
        if (!isOwner(sender, pushName)) {
          console.log(chalk.gray('  ⧈ ') + chalk.cyan('SOCIAL') + chalk.gray(' ── ') + chalk.white(senderNum) + chalk.red(' OWNER ONLY DENIED'));
          await sock.sendMessage(from, { text: config.messages?.ownerOnly || 'You are not allowed to use this.' }, { quoted: msg }).catch(() => {});
          return;
        }
        const now = Date.now();
        const last = socialSeen.get(social.url) || 0;
        if (now - last < 60000) {
          console.log(chalk.gray('  ⧈ ') + chalk.cyan('SOCIAL') + chalk.gray(' ── ') + chalk.yellow(' dedupe skip'));
          return;
        }
        socialSeen.set(social.url, now);
        await handleSocialDownload(sock, msg, { from, url: social.url });
        return;
      }

      // ── AI Brain: handle natural-language messages ──────────────────────
      if (!body.trim()) {
        console.log(chalk.gray('  ⧈ ') + chalk.cyan('BRAIN') + chalk.gray(' ── ') + chalk.white(senderNum) + chalk.red(' NO BODY'));
        return;
      }

      const aiAccess = config.ai?.access || 'all';
      if (aiAccess === 'owner' && !isOwner(sender, pushName)) {
        console.log(chalk.gray('  ⧈ ') + chalk.cyan('BRAIN') + chalk.gray(' ── ') + chalk.white(senderNum) + chalk.red(' AI ACCESS DENIED'));
        return;
      }

      if (from.endsWith('@g.us')) {
        const gSettings = database.getGroupSettings(from);
        if (!gSettings.aiEnabled) return;
      }

      // Track last-seen for the autonomous check-in feature.
      // Init the scheduler lazily on the first DM so we always have a live sock.
      if (!from.endsWith('@g.us')) {
        checkIn.updateLastSeen(from, pushName);
        if (!checkIn.isInitialized()) checkIn.init(sock, config, commands);
        songRecommend.setSock(sock);
      }

      const AI_MIN_REPLY_DELAY = 4000;
      let _lastAiReply = 0;
      const brainExtra = {
        from, sender, pushName,
        getCommands: () => commands,
        reply: async (text, extraContent) => {
          const elapsed = Date.now() - _lastAiReply;
          if (elapsed < AI_MIN_REPLY_DELAY) {
            await new Promise(resolve => setTimeout(resolve, AI_MIN_REPLY_DELAY - elapsed));
          }
          _lastAiReply = Date.now();
          await sock.sendMessage(from, { text: String(text), ...(extraContent || {}) }, { quoted: msg, __skipStyle: true });
        },
        react: async (emoji) => {
          try { await sock.sendMessage(from, { react: { text: emoji, key: msg.key } }); } catch (_) {}
        },
      };

      let userInput = body;
      const quotedText =
        normalizedMsg?.extendedTextMessage?.contextInfo?.quotedMessage?.conversation ||
        normalizedMsg?.extendedTextMessage?.contextInfo?.quotedMessage?.extendedTextMessage?.text ||
        normalizedMsg?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage?.caption ||
        normalizedMsg?.extendedTextMessage?.contextInfo?.quotedMessage?.videoMessage?.caption ||
        null;
      if (quotedText) {
        const quotedParticipant = normalizedMsg?.extendedTextMessage?.contextInfo?.participant;
        let quotedLabel = 'someone';
        if (quotedParticipant) {
          const ownJid = getOwnPhoneJid(sock);
          if (ownJid && cleanNumber(quotedParticipant) === cleanNumber(ownJid)) {
            quotedLabel = 'JB';
          } else if (cleanNumber(quotedParticipant) === cleanNumber(sender)) {
            quotedLabel = pushName || 'you';
          } else {
            quotedLabel = cleanNumber(quotedParticipant);
          }
        }
        userInput = `[quoting ${quotedLabel}: "${quotedText.slice(0, 120)}"]\n${body}`;
      }

      // ── Sign-in hint: if this DM's first message in a while, let brain know ──
      if (!from.endsWith('@g.us')) {
        const lastActive = checkIn.getLastSeen(from);
        const gap = lastActive ? Date.now() - lastActive : 0;
        if (gap > 60 * 60 * 1000) {
          const mins = Math.round(gap / 60000);
          const label = mins >= 120 ? `${Math.round(mins / 60)}h` : `${mins}m`;
          userInput = `[User signing in — first message in ${label}]\n${userInput}`;
        }
      }

      console.log(chalk.gray('  ⧈ ') + chalk.green('BRAIN') + chalk.gray(' ── ') + chalk.white(senderNum) + chalk.gray(' thinking: ') + chalk.white(JSON.stringify(body.slice(0, 60))));

      // Live reactions while the agentic loop runs tools, so the chat shows
      // progress instead of going silent for several seconds.
      const TOOL_REACT = {
        weather: '🌍', time: '🕐', search: '🔍', songguess: '🎵',
        song: '🎧', video: '🎬', lyrics: '📜', find: '🔎', download_song: '🎧',
      };

      try {
        await sock.sendPresenceUpdate('composing', from).catch(() => {});

        const BRAIN_TIMEOUT = 180000; // ceiling — loop can run tool calls, a waterfall retry, and Firecrawl-scrape rounds on slow nights
        let brainTimer;
        const result = await Promise.race([
          brain.think(from, userInput, {
            pushName,
            sender,
            sock, msg, commands,
            brainExtra,
            onTool: (name) => {
              const emoji = TOOL_REACT[name];
              if (emoji) brainExtra.react(emoji).catch(() => {});
            },
          }),
          new Promise((_, reject) => {
            brainTimer = setTimeout(() => reject(new Error('brain timeout')), BRAIN_TIMEOUT);
          }),
        ]).finally(() => clearTimeout(brainTimer));

        await sock.sendPresenceUpdate('paused', from).catch(() => {});

        // Persist any facts the brain chose to remember about this user
        if (result.remember) {
          userProfiles.save(from, result.remember);
        }

        if (result.reply) {
          const voiceSent =
            !from.endsWith('@g.us') && tts.tick(from) &&
            await tts.sendVoiceReply(sock, from, result.reply);
          if (!voiceSent) await brainExtra.reply(result.reply);
        }

      } catch (brainErr) {
        await sock.sendPresenceUpdate('paused', from).catch(() => {});
        if (brainErr.message === 'brain timeout') {
          console.error(chalk.red('[BRAIN TIMEOUT]'), from);
          if (toolRunner.hasPending(from)) {
            await brainExtra.reply(`it's coming, just taking a sec — check in ${config.spam.duplicateCooldown}s`).catch(() => {});
          } else {
            await brainExtra.reply(`took too long on my end, try again in ${config.spam.duplicateCooldown}s`).catch(() => {});
          }
        } else {
          console.error(chalk.red('[BRAIN ERROR]'), brainErr.message);
          await brainExtra.reply(`something broke on my end, try again in ${config.spam.duplicateCooldown}s`).catch(() => {});
        }
      }

      return;
      // ── End AI Brain ────────────────────────────────────────────────────
    }

    const args        = body.slice(config.prefix.length).trim().split(/ +/);
    const commandName = args.shift()?.toLowerCase();
    if (!commandName) { console.log(chalk.gray('  ⧈ ') + chalk.cyan('HANDLER') + chalk.gray(' ── ') + chalk.white(senderNum) + chalk.red(' EMPTY CMD')); return; }

    const cmd = commands.get(commandName);
    if (!cmd) { console.log(chalk.gray('  ⧈ ') + chalk.cyan('HANDLER') + chalk.gray(' ── ') + chalk.white(senderNum) + chalk.red(' UNKNOWN ') + chalk.gray(commandName)); return; }

    if (sender.endsWith('@lid')) {
      const resolved = await resolvePhoneJid(sock, sender);
      if (resolved !== sender) {
        console.log(chalk.gray('  ⧈ ') + chalk.cyan('LIDMAP') + chalk.gray(' ── ') + chalk.white(senderNum) + chalk.gray(' → ') + chalk.yellowBright(resolved.split('@')[0]));
        sender = resolved;
      }
    }

    const isGroup     = from.endsWith('@g.us');
    const isOwnerUser = isOwner(sender, pushName);

    if (isGroup) {
      const allowedCommands = database.getAllowedCommandsForGroup(from);
      const isSudoCommand   = commandName === 'sudo' || commandName === 'sallow';
      const isSudoAllowed   = allowedCommands.includes('*') || allowedCommands.includes(commandName);
      if (isSudoCommand) {
        if (!isOwnerUser) { console.log(chalk.gray('  ⧈ ') + chalk.cyan('SUDO') + chalk.gray(' ── ') + chalk.white(senderNum) + chalk.red(' DENIED')); return; }
      } else if (!isSudoAllowed) {
        console.log(chalk.gray('  ⧈ ') + chalk.cyan('PERM') + chalk.gray(' ── ') + chalk.white(senderNum) + chalk.red(' NOT ALLOWED ') + chalk.gray(commandName));
        return;
      }
      if (cmd.ownerOnly && !isOwnerUser) {
        console.log(chalk.gray('  ⧈ ') + chalk.cyan('OWNER') + chalk.gray(' ── ') + chalk.white(senderNum) + chalk.red(' DENIED ') + chalk.gray(commandName));
        return sock.sendMessage(from, { text: config.messages.ownerOnly }, { quoted: msg });
      }
      if (cmd.botAdminNeeded) {
        const botIsAdmin = await isBotAdmin(sock, from);
        if (!botIsAdmin) {
          console.log(chalk.gray('  ⧈ ') + chalk.cyan('ADMIN') + chalk.gray(' ── ') + chalk.white(senderNum) + chalk.red(' BOT NOT ADMIN'));
          return sock.sendMessage(from, { text: config.messages.botAdminNeeded }, { quoted: msg });
        }
      }
      if (cmd.adminOnly && !isOwnerUser) {
        const senderIsAdmin = await isGroupAdmin(sock, from, sender);
        if (!senderIsAdmin) {
          console.log(chalk.gray('  ⧈ ') + chalk.cyan('ADMIN') + chalk.gray(' ── ') + chalk.white(senderNum) + chalk.red(' NOT GROUP ADMIN'));
          return sock.sendMessage(from, { text: '⫎ONLY GROUP ADMINS CAN USE THIS COMMAND 🚫⧯' }, { quoted: msg });
        }
      }
    } else {
      if (!isOwnerUser) { console.log(chalk.gray('  ⧈ ') + chalk.cyan('PERM') + chalk.gray(' ── ') + chalk.white(senderNum) + chalk.red(' DM BLOCKED (not owner)')); return; }
    }

    const extra = {
      from, sender, pushName,
      getCommands: () => commands,
      reply: async (text, extraContent) => {
        await sock.sendMessage(from, { text: String(text), ...(extraContent || {}) }, { quoted: msg });
      },
      react: async (emoji) => {
        try {
          await sock.sendMessage(from, { react: { text: emoji, key: msg.key } });
        } catch (_) {}
      },
    };

    if (isGroup && !isOwnerUser) {
      const gSettings = database.getGroupSettings(from);
      if (gSettings.antiword && badWordRegex.test(normalizeBody(body))) {
        return extra.reply(
          `⫎@${sender.split('@')[0]} - COMMAND BLOCKED 🚫⧯\n\n` +
          `Your message contains a word this group doesn't allow in commands. ` +
          `Remove it and resend your command - admins can adjust the word list with *.antiword*.`,
          { mentions: [sender] }
        );
      }

      if (gSettings.antispam) {
        const now     = Date.now();
        const cmdKey  = `${sender}:${commandName}:${args.join(' ')}`;
        const windowMin = Math.round(config.spam.perUserWindow / 60);

        const warnData = spamTracker.warnings.get(sender);
        if (warnData && warnData.mutedUntil && now < warnData.mutedUntil) {
          const remainingSec   = Math.ceil((warnData.mutedUntil - now) / 1000);
          const remainingLabel = remainingSec >= 60 ? `${Math.ceil(remainingSec / 60)} min` : `${remainingSec}s`;
          return extra.reply(
            `⫎@${sender.split('@')[0]} - YOU ARE MUTED ⏳⧯\n\n` +
            `You went over the command limit too many times, so I'm ignoring your commands for ${remainingLabel} more. ` +
            `No need to keep sending commands - they just won't run until the mute ends.`,
            { mentions: [sender] }
          );
        }

        const lastTime = spamTracker.duplicates.get(cmdKey);
        if (lastTime && (now - lastTime) < config.spam.duplicateCooldown * 1000) {
          const secondsLeft = Math.ceil((config.spam.duplicateCooldown * 1000 - (now - lastTime)) / 1000);
          return extra.reply(
            `⫎@${sender.split('@')[0]} - SLOOWWWW DOWN 💀⧯\n\n` +
            `You just sent *.${commandName}* with the exact same details. ` +
            `To stop accidental double-sends, I block an identical command for ${config.spam.duplicateCooldown}s. ` +
            `Wait about ${secondsLeft}s, then try again.`,
            { mentions: [sender] }
          );
        }

        const userTimes  = spamTracker.userHistory.get(sender) || [];
        const recentUser = userTimes.filter(t => now - t < config.spam.perUserWindow * 1000);
        if (recentUser.length >= config.spam.perUserLimit) {
          const warnings = spamTracker.warnings.get(sender) || { count: 0, mutedUntil: 0 };
          warnings.count += 1;
          warnings.updatedAt = now;
          if (warnings.count >= config.spam.maxWarnings) {
            warnings.mutedUntil = now + 5 * 60 * 1000;
            spamTracker.warnings.set(sender, warnings);
            return extra.reply(
              `⫎🚫 @${sender.split('@')[0]} - MUTED (${warnings.count}/${config.spam.maxWarnings} STRIKES) ⏳⧯\n\n` +
              `You kept going over the ${config.spam.perUserLimit}-commands-per-${windowMin}min limit even after ${config.spam.maxWarnings - 1} warning(s). ` +
              `I'll ignore your commands for 5 minutes - this protects the group from flooding, it's nothing personal.`,
              { mentions: [sender] }
            );
          }
          warnings.updatedAt = now;
          spamTracker.warnings.set(sender, warnings);
          return extra.reply(
            `⫎🐢 @${sender.split('@')[0]} - SLOW DOWN! WARNING ${warnings.count}/${config.spam.maxWarnings} ⏳⧯\n\n` +
            `This group allows max ${config.spam.perUserLimit} commands per ${windowMin} min, and you just went over that. ` +
            `Hit ${config.spam.maxWarnings} warnings and you'll be muted for 5 minutes. Just space your commands out a bit.`,
            { mentions: [sender] }
          );
        }

        spamTracker.duplicates.set(cmdKey, now);
        spamTracker.userHistory.set(sender, [...recentUser, now]);
        spamTracker.globalHistory.push(now);

        const recentGlobal = spamTracker.globalHistory.filter(t => now - t < config.spam.globalWindow * 1000);
        if (recentGlobal.length > config.spam.globalLimit) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }

    console.log(chalk.gray('  ⧈ ') + chalk.green('EXEC') + chalk.gray(' ── ') + chalk.white(senderNum) + chalk.gray(' ') + chalk.yellowBright(commandName) + chalk.gray(' args=') + chalk.white(JSON.stringify(args)));
    await cmd.execute(sock, msg, args, extra);
    console.log(chalk.gray('  ⧈ ') + chalk.green('DONE') + chalk.gray(' ── ') + chalk.white(senderNum) + chalk.gray(' ') + chalk.yellowBright(commandName));

  } catch (err) {
    console.error(chalk.gray('  ⧈ ') + chalk.red('ERR') + chalk.gray(' ── ') + chalk.white(senderNum) + chalk.red(' ' + err.message));
    try {
      await sock.sendMessage(from, { text: 'that one broke on my end — try again in a sec.' }, { quoted: msg }).catch(() => {});
    } catch (_) {}
  }
}

async function handleAntilink(sock, msg, groupMetadata) {
  try {
    const from = msg.key?.remoteJid;
    if (!from || !from.endsWith('@g.us')) { console.log('[ANTILINK] not group'); return; }

    const linkSender = msg.key.participant || msg.key.remoteJid;
    if (msg.key?.fromMe || isOwner(linkSender, msg.pushName)) {
      console.log('[ANTILINK] owner/fromMe - skipped');
      return;
    }

    const settings = database.getGroupSettings(from);
    if (!settings.antilink) { console.log('[ANTILINK] disabled for group'); return; }

    const normalizedMsg = normalizeMessageContent(msg.message);
    const body = normalizedMsg?.conversation ||
      normalizedMsg?.extendedTextMessage?.text ||
      normalizedMsg?.imageMessage?.caption ||
      normalizedMsg?.videoMessage?.caption ||
      '';
    if (!body) { console.log('[ANTILINK] no body'); return; }

    const linkRegex = /(https?:\/\/)?(www\.)?(([a-z0-9-]+\.)?(chat\.whatsapp\.com|wa\.me|t\.me|telegram\.me|discord\.gg|invite\.discord|bit\.ly|tinyurl\.com|shorturl\.at|rb\.gy|rebrand\.ly|cutt\.ly|ow\.ly|is\.gd|onrender\.com|vercel\.app|herokuapp\.com|netlify\.app)|([a-z0-9-]+\.)+(xyz|tk|ml|cf|ga|gq))(\/\S+)?/gi;
    if (!linkRegex.test(body)) { console.log('[ANTILINK] no link match. body=' + body.slice(0, 60)); return; }

    const sender = linkSender;
    let isGroupAdminFlag = false;
    for (const p of (groupMetadata.participants || [])) {
      if (p.admin !== 'admin' && p.admin !== 'superadmin') continue;
      if (await participantMatches(sock, p.id, sender)) { isGroupAdminFlag = true; break; }
    }
    if (isGroupAdminFlag) { console.log('[ANTILINK] sender is admin'); return; }

    const action = settings.antilinkAction || 'delete';
    console.log('[ANTILINK] executing action=' + action + ' for sender=' + sender);

    if (action === 'delete') {
      await sock.sendMessage(from, { delete: msg.key });
      await sock.sendMessage(from, {
        text: `⫎@${sender.split('@')[0]} - LINK REMOVED 🔗🚫⧯\n\n` +
          `This group has *antilink* enabled, which auto-deletes messages containing links from non-admins. ` +
          `Group admins are exempt. Ask an admin to turn it off with *.antilink off* if you need to share a link.`,
        mentions: [sender]
      });
    } else if (action === 'kick') {
      await sock.groupParticipantsUpdate(from, [sender], 'remove');
      await sock.sendMessage(from, {
        text: `⫎@${sender.split('@')[0]} - REMOVED FOR POSTING A LINK 🔗🚫⧯\n\n` +
          `This group has *antilink* set to kick: posting a link as a non-admin gets you removed automatically. ` +
          `Admins can change this with *.antilink delete*.`,
        mentions: [sender]
      });
    }
  } catch (err) {
    console.error('[HANDLER] handleAntilink error:', err.message);
  }
}

async function handleAntiword(sock, msg, groupMetadata) {
  try {
    const from = msg.key?.remoteJid;
    if (!from || !from.endsWith('@g.us')) return;

    const wordSender = msg.key.participant || msg.key.remoteJid;
    if (msg.key?.fromMe || isOwner(wordSender, msg.pushName)) return;

    const settings = database.getGroupSettings(from);
    if (!settings.antiword) return;

    const normalizedContent = normalizeMessageContent(msg.message);
    const body = normalizedContent?.conversation ||
      normalizedContent?.extendedTextMessage?.text ||
      normalizedContent?.imageMessage?.caption ||
      normalizedContent?.videoMessage?.caption ||
      '';
    if (!body) return;

    const normalized = normalizeBody(body);
    if (!badWordRegex.test(normalized)) return;

    const sender = wordSender;
    let isGroupAdminFlag = false;
    for (const p of (groupMetadata.participants || [])) {
      if (p.admin !== 'admin' && p.admin !== 'superadmin') continue;
      if (await participantMatches(sock, p.id, sender)) { isGroupAdminFlag = true; break; }
    }
    if (isGroupAdminFlag) return;

    const action = settings.antiwordAction || 'delete';

    if (action === 'delete') {
      await sock.sendMessage(from, { delete: msg.key });
      await sock.sendMessage(from, {
        text: `⫎@${sender.split('@')[0]} - MESSAGE REMOVED 🤬🚫⧯\n\n` +
          `This group has *antiword* enabled. Group admins are exempt. ` +
          `If this was a false positive, ask an admin - they manage the word list with *.antiword*.`,
        mentions: [sender]
      });
    } else if (action === 'kick') {
      await sock.groupParticipantsUpdate(from, [sender], 'remove');
      await sock.sendMessage(from, {
        text: `⫎@${sender.split('@')[0]} - REMOVED FOR A BLOCKED WORD 🤬🚫⧯\n\n` +
          `This group has *antiword* set to kick. Admins can change this with *.antiword delete*.`,
        mentions: [sender]
      });
    }
  } catch (err) {
    console.error('[HANDLER] handleAntiword error:', err.message);
  }
}

async function handleGroupUpdate(sock, update) {
  try {
    const { id: jid, participants, action } = update;
    if (!jid || !participants) return;

    const settings      = database.getGroupSettings(jid);
    const groupMetadata = await sock.groupMetadata(jid);
    const groupName     = groupMetadata.subject || 'Group';
    const groupDesc     = groupMetadata.desc || '';
    const memberCount   = groupMetadata.participants?.length || 0;

    if (action === 'add' && settings.welcome) {
      const welcomeCfg = settings.welcome;
      const enabled = typeof welcomeCfg === 'object' ? !!welcomeCfg.enabled : !!welcomeCfg;
      const template = typeof welcomeCfg === 'object'
        ? (welcomeCfg.text || 'Welcome to the group, @name! 🎉')
        : (settings.welcomeMessage || 'Welcome @user to @group! 👋');
      if (enabled) {
        for (const rawParticipant of participants) {
          const participant = await resolvePhoneJid(sock, rawParticipant);
          const user = cleanNumber(participant);
          const msg = template
            .replace(/@name/g, `@${user}`)
            .replace(/@user/g, `@${user}`)
            .replace(/@group/g, groupName)
            .replace(/groupDesc/g, groupDesc)
            .replace(/#memberCount/g, memberCount)
            .replace(/time/g, new Date().toLocaleString());
          await sock.sendMessage(jid, { text: msg, mentions: [participant] });
        }
      }
    }

    if (action === 'remove' && settings.goodbye) {
      const goodbyeCfg = settings.goodbye;
      const enabled = typeof goodbyeCfg === 'object' ? !!goodbyeCfg.enabled : !!goodbyeCfg;
      const template = typeof goodbyeCfg === 'object'
        ? (goodbyeCfg.text || 'See you later, @name! 👋')
        : (settings.goodbyeMessage || 'Goodbye @user 👋');
      if (enabled) {
        for (const rawParticipant of participants) {
          const participant = await resolvePhoneJid(sock, rawParticipant);
          const user = cleanNumber(participant);
          const msg = template.replace(/@name/g, `@${user}`).replace(/@user/g, `@${user}`);
          await sock.sendMessage(jid, { text: msg, mentions: [participant] });
        }
      }
    }
  } catch (err) {
    console.error('[HANDLER] handleGroupUpdate error:', err.message);
  }
}

async function getGroupMetadata(sock, jid) {
  try {
    return await sock.groupMetadata(jid);
  } catch (_) {
    return null;
  }
}

module.exports = {
  handleMessage,
  handleAntilink,
  handleAntiword,
  handleGroupUpdate,
  getGroupMetadata,
  getCommands: () => commands,
  checkIn,
};
