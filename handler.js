const fs = require('fs');
const path = require('path');
const config = require('./config');
const database = require('./database');
const chalk = require('chalk');
const { normalizeMessageContent } = require('@whiskeysockets/baileys');

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
  duplicates: new Map(),
  userHistory: new Map(),
  globalHistory: [],
  warnings: new Map(),
};

const commands = new Map();

function loadCommands() {
  // Scan these folders for command modules. Any .js file that exports
  // an object with a `name` property is registered automatically -
  // no need to add a require() line here when you drop in a new command.
  const commandDirs = ['cmd', 'tools'];
  const thisFile = path.basename(__filename);

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

      // Files without a `name` export (helpers like api.js, converter.js,
      // tempManager.js, etc.) aren't commands - skip them silently.
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
  for (const [user, history] of spamTracker.userHistory) {
    const active = history.filter(t => now - t < config.spam.perUserWindow * 1000);
    if (active.length) spamTracker.userHistory.set(user, active);
    else spamTracker.userHistory.delete(user);
  }
  for (const [user, data] of spamTracker.warnings) {
    if (data.mutedUntil && now > data.mutedUntil) spamTracker.warnings.delete(user);
  }
}, 30 * 1000);

async function resolveJidToPN(sock, jid) {
  if (!jid || !jid.endsWith('@lid')) return jid;
  try {
    const pn = await sock.signalRepository.lidMapping.getPNForLID(jid);
    if (pn) return pn;
  } catch (_) {}
  return jid;
}

function isOwner(jid, pushName) {
  const sender = jid.split('@')[0].split(':')[0];
  return config.ownerNumber.map(n => n.replace(/[^0-9]/g, '')).includes(sender) ||
    config.ownerName.some(name => name.toLowerCase() === (pushName || '').toLowerCase());
}

async function isGroupAdmin(sock, jid, participant) {
  try {
    const meta = await sock.groupMetadata(jid);
    const participants = meta.participants || [];
    return participants.some(p => p.id === participant && (p.admin === 'admin' || p.admin === 'superadmin'));
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
    const botNumber = botJid.split('@')[0].split(':')[0];
    for (const p of participants) {
      if (p.admin !== 'admin' && p.admin !== 'superadmin') continue;
      if (p.id.startsWith(botNumber + '@') || p.id.startsWith(botNumber + ':')) return true;
      if (p.id.endsWith('@lid')) {
        const resolved = await resolveJidToPN(sock, p.id);
        if (resolved && resolved !== p.id) {
          const rn = resolved.split('@')[0].split(':')[0];
          if (rn === botNumber) return true;
        }
      }
    }
    return false;
  } catch (_) {
    return false;
  }
}

