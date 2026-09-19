/**
 * brain/toolRunner.js
 *
 * Executes a single tool call (from the model's native tool_calls) against
 * the real cmd/*.js commands, normalizing the result into a short string
 * that gets fed straight back to the model so it can decide what to do next.
 *
 *  - 'data' tools     → return { content, terminal: false } where content is
 *                        the actual data (or an error/empty note) for the
 *                        model to reason over.
 *  - 'terminal' tools  → already sent something to the user directly via
 *                        sock.sendMessage inside the command itself. We
 *                        just return a short status string so the model
 *                        knows whether it worked, then closes out the turn.
 */

const config = require('../config');
const { TOOL_DEFS } = require('./toolDefs');
const memory = require('./memory');

const TOOL_MAP = new Map(TOOL_DEFS.map(t => [t.schema.function.name, t]));

const MAX_TOOL_RESULT_CHARS = 2000;

// ── Pending songguess cache ───────────────────────────────────────────────────
// songguess tells the model exactly what to call next ("trigger song with
// args [...]"), but a weak/rescue model can still leak the follow-up call as
// e.g. `song()` with nothing in the parens once the user just says "Yes" —
// there's no argument in the model's own output to recover at that point, so
// this is a mechanical safety net: remember the top candidate per-jid for a
// short window and auto-fill it if the very next song/video/lyrics call comes
// in empty, instead of making the user re-type the title.
const PENDING_GUESS_TTL_MS = 10 * 60 * 1000;
const pendingGuesses = new Map(); // jid -> { query, ts }

// ── In-flight terminal tool dedup ─────────────────────────────────────────────
// When the 45s brain timeout kills think() before a slow download finishes,
// the model's next turn may re-issue the same terminal call. This tracker
// prevents duplicate downloads from landing in the chat. Keyed by chat + tool
// name + args, auto-expires after 2 minutes.
const PENDING_TERMINAL_TTL_MS = 120000;
const pendingTerminal = new Map();

function pendingKey(chatId, name, args) {
    return `${chatId}:${name}:${args.join('|')}`;
}

function isPendingTerminal(chatId, name, args) {
    const key = pendingKey(chatId, name, args);
    const entry = pendingTerminal.get(key);
    if (!entry) return false;
    if (Date.now() - entry.ts > PENDING_TERMINAL_TTL_MS) {
        pendingTerminal.delete(key);
        return false;
    }
    return true;
}

function setPendingTerminal(chatId, name, args) {
    const key = pendingKey(chatId, name, args);
    pendingTerminal.set(key, { ts: Date.now() });
}

function clearPendingTerminal(chatId, name, args) {
    const key = pendingKey(chatId, name, args);
    pendingTerminal.delete(key);
}

function hasPending(chatId) {
    if (!chatId) return false;
    const now = Date.now();
    for (const [key, entry] of pendingTerminal) {
        if (!key.startsWith(chatId)) continue;
        if (now - entry.ts > PENDING_TERMINAL_TTL_MS) {
            pendingTerminal.delete(key);
            continue;
        }
        return true;
    }
    return false;
}

function jidFromCtx(ctx) {
    return ctx.brainExtra?.from || ctx.msg?.key?.remoteJid || null;
}

function rememberGuess(jid, query) {
    if (!jid || !query) return;
    pendingGuesses.set(jid, { query, ts: Date.now() });
}

function consumeGuess(jid) {
    const entry = pendingGuesses.get(jid);
    if (!entry) return null;
    pendingGuesses.delete(jid); // single-use — don't let a stale guess get reused later
    if (Date.now() - entry.ts > PENDING_GUESS_TTL_MS) return null;
    return entry.query;
}

function getToolDef(name) {
    return TOOL_MAP.get(name);
}

/**
 * Most schemas here have exactly one string property, but some (like
 * `remind`) need more than one positional value. Map the parsed JSON args
 * onto the schema's declared property order — cmd.execute() then reads them
 * positionally (args[0], args[1], ...) exactly like a human typing
 * ".cmd <arg1> <arg2>" would produce. Falls back to [] if the tool has no
 * declared parameters at all (find/download_song).
 */
function toCmdArgs(parsedArgs, def) {
    const props = def?.schema?.function?.parameters?.properties;
    if (!props || !Object.keys(props).length) return [];

    return Object.keys(props).map((key) => {
        const v = parsedArgs?.[key];
        if (v === undefined || v === null) return '';
        return String(v).trim();
    });
}

