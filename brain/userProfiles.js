/**
 * brain/userProfiles.js
 *
 * Per-user persistent preference memory — separate from conversation history.
 * Stores facts the brain explicitly learns about a user across ALL sessions:
 *   name, language preference, music taste, location, etc.
 *
 * How it works:
 *   - The brain can return a special JSON field: "remember": { key: value, ... }
 *   - handler.js calls userProfiles.save() when it sees that field
 *   - On every brain call, the profile is injected into the system prompt
 *     as a compact "What I know about this user" block
 *   - The brain uses this to personalise replies without asking every time
 *
 * Storage: database/profiles/<phone>.json
 * Format:  flat key→value object, values are short strings
 *
 * Built-in keys the brain is taught to use (via persona.js additions):
 *   name, nickname, language, city, music_taste, vibe, last_topic
 *
 * The brain can also invent its own keys — anything it stores gets injected back.
 * Max 20 keys per user to keep the prompt injection small.
 */

const fs   = require('fs');
const path = require('path');

const PROFILES_DIR = path.join(__dirname, '..', 'database', 'profiles');
const MAX_KEYS     = 20;
const MAX_VAL_LEN  = 120; // chars per value — keep prompt injection compact

if (!fs.existsSync(PROFILES_DIR)) fs.mkdirSync(PROFILES_DIR, { recursive: true });

// ── Helpers ───────────────────────────────────────────────────────────────────

function jidToFile(jid) {
    const phone = jid.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(PROFILES_DIR, `${phone}.json`);
}

function readProfile(jid) {
    try {
        const raw = fs.readFileSync(jidToFile(jid), 'utf8');
        const parsed = JSON.parse(raw);
        return typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
        return {};
    }
}

function writeProfile(jid, data) {
    const fp  = jidToFile(jid);
    const tmp = fp + '.tmp';
    try {
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
        fs.renameSync(tmp, fp);
    } catch (err) {
        console.error(`[JB-PROFILE] write failed for ${jid}: ${err.message}`);
        try { fs.unlinkSync(tmp); } catch (_) {}
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Save one or more key→value facts about a user.
 * Called by handler.js when the brain returns a "remember" field.
 *
 * @param {string} jid   - WhatsApp JID
 * @param {object} facts - { key: "value", ... }
 */
function save(jid, facts) {
    if (!facts || typeof facts !== 'object') return;

    const profile = readProfile(jid);

    for (const [k, v] of Object.entries(facts)) {
        if (typeof k !== 'string' || !k.trim()) continue;
        const key = k.trim().toLowerCase().replace(/\s+/g, '_').slice(0, 40);
        const val = String(v || '').trim().slice(0, MAX_VAL_LEN);
        if (!val) {
            // Empty value = forget this fact
            delete profile[key];
        } else {
            profile[key] = val;
        }
    }

    // Evict oldest keys if over limit (preserve insertion order via Object.keys)
    const keys = Object.keys(profile);
    if (keys.length > MAX_KEYS) {
        const toDelete = keys.slice(0, keys.length - MAX_KEYS);
        toDelete.forEach(k => delete profile[k]);
    }

    writeProfile(jid, profile);
    console.log(`[JB-PROFILE] saved for ${jid}:`, facts);
}

/**
 * Get the profile as a compact system-prompt injection string.
 * Returns empty string if no profile exists yet.
 *
 * @param {string} jid
 * @returns {string}
 */
function getPromptBlock(jid) {
    const profile = readProfile(jid);
    const entries = Object.entries(profile);
    if (!entries.length) return '';

    const lines = entries.map(([k, v]) => `  • ${k}: ${v}`).join('\n');
    return `\nWhat I know about this user (from past conversations):\n${lines}`;
}

/**
 * Get the raw profile object (for debugging / .profile command).
 * @param {string} jid
 * @returns {object}
 */
function get(jid) {
    return readProfile(jid);
}

/**
 * Delete a user's profile entirely.
 * @param {string} jid
 */
function clear(jid) {
    try { fs.unlinkSync(jidToFile(jid)); } catch (_) {}
}

module.exports = { save, getPromptBlock, get, clear };
