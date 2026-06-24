const axios = require('axios');
const config = require('../config');

// ── Genius API helpers ────────────────────────────────────────────────────────

const getAccessToken = () =>
  config.genius?.clientAccessToken || process.env.GENIUS_ACCESS_TOKEN || '';

/**
 * Search Genius for a song and return the first hit's metadata.
 * Returns { title, artist, url, thumbnailUrl } or null.
 */
const searchGenius = async (query) => {
  const token = getAccessToken();
  if (!token) throw new Error('Genius access token is not configured. Set GENIUS_ACCESS_TOKEN in .env or config.genius.clientAccessToken in config.js');

  const res = await axios.get('https://api.genius.com/search', {
    params: { q: query },
    timeout: 15000,
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'JAILBREAK-SR/1.0',
    },
  });

  const hits = res.data?.response?.hits;
  if (!hits?.length) return null;

  const hit = hits[0].result;
  return {
    title:        hit.title             || 'Unknown',
    artist:       hit.primary_artist?.name || 'Unknown',
    url:          hit.url               || '',
    thumbnailUrl: hit.song_art_image_thumbnail_url || hit.header_image_thumbnail_url || '',
    id:           hit.id,
  };
};

/**
 * Scrape lyrics from a Genius song page.
 * Genius does not expose lyrics via the API so we fetch the HTML and
 * extract from the [data-lyrics-container] divs — the same technique
 * every Genius client library uses.
 */
/**
 * Extract the full inner HTML of every <div data-lyrics-container="true"> on
 * the page, correctly handling nested <div> tags (e.g. Genius's annotation/
 * referent wrappers around individual words).
 *
 * The previous implementation used a single lazy regex
 * (`<div ...>([\s\S]*?)<\/div>`), which stops at the FIRST `</div>` it
 * encounters. Since lyrics containers almost always have nested divs inside
 * them, that regex was matching only up to the first nested div's closing
 * tag — silently truncating most songs after just a few words/lines. This
 * walks the HTML and tracks div depth to find each container's true closing
 * tag instead.
 */
const extractLyricsContainers = (html) => {
  const openTagRegex = /<div[^>]*\bdata-lyrics-container="true"[^>]*>/gi;
  const anyDivRegex = /<div\b[^>]*>|<\/div>/gi;
  const chunks = [];

  let openMatch;
  while ((openMatch = openTagRegex.exec(html)) !== null) {
    const containerStart = openMatch.index + openMatch[0].length;
    anyDivRegex.lastIndex = containerStart;

    let depth = 1;
    let containerEnd = html.length;
    let tagMatch;
    while ((tagMatch = anyDivRegex.exec(html)) !== null) {
      if (tagMatch[0].toLowerCase() === '</div>') {
        depth--;
        if (depth === 0) {
          containerEnd = tagMatch.index;
          break;
        }
      } else {
        depth++;
      }
    }

    chunks.push(html.slice(containerStart, containerEnd));
    // Resume scanning for the next container right after this one ended.
    openTagRegex.lastIndex = containerEnd;
  }

  return chunks;
};