async function handleMessage(sock, msg) {
  const from = msg.key?.remoteJid;
  let sender = msg.key.participant || from;
  const senderNum = sender?.split('@')[0] || '?';
  try {
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

    if (!body.startsWith(config.prefix)) { console.log(chalk.gray('  ⧈ ') + chalk.cyan('HANDLER') + chalk.gray(' ── ') + chalk.white(senderNum) + chalk.red(' NO PREFIX')); return; }

    const args = body.slice(config.prefix.length).trim().split(/ +/);
    const commandName = args.shift()?.toLowerCase();
    if (!commandName) { console.log(chalk.gray('  ⧈ ') + chalk.cyan('HANDLER') + chalk.gray(' ── ') + chalk.white(senderNum) + chalk.red(' EMPTY CMD')); return; }

    const cmd = commands.get(commandName);
    if (!cmd) { console.log(chalk.gray('  ⧈ ') + chalk.cyan('HANDLER') + chalk.gray(' ── ') + chalk.white(senderNum) + chalk.red(' UNKNOWN ') + chalk.gray(commandName)); return; }

    const pushName = msg.pushName || '';

    // Resolve LID to phone number JID so owner check works
    const resolvedJid = sender.endsWith('@lid')
      ? (await resolveJidToPN(sock, sender)) || sender
      : sender;
    if (resolvedJid !== sender) {
      console.log(chalk.gray('  ⧈ ') + chalk.cyan('LIDMAP') + chalk.gray(' ── ') + chalk.white(senderNum) + chalk.gray(' → ') + chalk.yellowBright(resolvedJid.split('@')[0]));
      sender = resolvedJid;
    }

    const isGroup = from.endsWith('@g.us');
    const isOwnerUser = isOwner(sender, pushName);

    if (isGroup) {
      const allowedCommands = database.getAllowedCommandsForGroup(from);
      const isSudoCommand = commandName === 'sudo' || commandName === 'sallow';
      const isSudoAllowed = allowedCommands.includes('*') || allowedCommands.includes(commandName);
      if (isSudoCommand) {
        if (!isOwnerUser) { console.log(chalk.gray('  ⧈ ') + chalk.cyan('SUDO') + chalk.gray(' ── ') + chalk.white(senderNum) + chalk.red(' DENIED')); return; }
      } else if (!isSudoAllowed) {
        console.log(chalk.gray('  ⧈ ') + chalk.cyan('PERM') + chalk.gray(' ── ') + chalk.white(senderNum) + chalk.red(' NOT ALLOWED ') + chalk.gray(commandName));
        return;
      }
      // Generic owner-gate: a command flagged ownerOnly must NEVER run for a
      // non-owner, even if it's somehow present in a group's sudo allow-list
      // (e.g. via "*" or an explicit allow). This matters most for commands
      // like `update` that can overwrite the entire codebase.
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
      from,
      sender,
      pushName,
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

    if (isGroup) {
      const gSettings = database.getGroupSettings(from);
      if (gSettings.antiword && badWordRegex.test(normalizeBody(body))) {
        return extra.reply(`⫎@${sender.split('@')[0]} - COMMAND BLOCKED - BAD WORD DETECTED 🚫⧯`, { mentions: [sender] });
      }

      if (gSettings.antispam) {
        const now = Date.now();
        const cmdKey = `${sender}:${commandName}:${args.join(' ')}`;

        const warnData = spamTracker.warnings.get(sender);
        if (warnData && warnData.mutedUntil && now < warnData.mutedUntil) {
          return extra.reply(`⫎@${sender.split('@')[0]} - YOU ARE MUTED FOR 5 MIN - WAIT ⏳⧯`, { mentions: [sender] });
        }

        const lastTime = spamTracker.duplicates.get(cmdKey);
        if (lastTime && (now - lastTime) < config.spam.duplicateCooldown * 1000) {
          return extra.reply(`⫎@${sender.split('@')[0]} - SLOOWWWW DOWN, I CAN'T KEEP UP. GIVE ME LIKE 2MINS THEN TRY AGAIN... 💀⧯`, { mentions: [sender] });
        }

        const userTimes = spamTracker.userHistory.get(sender) || [];
        const recentUser = userTimes.filter(t => now - t < config.spam.perUserWindow * 1000);
        if (recentUser.length >= config.spam.perUserLimit) {
          const warnings = spamTracker.warnings.get(sender) || { count: 0, mutedUntil: 0 };
          warnings.count += 1;
          if (warnings.count >= config.spam.maxWarnings) {
            warnings.mutedUntil = now + 5 * 60 * 1000;
            spamTracker.warnings.set(sender, warnings);
            return extra.reply(`⫎🚫 @${sender.split('@')[0]} - SPAM/ABUSE DETECTED - ${warnings.count}/${config.spam.maxWarnings} STRIKES\nMUTED FOR 5 MINUTES ⏳\n I WILL PERSONALLY IGNORE YOU FOR THE NEXT 5 MINS⧯`, { mentions: [sender] });
          }
          spamTracker.warnings.set(sender, warnings);
          return extra.reply(`⫎🐢 @${sender.split('@')[0]} - SLOW DOWN! WARNING ${warnings.count}/${config.spam.maxWarnings}\nMAX 5 REQUESTS PER 2MIN - NEXT STRIKE = MUTE ⏳⧯`, { mentions: [sender] });
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
  }
}

async function handleAntilink(sock, msg, groupMetadata) {
  try {
    const from = msg.key?.remoteJid;
    if (!from || !from.endsWith('@g.us')) { console.log('[ANTILINK] not group'); return; }

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

    const sender = msg.key.participant || msg.key.remoteJid;
    const isGroupAdmin = (groupMetadata.participants || []).some(p => p.id === sender && (p.admin === 'admin' || p.admin === 'superadmin'));
    if (isGroupAdmin) { console.log('[ANTILINK] sender is admin'); return; }

    const action = settings.antilinkAction || 'delete';
    console.log('[ANTILINK] executing action=' + action + ' for sender=' + sender);

    if (action === 'delete') {
      await sock.sendMessage(from, { delete: msg.key });
      console.log('[ANTILINK] delete sent');
    } else if (action === 'kick') {
      await sock.groupParticipantsUpdate(from, [sender], 'remove');
      console.log('[ANTILINK] kick sent');
    }
  } catch (err) {
    console.error('[HANDLER] handleAntilink error:', err.message);
  }
}

async function handleAntiword(sock, msg, groupMetadata) {
  try {
    const from = msg.key?.remoteJid;
    if (!from || !from.endsWith('@g.us')) return;

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

    const sender = msg.key.participant || msg.key.remoteJid;
    const isGroupAdmin = (groupMetadata.participants || []).some(p => p.id === sender && (p.admin === 'admin' || p.admin === 'superadmin'));
    if (isGroupAdmin) return;

    const action = settings.antiwordAction || 'delete';

    if (action === 'delete') {
      await sock.sendMessage(from, { delete: msg.key });
    } else if (action === 'kick') {
      await sock.groupParticipantsUpdate(from, [sender], 'remove');
    }
  } catch (err) {
    console.error('[HANDLER] handleAntiword error:', err.message);
  }
}

async function handleGroupUpdate(sock, update) {
  try {
    const { id: jid, participants, action } = update;
    if (!jid || !participants) return;

    const settings = database.getGroupSettings(jid);
    const groupMetadata = await sock.groupMetadata(jid);
    const groupName = groupMetadata.subject || 'Group';
    const groupDesc = groupMetadata.desc || '';
    const memberCount = groupMetadata.participants?.length || 0;

    if (action === 'add' && settings.welcome) {
      for (const participant of participants) {
        const user = participant.split('@')[0];
        let msg = settings.welcomeMessage
          .replace(/@user/g, `@${user}`)
          .replace(/@group/g, groupName)
          .replace(/groupDesc/g, groupDesc)
          .replace(/#memberCount/g, memberCount)
          .replace(/time/g, new Date().toLocaleString());
        await sock.sendMessage(jid, {
          text: msg,
          mentions: [participant],
        });
      }
    }

    if (action === 'remove' && settings.goodbye) {
      for (const participant of participants) {
        const user = participant.split('@')[0];
        let msg = settings.goodbyeMessage.replace(/@user/g, `@${user}`);
        await sock.sendMessage(jid, {
          text: msg,
          mentions: [participant],
        });
      }
    }
  } catch (err) {
    console.error('[HANDLER] handleGroupUpdate error:', err.message);
  }
}

function initializeAntiCall(sock) {
  sock.ev.on('call', async (calls) => {
    try {
      for (const call of calls) {
        if (call.status === 'offer') {
          await sock.rejectCall(call.id, call.from);
          await sock.sendMessage(call.from, { text: config.messages.ownerOnly });
        }
      }
    } catch (_) {}
  });
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
  initializeAntiCall,
  getGroupMetadata,
  getCommands: () => commands,
};
