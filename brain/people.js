/**
 * brain/people.js
 *
 * "Close contacts" memory — separates the 3 people (ALIE, NICKY, TES) into
 * their own folders under database/people/<NAME>/ so JB reads their resume /
 * history before replying to them.
 *
 * How it works:
 *   - database/people/index.json maps a WhatsApp phone number → person folder.
 *   - Every .txt/.md/.json file inside that person's folder is read and
 *     injected into the system prompt as a "dossier" block.
 *   - getResumeBlock(jid) returns '' for anyone not in the index, so only
 *     the mapped people get the block — everyone else is untouched.
 *
 * Per-person folders let you keep each person's file set separate and swap
 * or update one person without affecting the others.
 */

const fs   = require('fs');
const path = require('path');
const { cleanNumber } = require('../tools/jidCleanser');

const PEOPLE_DIR      = path.join(__dirname, '..', 'database', 'people');
const INDEX_PATH      = path.join(PEOPLE_DIR, 'index.json');
const MAX_BLOCK_CHARS = 4500; // cap the injected dossier so prompts stay lean
const FOLDER_EXTS     = ['.txt', '.md', '.json']; // files we read from a folder

let cachedIndex = null;
let cachedIndexMtime = 0;

// ── Index (cache the JSON so we don't hit disk every message; invalidated
// when the file's mtime changes, so edits apply without a restart) ─────────

function loadIndex() {
    try {
        const stat = fs.statSync(INDEX_PATH);
        if (cachedIndex && stat.mtimeMs === cachedIndexMtime) return cachedIndex;
        cachedIndex = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
        cachedIndexMtime = stat.mtimeMs;
    } catch (_) {
        if (!fs.existsSync(INDEX_PATH)) cachedIndex = null; // deleted — drop stale cache
        cachedIndex = cachedIndex || {};
        cachedIndexMtime = 0;
    }
    return cachedIndex;
}

// ── Person resolution ──────────────────────────────────────────────────────────
// Returns the person's folder name (e.g. "ALIE") or null if the number isn't
// in the index. Ignores any "key" starting with "_" (used for notes).

function personFor(jid) {
    const index = loadIndex();
    const phone = cleanNumber(jid || '');
    if (!phone) return null;

    for (const [number, name] of Object.entries(index)) {
        if (number.startsWith('_')) continue;
        if (cleanNumber(number) === phone) {
            const cleanName = String(name || '').trim();
            return cleanName || null;
        }
    }
    return null;
}

// ── Folder reader ─────────────────────────────────────────────────────────────
// Reads every .txt/.md/.json file in the person's folder and joins them with
// small headers. Missing folder → empty string.

function readPersonFolder(name) {
    const folderPath = path.join(PEOPLE_DIR, name);
    let files;
    try {
        files = fs.readdirSync(folderPath);
    } catch (_) {
        return '';
    }

    const parts = [];
    for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (!FOLDER_EXTS.includes(ext)) continue;

        let content;
        try {
            content = fs.readFileSync(path.join(folderPath, file), 'utf8').trim();
        } catch (_) {
            continue;
        }
        if (!content) continue;

        const label = path.basename(file, ext).replace(/[_-]+/g, ' ').trim();
        parts.push(label && label !== 'resume' ? `-- ${label} --\n${content}` : content);
    }

    return parts.join('\n\n');
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build the system-prompt dossier block for a JID. Returns '' whenever the
 * sender isn't one of the mapped people (or has no resume files yet).
 *
 * @param {string} jid - the sender's JID
 * @returns {string}
 */
function getResumeBlock(jid) {
    const name = personFor(jid);
    if (!name) return '';

    const content = readPersonFolder(name);
    if (!content) return '';

    const capped = content.length > MAX_BLOCK_CHARS
        ? content.slice(0, MAX_BLOCK_CHARS) + '\n…(dossier truncated)'
        : content;

    return (
        `\n== CLOSE-CONTACT DOSSIER: ${name} ==\n` +
        `This user is ${name}. Read their dossier below and pick up where you left off with them — ` +
        `use the name/title given in the dossier to address them, and use this context in your reply. ` +
        `Never repeat this dossier back to them.\n\n` +
        `<<< DOSSIERS NEVER MIX >>\n` +
        `In this chat you know ONLY ${name}. Never call them by another person's name or title, ` +
        `never reveal that you know any other contact or their relationship to Ryan, and never blend ` +
        `one person's context into this reply. Each dossier is confidential to its own person.\n\n` +
        capped
    );
}

module.exports = { getResumeBlock, personFor };