const scrapeLyrics = async (geniusUrl) => {
  const res = await axios.get(geniusUrl, {
    timeout: 20000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,*/*',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  const html = res.data || '';

  // Genius stores each stanza in a <div data-lyrics-container="true"> element,
  // which can itself contain nested divs (annotations) — extracted with
  // depth-aware parsing above, not a naive lazy regex.
  const chunks = extractLyricsContainers(html);

  if (!chunks.length) return null;

  const lyrics = chunks
    .join('\n')
    // <br> and <br/> → newline
    .replace(/<br\s*\/?>/gi, '\n')
    // Section headers like [Chorus], [Verse 1] — keep them, just strip the tags around them
    .replace(/<[^>]+>/g, '')
    // Decode common HTML entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Collapse 3+ consecutive newlines into 2
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return lyrics || null;
};

// ── WhatsApp message helpers ──────────────────────────────────────────────────

/**
 * Split a long lyrics string into chunks that fit within WhatsApp's
 * ~4096-char message limit, breaking cleanly on blank lines (stanza breaks).
 */
const CHUNK_LIMIT = 3800;

const splitLyrics = (lyrics) => {
  if (lyrics.length <= CHUNK_LIMIT) return [lyrics];

  const parts = [];
  const stanzas = lyrics.split('\n\n');
  let current = '';

  for (const stanza of stanzas) {
    const candidate = current ? `${current}\n\n${stanza}` : stanza;
    if (candidate.length > CHUNK_LIMIT) {
      if (current) parts.push(current.trim());
      // If a single stanza is itself too long, hard-split it
      if (stanza.length > CHUNK_LIMIT) {
        let remaining = stanza;
        while (remaining.length > CHUNK_LIMIT) {
          parts.push(remaining.slice(0, CHUNK_LIMIT).trim());
          remaining = remaining.slice(CHUNK_LIMIT);
        }
        current = remaining;
      } else {
        current = stanza;
      }
    } else {
      current = candidate;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
};

const buildHeader = ({ title, artist, query }) =>
`⧯ *𝙻𝚈𝚁𝙸𝙲𝚂* ⧯
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
◈ *𝚃𝙸𝚃𝙻𝙴 :* \`${title}\`
◈ *𝙰𝚁𝚃𝙸𝚂𝚃 :* \`${artist}\`
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯`;

// ── Command export ────────────────────────────────────────────────────────────

module.exports = {
  name: 'lyrics',
  aliases: ['lyric', 'lyr', 'words'],
  category: 'cmd',
  description: 'Fetch song lyrics from Genius',
  usage: '.lyrics <song name> [- artist]',

  async execute(sock, msg, args, extra = {}) {
    const from   = extra.from || msg.key.remoteJid;
    const query  = args.join(' ').trim();

    if (!query) {
      await sock.sendMessage(from, {
        text: `⧯ Provide a song name.\n\nExample: *${config.prefix}lyrics Chamunorwa Bagga*`
      }, { quoted: msg });
      return;
    }

    try {
      if (typeof extra.react === 'function') await extra.react('🔎');

      // ── Step 1: Find the song on Genius ──
      const song = await searchGenius(query);
      if (!song) {
        await sock.sendMessage(from, {
          text: `❌ No results found on Genius for: _${query}_`
        }, { quoted: msg });
        if (typeof extra.react === 'function') await extra.react('❌');
        return;
      }

      // ── Step 2: Scrape the lyrics from the Genius page ──
      const rawLyrics = await scrapeLyrics(song.url);
      if (!rawLyrics) {
        await sock.sendMessage(from, {
          text: `⚠️ Found *${song.title}* by *${song.artist}* but could not extract lyrics.\n\n🔗 Read on Genius: ${song.url}`
        }, { quoted: msg });
        if (typeof extra.react === 'function') await extra.react('⚠️');
        return;
      }

      // ── Step 3: Send — split if lyrics exceed WhatsApp limit ──
      const header = buildHeader({ title: song.title, artist: song.artist, query });
      const chunks = splitLyrics(rawLyrics);

      // First message: header + first chunk
      await sock.sendMessage(from, {
        text: `${header}\n\n${chunks[0]}\n\n> ☬ *𝚂𝙾𝚄𝚁𝙲𝙴 :* 𝙶𝙴𝙽𝙸𝚄𝚂 ☬`
      }, { quoted: msg });

      // Subsequent chunks (if any) sent as follow-ups
      for (let i = 1; i < chunks.length; i++) {
        await sock.sendMessage(from, {
          text: chunks[i] + (i === chunks.length - 1 ? '\n\n> ☬ *𝚂𝙾𝚄𝚁𝙲𝙴 :* 𝙶𝙴𝙽𝙸𝚄𝚂 ☬' : '')
        }, { quoted: msg });
      }

      if (typeof extra.react === 'function') await extra.react('✅');

    } catch (error) {
      console.error('[LYRICS] Error:', error.message || error);

      const userMsg = error.message?.includes('access token')
        ? `🔑 Genius API not configured.\n\n${error.message}`
        : `❌ Failed to fetch lyrics: ${error.message}`;

      await sock.sendMessage(from, { text: userMsg }, { quoted: msg });
      if (typeof extra.react === 'function') await extra.react('❌');
    }
  },
};
