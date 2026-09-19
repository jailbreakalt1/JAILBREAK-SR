/**
 * brain/memory.js
 *
 * Per-chat conversation history for JB.
 * Persisted to disk as JSON under database/memory/<phone>.json
 *
 * Strategy:
 *  - Last 20 messages always kept verbatim
 *  - Once > SUMMARIZE_THRESHOLD turns, older turns condensed via AI (fire-and-forget)
 *  - MAX_TURNS hard cap guards against a stalled summarizer
 *  - Summarizer tries key 2 (DeepSeek V4 Pro) first, then key 1 (Llama-3.1-8B) as fallback
 *  - Both summary attempts have 18s hard timeouts
 */

const fs     = require('fs');
const path   = require('path');
const { MODELS, hasKey1, hasKey2 } = require('./modelRegistry');
const { getClient } = require('./nimClient');
const axios  = require('axios');
const config = require('../config');

const MAX_TURNS           = 40;
const KEEP_RECENT         = 20;
const SUMMARIZE_THRESHOLD = 25;
const SUMMARY_TAG         = '[MEMORY SUMMARY]';
const SUMMARY_TIMEOUT     = 18000;
const MAX_SONGS_TRACKED   = 15;

const NVIDIA_URL = `${require('./modelRegistry').BASE_URL}/chat/completions`;
const MEMORY_DIR = path.join(__dirname, '..', 'database', 'memory');

if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });

// ── Helpers ──────────────────────────────────────────────────────────────────

function jidToFilename(jid) {
    return jid.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '_');
}
function filePath(jid) {
    return path.join(MEMORY_DIR, `${jidToFilename(jid)}.json`);
}

function readFile(jid) {
    const fp = filePath(jid);
    try {
        const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
        if (Array.isArray(data.messages) && typeof data.lastActive === 'number') {
            if (!Array.isArray(data.songs)) data.songs = []; // backward-compat for older files
            return data;
        }
    } catch (_) {}
    return null;
}

function writeFile(jid, data) {
    const fp  = filePath(jid);
    const tmp = fp + '.tmp';
    try {
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
        fs.renameSync(tmp, fp);
    } catch (err) {
        console.error(`[JB-MEMORY] write failed for ${jid}: ${err.message}`);
        try { fs.unlinkSync(tmp); } catch (_) {}
    }
}

// ── withTimeout ───────────────────────────────────────────────────────────────

function withTimeout(promise, ms) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('summary timeout')), ms);
        }),
    ]).finally(() => clearTimeout(timer));
}

// ── Summarizer ────────────────────────────────────────────────────────────────

const _summarizing = new Set();

async function summarizeOld(jid, turnsToFold) {
    const transcript = turnsToFold.map(m => {
        if (m.role === 'system') return `[Earlier summary]: ${m.content}`;
        return `${m.role === 'user' ? 'User' : 'JB'}: ${m.content}`;
    }).join('\n');

    const prompt =
        'Condense the conversation below into a compact long-term memory note for an AI assistant called JB. ' +
        'Keep anything JB would actually need later: names, ongoing topics, preferences, commitments, running ' +
        'jokes, important facts the user shared. Drop small talk, greetings, and filler. Write it as a short, ' +
        'dense paragraph or tight bullet list, third person ("user said...", "user likes..."), under 150 words. ' +
        'Output only the note — no preamble.\n\n--- CONVERSATION ---\n' + transcript;

    // Attempt 1: Nemotron-3-Super on key 2 (fast + healthy, thinking off)
    if (hasKey2()) {
        try {
            const model  = MODELS.SUMMARY;
            const client = getClient(model.key());
            if (client) {
                const completion = await withTimeout(
                    client.chat.completions.create({
                        model:       model.id(),
                        messages:    [{ role: 'user', content: prompt }],
                        max_tokens:  300,
                        temperature: 0.3,
                        top_p:       0.95,
                        stream:      false,
                        ...model.extra,
                    }),
                    SUMMARY_TIMEOUT
                );
                const raw = completion.choices?.[0]?.message?.content?.trim() || '';
                if (raw) return raw;
            }
        } catch (err) {
            console.error(`[JB-MEMORY] summary attempt 1 failed for ${jid}: ${err.message}`);
        }
    }

    // Attempt 2: DiffusionGemma on key 1 (slot C's model — fast, no special params)
    if (hasKey1()) {
        try {
            const model  = MODELS.SUMMARY_FALLBACK;
            const client = getClient(model.key());
            if (client) {
                const completion = await withTimeout(
                    client.chat.completions.create({
                        model:       model.id(),
                        messages:    [{ role: 'user', content: prompt }],
                        max_tokens:  300,
                        temperature: 0.3,
                        top_p:       0.95,
                        stream:      false,
                    }),
                    SUMMARY_TIMEOUT
                );
                const raw = completion.choices?.[0]?.message?.content?.trim() || '';
                if (raw) return raw;
            }
        } catch (err) {
            console.error(`[JB-MEMORY] summary attempt 2 failed for ${jid}: ${err.message}`);
        }
    }

    return null;
}