// True if at least one positional arg actually has content — args.length
// alone is no longer a reliable "was anything given?" check now that
// multi-param tools always produce one slot per declared property, even
// when the model left every one of them blank.
function hasArgs(args) {
    return Array.isArray(args) && args.some((a) => a && String(a).trim());
}

function truncate(str) {
    if (typeof str !== 'string') return str;
    return str.length > MAX_TOOL_RESULT_CHARS
        ? str.slice(0, MAX_TOOL_RESULT_CHARS) + '… (truncated)'
        : str;
}

/**
 * @param {object} toolCall - { id, function: { name, arguments } } from the model
 * @param {object} ctx      - { sock, msg, commands, brainExtra }
 * @returns {Promise<{ content: string, terminal: boolean }>}
 */
async function runTool(toolCall, ctx) {
    const name = toolCall.function?.name;
    const def  = getToolDef(name);

    if (!def) {
        return { content: `Tool "${name}" does not exist — do not call it again.`, terminal: false };
    }

    const cmd = ctx.commands.get(def.cmd);
    if (!cmd) {
        // Nothing was ever sent to the user here, so never mark this
        // terminal — that would tell the model (falsely) that it's safe to
        // close out with "sent!" style text.
        return { content: `Tool "${name}" is currently unavailable on this bot. Nothing was sent — tell the user honestly.`, terminal: false };
    }

    // ── Owner-only gate ─────────────────────────────────────────────────
    if (def.ownerOnly) {
        const sender = ctx.msg?.key?.participant || ctx.msg?.key?.remoteJid || '';
        const senderNumber = sender.split('@')[0];
        if (!config.ownerNumber.includes(senderNumber)) {
            console.log(`[JB-TOOL] ${name} blocked for non-owner ${senderNumber}`);
            await ctx.sock.sendMessage(ctx.msg?.key?.remoteJid, { text: config.messages.ownerOnly });
            return {
                content: `"${name}" is owner-only and the user is not the owner. Already told them directly. Do not repeat or explain — just close naturally.`,
                terminal: true,
            };
        }
    }

    let parsedArgs = {};
    try { parsedArgs = JSON.parse(toolCall.function.arguments || '{}'); } catch (_) {}
    let args = toCmdArgs(parsedArgs, def);

    // Auto-fill from a just-confirmed songguess candidate if this is a bare
    // song/video/lyrics call with nothing in it — see pendingGuesses above.
    const AUTO_FILL_CMDS = new Set(['song', 'video', 'lyrics']);
    let autoFilledFromGuess = false;
    if (!hasArgs(args) && AUTO_FILL_CMDS.has(def.cmd)) {
        const guess = consumeGuess(jidFromCtx(ctx));
        if (guess) {
            args = [guess];
            autoFilledFromGuess = true;
            console.log(`[JB-TOOL] ${name}() came in empty — auto-filled from confirmed songguess: "${guess}"`);
        }
    }

    console.log(`[JB-TOOL] ${name}(${args.join(' ')})`);

    // ── DATA tools — read-only, return info for the model to reason over ──────
    if (def.kind === 'data') {
        try {
            const result = await cmd.execute(ctx.sock, ctx.msg, args, { ...ctx.brainExtra, __brainCall: true });

            if (name === 'songguess' && result?.top) {
                const top = result.top;
                rememberGuess(jidFromCtx(ctx), `${top.title} ${top.author}`.trim());
            }

            if (result?.summary)             return { content: truncate(result.summary), terminal: false };
            if (result?.empty)               return { content: `No results found for that ${name} query. Tell the user and maybe suggest rephrasing.`, terminal: false };
            if (result?.error === 'no_city') return { content: 'No city was specified. Ask the user which city they mean before calling weather again.', terminal: false };
            if (result?.error)               return { content: `${name} failed: ${result.error}`, terminal: false };
            return { content: `${name} ran but returned nothing useful.`, terminal: false };

        } catch (err) {
            console.error(`[JB-TOOL] ${name} error:`, err.message);
            return { content: `${name} failed: ${err.message}`, terminal: false };
        }
    }

    // ── TERMINAL tools — send something to the user as a side effect ─────────
    // IMPORTANT: these commands handle their own failure/clarification cases
    // internally (missing query, not-found, download error, etc.) by sending
    // a WhatsApp message and returning a *status object* — they do NOT throw
    // for those cases, since throwing is reserved for genuinely unexpected
    // crashes. That status object is the ONLY way to know whether real media
    // actually went out. We must never assume "didn't throw" == "succeeded":
    // a command can run to completion while only having asked the user a
    // clarifying question or reported a failure, and if we told the model
    // that was a success it would go on to falsely tell the user "sent!".
    const SONG_RELATED_CMDS = new Set(['song', 'lyrics', 'video']);
    const chatId = ctx.brainExtra?.from || ctx.msg?.key?.remoteJid;

    // ── In-flight dedup ───────────────────────────────────────────────────
    // If the same terminal tool with the same args is already running for
    // this chat, drop the duplicate — the first one is still in progress.
    if (isPendingTerminal(chatId, name, args)) {
        console.log(`[JB-TOOL] ${name}(${args.join(' ')}) already in-flight for ${chatId} — skipping duplicate`);
        return {
            content: `Already working on "${args.join(' ')}" — it's coming, just taking a moment. Don't repeat or confirm anything, just wait.`,
            terminal: false,
        };
    }
    setPendingTerminal(chatId, name, args);

    let result;
    try {
        if (def.cmd === 'download_song') {
            const findCmd = ctx.commands.get('find');
            if (!findCmd) {
                clearPendingTerminal(chatId, name, args);
                return { content: 'The find command is unavailable, could not identify/download.', terminal: false };
            }
            result = await findCmd.execute(ctx.sock, ctx.msg, args, { ...ctx.brainExtra, __chainDownload: true });
        } else {
            result = await cmd.execute(ctx.sock, ctx.msg, args, { ...ctx.brainExtra, __brainCall: true });
        }
    } catch (err) {
        clearPendingTerminal(chatId, name, args);
        console.error(`[JB-TOOL] ${name} (terminal) error:`, err.message);
        return { content: `Failed to complete ${name}: ${err.message}. Nothing was sent — let the user know it didn't work, don't claim success.`, terminal: false };
    }

    clearPendingTerminal(chatId, name, args);

    // Fail-safe default: if a command hasn't been updated to return a status
    // object at all (result is undefined/malformed), do NOT assume success —
    // treat it the same as an unconfirmed failure rather than lying to the
    // model. Only an explicit { ok: true } counts as a real send.
    const sentSomething = !!(result && result.ok === true);

    if (!sentSomething) {
        const reason = (result && result.reason) || 'unknown';
        const detail = (result && result.message) ? ` Detail: ${result.message}` : '';
        const askedAlready = reason === 'no_query' || reason === 'no_target';
        return {
            content: `${name} did NOT send anything to the user (reason: ${reason}).${detail} ` +
                      `Do not say you sent, downloaded, or found anything — nothing went out. ` +
                      (askedAlready
                        ? `The exact question the user needs to answer was ALREADY sent to them directly — do NOT ask it again ` +
                          `or repeat it in different words. Just close this turn with something short and natural (e.g. a quick ` +
                          `"for sure" / react to what they said) and wait for their next message; do not call this tool again ` +
                          `until they actually name something.`
                        : `Tell them plainly, in your own words, that it didn't work — don't repeat the exact wording of the message ` +
                          `already shown, just acknowledge the failure.`),
            terminal: false,
            askedAlready,
            toolName: name,
        };
    }

    // Track song titles/queries permanently (separate from summarized chat
    // history) so "the song" / "that track" still resolves correctly even
    // after this exchange has scrolled out of recent memory.
    if (SONG_RELATED_CMDS.has(def.cmd) && hasArgs(args)) {
        const jid = ctx.brainExtra?.from || ctx.msg?.key?.remoteJid;
        if (jid) memory.addSong(jid, args[0]);
    }

    const partialNote = result.reason === 'identified_only' && result.message ? ` Note: ${result.message}` : '';
    const autoFillNote = autoFilledFromGuess ? ` (auto-filled from the songguess match you two just confirmed: "${args[0]}")` : '';
    return {
        content: `Done — the ${name} result was already sent directly to the user in the chat.${partialNote}${autoFillNote} ` +
                  `Just acknowledge it briefly in your own words, don't repeat or describe the content in detail.` +
                  (partialNote ? ' Be honest that the download itself failed, since only the identify card went out.' : ''),
        terminal: true,
    };
}

module.exports = { runTool, getToolDef, TOOL_MAP, hasPending };
