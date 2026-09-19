/**
 * cmd/search.js  —  v6 / AI-driven search
 *
 * Flow:
 *   1. Firecrawl /v1/search with scrapeOptions  →  5 results, each with full page markdown
 *   2. NVIDIA (SUMMARY model chain)             →  reads all 5 pages, writes one coherent answer
 *   3. Brain relay                              →  rephrases that answer in JB's voice
 *
 * Config keys needed in .env:
 *   FIRECRAWL_API_KEY   — sign up free at https://firecrawl.dev (1k credits/month)
 *   NVIDIA_MEDIA_API_KEY / NVIDIA_API_KEY  — already set for the brain
 *
 * Credit cost per search: ~6 Firecrawl credits (1 search + 5 page scrapes).
 * At 1,000 free credits/month → ~160 AI-powered searches/month.
 */

const axios  = require('axios');
const config = require('../config');
const { getClient } = require('../brain/nimClient');
const { MODELS }    = require('../brain/modelRegistry');

// ── Constants ─────────────────────────────────────────────────────────────────

const FIRECRAWL_SEARCH = 'https://api.firecrawl.dev/v1/search';
const TIMEOUT          = 20000;
const CACHE_TTL_MS     = 5 * 60 * 1000;   // 5 minutes
const MAX_MD_CHARS     = 2500;             // per page — keeps total prompt sane

// ── Domains to exclude from Firecrawl results ────────────────────────────────
// Social media platforms return short posts/captions or block scraping entirely —
// neither is useful for an AI trying to synthesize factual information.
const EXCLUDE_DOMAINS = [
    'tiktok.com', 'instagram.com', 'facebook.com', 'x.com', 'twitter.com',
    'snapchat.com', 'pinterest.com', 'threads.net', 'linkedin.com',
];

// ── Query cleaner ─────────────────────────────────────────────────────────────