async function maybeSummarize(jid) {
    if (_summarizing.has(jid)) return;

    const data = readFile(jid);
    if (!data || data.messages.length <= SUMMARIZE_THRESHOLD) return;

    const alreadySummarized =
        data.messages[0]?.role === 'system' &&
        typeof data.messages[0].content === 'string' &&
        data.messages[0].content.startsWith(SUMMARY_TAG);

    const foldStart = alreadySummarized ? 1 : 0;
    const splitAt   = data.messages.length - KEEP_RECENT;
    if (splitAt <= foldStart) return;

    _summarizing.add(jid);
    try {
        const toFold = data.messages.slice(foldStart, splitAt);
        const turnsForPrompt = alreadySummarized
            ? [{ role: 'system', content: data.messages[0].content.slice(SUMMARY_TAG.length).trim() }, ...toFold]
            : toFold;

        const summaryText = await summarizeOld(jid, turnsForPrompt);
        if (!summaryText) return;

        const fresh       = readFile(jid) || data;
        const freshRecent = fresh.messages.slice(-KEEP_RECENT);
        fresh.messages    = [
            { role: 'system', content: `${SUMMARY_TAG} ${summaryText}` },
            ...freshRecent,
        ];
        writeFile(jid, fresh);
        console.log(`[JB-MEMORY] summarized history for ${jid} → ${fresh.messages.length} turns`);
    } finally {
        _summarizing.delete(jid);
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

function add(jid, role, content) {
    const existing = readFile(jid) || { messages: [], songs: [], lastActive: 0 };
    existing.lastActive = Date.now();
    existing.messages.push({ role, content: String(content) });

    if (existing.messages.length > MAX_TURNS) {
        existing.messages.splice(0, existing.messages.length - MAX_TURNS);
    }

    writeFile(jid, existing);

    if (existing.messages.length > SUMMARIZE_THRESHOLD) {
        maybeSummarize(jid).catch(err =>
            console.error(`[JB-MEMORY] summarize error: ${err.message}`)
        );
    }
}

// Records a song that was actually played/looked up (from song/lyrics/video/
// find/download_song/auto-shazam) so it survives forever, completely
// separate from `messages` — the AI summarizer NEVER sees or touches this
// list, so a song discussed early in a long chat is never "eaten" by
// summarization. Most-recent-first, deduped case-insensitively, capped.
function addSong(jid, label) {
    const clean = String(label || '').trim();
    if (!clean) return;

    const existing = readFile(jid) || { messages: [], songs: [], lastActive: 0 };
    existing.songs = (existing.songs || []).filter(
        (s) => s.toLowerCase() !== clean.toLowerCase()
    );
    existing.songs.unshift(clean);
    if (existing.songs.length > MAX_SONGS_TRACKED) {
        existing.songs = existing.songs.slice(0, MAX_SONGS_TRACKED);
    }
    existing.lastActive = Date.now();
    writeFile(jid, existing);
}

function getSongs(jid) {
    return readFile(jid)?.songs || [];
}

function get(jid) {
    return readFile(jid)?.messages || [];
}

function lastActive(jid) {
    return readFile(jid)?.lastActive || 0;
}

function clear(jid)  { /* history kept permanently */ }
function clearAll()  { /* history kept permanently */ }

function stats() {
    const now = Date.now();
    const details = [];
    try {
        for (const f of fs.readdirSync(MEMORY_DIR)) {
            if (!f.endsWith('.json')) continue;
            const jid  = f.replace(/\.json$/, '');
            const data = readFile(jid + '@s.whatsapp.net') || readFile(jid);
            if (!data) continue;
            details.push({
                jid,
                messages: data.messages.length,
                idleMins: Math.round((now - data.lastActive) / 60000),
            });
        }
    } catch (err) {
        console.error(`[JB-MEMORY] stats failed: ${err.message}`);
    }
    return { chats: details.length, details };
}

module.exports = { add, get, addSong, getSongs, clear, clearAll, stats, lastActive };
