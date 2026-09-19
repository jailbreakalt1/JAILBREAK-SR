/**
 * cmd/songguess.js
 *
 * "I don't know the name but it goes like..." tool.
 * Used when a user describes a song or quotes a lyric fragment but ISN'T SURE
 * of the title/artist. Searches YouTube (yt-search — free, no API key, no
 * rate limit to worry about) and returns the closest matches so the brain
 * can confidently say "pretty sure that's X by Y".
 *
 * Works as a DATA_RELAY command (like weather/time/search) — when called by
 * the brain it returns a summary string instead of sending a message itself,
 * so JB can phrase the result naturally and offer to send the track.
 */

const yts = require('yt-search');

// ── Core search ───────────────────────────────────────────────────────────────

/**
 * Returns up to 3 candidate matches: [{ title, author, url, duration, thumbnail }]
 */
async function fetchGuesses(query) {
    const search = await yts(query);
    const videos = (search?.videos || []).slice(0, 3);
    return videos.map(v => ({
        title:     v.title             || 'Unknown',
        author:    v.author?.name      || 'Unknown',
        url:       v.url               || '',
        duration:  v.timestamp         || '',
        thumbnail: v.thumbnail         || '',
    }));
}

// ── Summary builder (for brain relay) ─────────────────────────────────────────

function buildSummary(query, guesses) {
    if (!guesses.length) return null;
    const lines = guesses.map((g, i) => `${i + 1}. "${g.title}" by ${g.author} (${g.duration})`);
    const top = guesses[0];
    return (
        `Song guess results for "${query}":\n${lines.join('\n')}\n` +
        `Most likely match: "${top.title}" by ${top.author}. ` +
        `If the user confirms this is the one (says yes, that's it, send it, etc.), ` +
        `trigger the "song" action next with args ["${top.title} ${top.author}"].`
    );
}

// ── Card builder (direct .songguess command + relay-failure fallback) ────────

function buildCard(query, guesses) {
    const lines = [
        `╔════════════════════╗`,
        `   ╼ 𝚂𝙾𝙽𝙶 𝙶𝚄𝙴𝚂𝚂 ╾`,
        `╚════════════════════╝`,
        `⎛`,
        `  ◈ 𝙳𝙴𝚂𝙲𝚁𝙸𝙿𝚃𝙸𝙾𝙽 : \`${query}\``,
        ``,
        `  ⧯ *CLOSEST MATCHES*`,
    ];

    guesses.forEach((g, i) => {
        lines.push(`  ${i + 1}. ${g.title}`);
        lines.push(`     by ${g.author} · ${g.duration}`);
    });

    lines.push(``, `⎝`, ``, ` ☬ *JAILBREAK HUB* ☬`);
    return lines.join('\n');
}

// ── Command export ────────────────────────────────────────────────────────────

module.exports = {
    name:        'songguess',
    aliases:     ['whatsong', 'guesssong', 'idlyrics', 'whichsong'],
    category:    'public',
    description: 'Guess a song from a vague description or partial lyrics (YouTube search, free).',
    usage:       '.songguess <description or lyric fragment>',

    async execute(sock, msg, args, extra = {}) {
        const { reply, react } = extra;
        const from = extra.from || msg.key.remoteJid;

        const query = args.join(' ').trim();
        if (!query) {
            if (extra.__brainCall) return { error: 'no_query' };
            return reply('*🎵 DESCRIPTION NEEDED*\n\nExample: `.songguess that song that goes "I wanna dance with somebody"`');
        }

        if (react) await react('🎵');

        try {
            const guesses = await fetchGuesses(query);
            console.log(`[SONGGUESS] "${query}" → ${guesses.length} candidates`);
            guesses.forEach((g, i) =>
                console.log(`  [${i + 1}] ${g.title} — ${g.author} (${g.duration})`)
            );

            if (!guesses.length) {
                if (extra.__brainCall) return { empty: true };
                await sock.sendMessage(from, { text: `❌ Couldn't find a match for: _${query}_` }, { quoted: msg });
                if (react) await react('❌');
                return;
            }

            // ── Brain-triggered path ──────────────────────────────────────────
            if (extra.__brainCall) {
                return { summary: buildSummary(query, guesses), top: guesses[0], _card: buildCard(query, guesses) };
            }

            // ── Direct command path ───────────────────────────────────────────
            await sock.sendMessage(from, { text: buildCard(query, guesses) }, { quoted: msg });
            if (react) await react('✅');

        } catch (err) {
            console.error('[SONGGUESS]', err.message);
            if (extra.__brainCall) return { error: err.message };
            if (react) await react('❌');
            return reply('*ERROR* — couldn\'t search for that right now.');
        }
    },
};