const FILLER = [
    /^(what|who|where|when|how|why)\s+(is|are|was|were|does|do|did|has|have|had)\s+/i,
    /^(tell me about|find out|look up|search for|google|check)\s+/i,
    /\b(the current|current|latest|today'?s?|right now|at the moment|as of today)\b/gi,
    /\b(please|just|quickly|for me)\b/gi,
];

function cleanQuery(raw) {
    let q = raw.trim();
    // Strip surrounding quotes that some models inject into tool call args
    // e.g. model outputs args: {"query": "\"South Africa news\""} → value has literal quotes
    q = q.replace(/^["'\u201c\u201e]+|["'\u201d\u201f]+$/g, '').trim();
    for (const re of FILLER) q = q.replace(re, ' ');
    return q.replace(/\s{2,}/g, ' ').replace(/[?.!,]+$/, '').trim();
}

// ── Cache ─────────────────────────────────────────────────────────────────────

const _cache = new Map();

function cacheGet(key) {
    const entry = _cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > CACHE_TTL_MS) { _cache.delete(key); return null; }
    return entry.result;
}

function cacheSet(key, result) {
    _cache.set(key, { result, ts: Date.now() });
    if (_cache.size > 50) {
        const oldest = [..._cache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
        _cache.delete(oldest[0]);
    }
}

// ── Step 1: Firecrawl — search + scrape full pages ───────────────────────────

/**
 * Returns array of { title, url, snippet, markdown }.
 * scrapeOptions tells Firecrawl to fetch and clean each result page in the same call.
 */
async function firecrawlSearch(query) {
    const key   = config.firecrawl.apiKey;
    const limit = config.firecrawl.limit || 5;

    const res = await axios.post(
        FIRECRAWL_SEARCH,
        {
            query,
            limit,
            scrapeOptions: {
                formats:         ['markdown'],
                onlyMainContent: true,
            },
        },
        {
            headers: {
                'Authorization': `Bearer ${key}`,
                'Content-Type':  'application/json',
            },
            timeout: TIMEOUT,
        }
    );

    const items = (res.data?.data || []);
    return items.map(r => ({
        title:    r.title       || '',
        url:      r.url         || '',
        snippet:  r.description || '',
        markdown: r.markdown    || '',
    }));
}

// ── Step 2: NVIDIA — summarise all scraped pages into one answer ──────────────

/**
 * Reads all pages, builds a combined context, asks NVIDIA to answer the query.
 * Tries SUMMARY (deepseek key2) → SUMMARY_FALLBACK (diffusiongemma key1).
 * Returns the AI-generated answer string, or null if all models fail.
 */
async function aiSummarise(query, results) {
    // Build context — truncate each page so we don't blow the token limit
    const context = results
        .filter(r => r.markdown || r.snippet)
        .map((r, i) => {
            const body = (r.markdown || r.snippet).slice(0, MAX_MD_CHARS);
            return `--- Source ${i + 1}: ${r.title}\nURL: ${r.url}\n\n${body}`;
        })
        .join('\n\n');

    if (!context.trim()) return null;

    const systemPrompt =
        'You are a research assistant. The user asked a question and you have been given ' +
        'the full text of the top search results. Answer the question directly and factually ' +
        'in 3-5 sentences. Be specific — include names, dates, and numbers where they appear ' +
        'in the sources. Do not say "based on the sources" or add any preamble — just answer.';

    const userPrompt = `Question: ${query}\n\nSearch results:\n${context}`;

    const chain = [MODELS.SUMMARY, MODELS.SUMMARY_FALLBACK];

    for (const modelDef of chain) {
        if (!modelDef.hasKey()) continue;
        const client = getClient(modelDef.key());
        if (!client) continue;

        try {
            const res = await client.chat.completions.create({
                model:       modelDef.id(),
                messages:    [
                    { role: 'system', content: systemPrompt },
                    { role: 'user',   content: userPrompt   },
                ],
                max_tokens:  450,
                temperature: 0.2,
                ...modelDef.extra,
            });
            const answer = res.choices?.[0]?.message?.content?.trim();
            if (answer) {
                console.log(`[SEARCH] AI summary via ${modelDef.id()} ✓`);
                return answer;
            }
        } catch (err) {
            console.warn(`[SEARCH] AI summarise (${modelDef.id()}) failed:`, err.message);
        }
    }
    return null;
}

// ── Main fetch ────────────────────────────────────────────────────────────────

async function fetchSearch(query) {
    // Cache check
    const cached = cacheGet(query);
    if (cached) {
        console.log(`[SEARCH] cache hit: "${query}"`);
        return { ...cached, cached: true };
    }

    // Step 1 — Firecrawl
    let results = [];
    try {
        results = await firecrawlSearch(query);
        console.log(`[SEARCH] "${query}" → Firecrawl returned ${results.length} results`);
        results.forEach((r, i) =>
            console.log(`  [${i + 1}] ${r.title} — ${r.snippet.slice(0, 90)}${r.snippet.length > 90 ? '…' : ''}`)
        );
    } catch (err) {
        const status = err.response?.status;
        console.error(`[SEARCH] Firecrawl error (${status || 'network'}):`, err.message);
        const result = { results: [], aiAnswer: null, empty: true };
        return { ...result, cached: false };
    }

    if (!results.length) {
        console.log(`[SEARCH] "${query}" → no results`);
        return { results: [], aiAnswer: null, empty: true, cached: false };
    }

    // Step 2 — AI summarise
    const aiAnswer = await aiSummarise(query, results);
    if (aiAnswer) {
        console.log(`[SEARCH] AI answer: ${aiAnswer.slice(0, 120)}…`);
    } else {
        console.warn('[SEARCH] AI summarise returned nothing — will fall back to snippets');
    }

    const result = { results, aiAnswer, empty: false };
    cacheSet(query, result);
    return { ...result, cached: false };
}

// ── Card builder (direct .search command) ────────────────────────────────────

function buildCard(query, results, aiAnswer) {
    const lines = [
        `╔════════════════════╗`,
        `   ╼ 𝚆𝙴𝙱 𝚂𝙴𝙰𝚁𝙲𝙷 ╾`,
        `╚════════════════════╝`,
        `⎛`,
        `  ◈ 𝚀𝚄𝙴𝚁𝚈 : \`${query}\``,
        ``,
    ];

    if (aiAnswer) {
        lines.push(`  ⧯ *AI SUMMARY*`);
        // Word-wrap at ~60 chars
        const words = aiAnswer.split(' ');
        let line = '  ';
        for (const w of words) {
            if ((line + w).length > 62) { lines.push(line.trimEnd()); line = '  '; }
            line += w + ' ';
        }
        if (line.trim()) lines.push(line.trimEnd());
        lines.push(``);
    }

    if (results.length) {
        lines.push(`  ⧯ *SOURCES*`);
        results.slice(0, 5).forEach((r, i) => {
            const title = r.title.length > 45 ? r.title.slice(0, 42) + '…' : r.title;
            lines.push(`  ${i + 1}. ${title}`);
        });
        lines.push(``);
    }

    if (!aiAnswer && !results.length) {
        lines.push(`  ⚠️ No results found.`);
        lines.push(``);
    }

    lines.push(`⎝`, ``, ` ☬ *JAILBREAK HUB* ☬`);
    return lines.join('\n');
}

// ── Command export ────────────────────────────────────────────────────────────

module.exports = {
    name:        'search',
    aliases:     ['web', 'google', 'lookup', 'srch'],
    category:    'public',
    description: 'AI-powered web search — reads full pages, gives a direct answer.',
    usage:       '.search <query>',

    buildCard,

    async execute(sock, msg, args, extra = {}) {
        const { reply, react } = extra;
        const from = extra.from || msg.key.remoteJid;

        const rawQuery = args.join(' ').trim();
        if (!rawQuery) {
            if (extra.__brainCall) return { error: 'no_query' };
            return reply('*🔍 QUERY REQUIRED*\n\nExample: `.search who hosted BET Awards 2026`');
        }

        const query = cleanQuery(rawQuery);
        console.log(`[SEARCH] raw="${rawQuery}" → cleaned="${query}"`);

        if (react) await react('🔍');

        try {
            const { results, aiAnswer, empty, cached } = await fetchSearch(query);

            if (cached && react) await react('⚡');

            // ── Brain-triggered path ──────────────────────────────────────────
            if (extra.__brainCall) {
                if (empty) return { empty: true };

                // Prefer AI summary; fall back to concatenated snippets
                const summary = aiAnswer
                    || results.map(r => r.title ? `${r.title}: ${r.snippet}` : r.snippet)
                               .filter(Boolean).join('\n') || null;

                if (!summary) return { empty: true };
                return {
                    summary,
                    _card: buildCard(query, results, aiAnswer),
                };
            }

            // ── Direct command path ───────────────────────────────────────────
            await sock.sendMessage(
                from,
                { text: buildCard(query, results, aiAnswer) },
                { quoted: msg }
            );
            if (react) await react('✅');

        } catch (err) {
            console.error('[SEARCH]', err.message);
            if (extra.__brainCall) return { error: err.message };
            if (react) await react('❌');
            return reply('*ERROR* — Search failed. Try again in a moment.');
        }
    },
};
