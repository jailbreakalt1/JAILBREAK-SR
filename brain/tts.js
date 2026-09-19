/**
 * brain/tts.js
 *
 * Random voice-note replies for DMs — every so often (random 8–16 AI replies,
 * avg ~12) JB answers with an edge-tts voice note instead of plain text.
 *
 * Voice: "Sonia" (en-GB-SoniaNeural) — Microsoft Edge's free TTS, no API key.
 * The voice list is fetched once at first use and cached; if Sonia is ever
 * missing we fall back to any en-GB female, then to a hardcoded default.
 *
 * Flow: edge-tts synth (mp3) → tools/converter.js toPTT (Ogg/Opus) →
 * sendMessage({ audio, mimetype: 'audio/ogg; codecs=opus', ptt: true }).
 * Any failure falls back to a normal text reply — the brain must never go
 * silent just because TTS hiccupped.
 */

const fs   = require('fs');
const path = require('path');
const { toPTT } = require('../tools/converter');

const STATE_FILE     = path.join(__dirname, '..', 'database', 'voiceNotes.json');
const MIN_INTERVAL   = 8;   // min AI replies between voice notes
const MAX_INTERVAL   = 16;  // max AI replies between voice notes (avg ~12)
const MAX_CHARS      = 500; // skip TTS for very long replies — keeps it fast
const SYNTH_TIMEOUT  = 10000; // hard cap on generate+convert, then fall back to text
const PREFERRED_VOICE = 'en-GB-SoniaNeural';
const FALLBACK_VOICE  = 'en-GB-LibbyNeural';

let ttsLib      = null; // lazy `require('edge-tts-universal')`
let voicesList  = null; // cached listVoices() result (null until fetched OK)
let voicesTried = 0;    // last listVoices attempt time — retry throttle
let resolvedVoice = null; // cached ShortName we settled on (only once list is good)

const VOICES_RETRY_MS = 60000; // don't hammer the voice list on flaky networks

// ── Voice resolution (lazy, once on success, throttled retries) ──────────────

async function ensureVoices() {
    if (Array.isArray(voicesList)) return;                      // already good
    if (Date.now() - voicesTried < VOICES_RETRY_MS) return;     // retrying too soon

    if (!ttsLib) ttsLib = require('edge-tts-universal');
    voicesTried = Date.now();

    try {
        const result = await ttsLib.listVoices();
        voicesList = (Array.isArray(result) && result.length) ? result : null;
    } catch (err) {
        console.error(`[TTS] listVoices failed: ${err.message || err}`);
        voicesList = null;
    }
}

async function resolveVoice() {
    await ensureVoices();

    if (resolvedVoice) return resolvedVoice;

    const voices = Array.isArray(voicesList) && voicesList.length ? voicesList : null;
    const short  = (v) => (v && typeof v.ShortName === 'string' ? v.ShortName : '');

    let pick;
    if (voices) {
        if (voices.some((v) => short(v) === PREFERRED_VOICE)) {
            pick = PREFERRED_VOICE;
        } else {
            const gbFemale = voices.find((v) =>
                short(v).startsWith('en-GB') && /female/i.test(v.Gender || ''));
            pick = (gbFemale && short(gbFemale)) || FALLBACK_VOICE;
        }
        resolvedVoice = pick;
        console.log(`[TTS] using voice: ${resolvedVoice}`);
    } else {
        pick = FALLBACK_VOICE; // voice list unavailable right now — keep talking anyway
    }

    return pick;
}

// ── Synthesis: edge-tts → mp3 buffer ─────────────────────────────────────────

async function synthMp3(text) {
    const voice = await resolveVoice();
    const communicate = new ttsLib.Communicate(text, {
        voice,
        rate:   '+0%',
        volume: '+0%',
        pitch:  '+0Hz',
    });

    const chunks = [];
    for await (const chunk of communicate.stream()) {
        if (chunk?.type === 'audio' && chunk.data) {
            chunks.push(Buffer.isBuffer(chunk.data) ? chunk.data : Buffer.from(chunk.data));
        }
    }

    if (!chunks.length) throw new Error('no audio chunks received');
    return Buffer.concat(chunks);
}

// ── Public: full generate+convert → Ogg/Opus buffer ──────────────────────────

async function generateAudio(text) {
    let synthTimer;
    const synth = Promise.race([
        synthMp3(text).then((mp3) => toPTT(mp3, 'mp3')),
        new Promise((_, reject) => {
            synthTimer = setTimeout(() => reject(new Error('tts timeout')), SYNTH_TIMEOUT);
        }),
    ]).finally(() => clearTimeout(synthTimer));

    const audio = await synth;
    if (!audio?.length) throw new Error('empty converted audio');
    return audio;
}

// ── Counter (persisted per chat) ──────────────────────────────────────────────

function readState() {
    try {
        const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        return typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
        return {};
    }
}

function writeState(state) {
    const tmp = STATE_FILE + '.tmp';
    try {
        fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
        fs.renameSync(tmp, STATE_FILE);
    } catch (err) {
        console.error(`[TTS] state write failed: ${err.message}`);
        try { fs.unlinkSync(tmp); } catch (_) {}
    }
}

function randomTarget() {
    return MIN_INTERVAL + Math.floor(Math.random() * (MAX_INTERVAL - MIN_INTERVAL + 1));
}

/**
 * Advance the per-chat counter. Returns true when THIS reply should become a
 * voice note (and resets the cycle with a fresh random target).
 */
function tick(jid) {
    const state = readState();
    const rec = state[jid] || { count: 0, target: randomTarget() };

    rec.count += 1;
    if (rec.count >= rec.target) {
        rec.count = 0;
        rec.target = randomTarget();
        state[jid] = rec;
        writeState(state);
        return true;
    }

    state[jid] = rec;
    writeState(state);
    return false;
}

/**
 * Synthesize + send `text` as a voice note. Returns true on success.
 * Never throws — any failure logs and returns false so the caller falls back
 * to the plain-text reply.
 */
async function sendVoiceReply(sock, from, text) {
    if (!text || text.length > MAX_CHARS) return false;
    try {
        const audio = await generateAudio(text);
        await sock.sendMessage(from, {
            audio,
            mimetype: 'audio/ogg; codecs=opus',
            ptt:      true,
        });
        console.log(`[TTS] voice note sent to ${from} (${(audio.length / 1024).toFixed(0)}KB)`);
        return true;
    } catch (err) {
        console.error(`[TTS] send failed for ${from}: ${err.message} — falling back to text`);
        return false;
    }
}

module.exports = { tick, sendVoiceReply, resolveVoice, generateAudio };