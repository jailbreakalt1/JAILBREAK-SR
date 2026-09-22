# Changelog

All notable changes to JAILBREAK-SR.

## [Unreleased]

### Fixed — autonomy scheduler never fired (spammed errors on its own bookkeeping keys)
- **Bug** (observed live, `[AUTONOMY] _day quiet 497245h — opening an initiative window` → `[AUTONOMY] failed: Cannot destructure property 'user' of 'jidDecode(...)`): the daily-budget bookkeeping keys `_day`/`_sends` live in the same `database/checkInLastSeen.json` map as real contacts, and `runChecks()` iterated **every** key as if it were a WhatsApp JID. So each cycle it opened initiative windows for `_day`/`_sends`, crashed on `jidDecode`, and the owner (still active, under the 12h threshold — intentional) never got one. "Never once" was both bug-spam *and* correct restraint on an active user.
- **Fix** in `brain/checkIn.js`: `runChecks()` now skips `_`-prefixed bookkeeping keys, non-JID tokens, groups, and malformed entries before considering a window. Real contacts are unaffected.
- Verified against the live DB: `_day`/`_sends` skipped, owner remains the only candidate (quiet 4h ≈ below threshold → no spurious proactive messages).

### Fixed — "Yea" completion + delivery-promise acks never delivered the song
- **Bug** (observed live): request chain `"Get me Kuhope"` → clarify → bot *"Here's Fusion 5 Mangwiro's "Kuhope" — … Sending it now."* → user `"Yea"` → **nothing was ever sent**. The classifier needs a fetch verb, "Yea" isn't in the bare-directive list (only `yes/yeah/yep/yup`), and the prior ack names a title with only a *delivery promise* — no "song/music/video" word — so the history resolver skipped it.
- **Fix** in `brain/ai.js`: `yea` added to `BARE_DIRECTIVE_RE`; new `DELIVERY_PROMISE_RE` ("sending it now", "here you go", "coming up", …) lets the history resolver treat such acks as a real send; `titleFromMediaLine()` now resolves `"Artist's "Title""` possessives deterministically (→ `"Kuhope Fusion 5 Mangwiro"`) so the forced query hits the *right* version, and it never misreads casual chat ("sweet dreams", "no problem — done") as a title.
- Verified: 8/8 unit cases + owner-jid E2E on the exact exchange — `"Yea"` nudges once then fires `song("Kuhope Fusion 5 Mangwiro")` and delivers. Boot sweep 58/0.

### Fixed — double artist in document filenames ("Nisha Ts - Nisha Ts - Ndiwe Here")
- **Bug**: YouTube titles already carry the artist prefix ("Nisha Ts - Ndiwe Here"), and `song`/`find` built filenames as `${artist} - ${title}` — so the delivered document was "Nisha Ts - Nisha Ts - Ndiwe Here.mp3".
- **Fix**: new `buildFileName(author, title, ext)` in `cmd/song.js` strips a leading artist prefix (any `- – — : |` separator, case-insensitive) from the title before re-attaching the artist; used by both `song.js` and `find.js`. Verified 8/8 filename cases.

### Fixed — "As a song" / medium clarifiers never triggered the tool
- **Bug** (observed live): user sent `"Nisha ts ndiwe here"` → model acked with the exact title (`"Nisha Ts Ndiwe Here — got it. One sec, pulling it up."`) → user clarified `"As a song"` → **still nothing fired**. The clarifier carries a kind but no title, the title lives in the prior turns, and neither the verb-based classifier nor the bare-directive resolver (`send it`…) could join them — so the whole request died as chat.
- **Fix**: new `mediumClarifierIntent()` in `brain/ai.js`. When the current turn is a pure medium clarifier ("as a song/video/lyrics", "i meant lyrics", "the song", …), it pairs the kind with the title from the immediately-prior turns — from the assistant's ack when it actually separates title from a chat ack (`title — got it / one sec / pulling it up`), or from the preceding user request. Priority in the net: in-turn forceable intent → bare directive → **medium clarifier** → fuzzy nudge-only. Titles are only trusted when genuinely title-like (quoted / "(Official …)" / dashed ack) so plain chat replies ("sweet dreams") never become search queries.
- Verified: 9/9 unit cases + owner-jid E2E on the exact live exchange — `"As a song"` fires `song("Nisha Ts Ndiwe Here")` and delivers. Boot sweep 58/0.

### Fixed — "Send it" / bare directives never fired the tool
- **Bug** (observed live): after a search had just identified a video, the owner's "Gimme" / "Send it" turns produced *text only* — no `video` tool call, no download, nothing sent. Cause: `toolIntentFor` rejects the bare imperative ("send" is a weak verb, tail is "it" → vague → null) and neither the user message nor the reply carried a title, so the intent net saw `null` and shrugged.
- **Fix**: new `mediaIntentFromHistory()` in `brain/ai.js` — when the user sends a **bare directive** ("send it", "gimme", "do it", "yes", "it", "that") and the *previous assistant turn* in memory named a medium (video/song/lyrics), the concrete title is resolved from history and fed through the existing nudge→force pipeline. Known-songs list is the fallback for "the song / it".
- **Priority**: a forceable user/reply intent wins; otherwise the concrete history-resolved intent beats a fuzzy nudge-only reply intent (so the nudge never carries a garbage query from the model's clarifying question).
- Verified: 7/7 unit cases + owner-jid E2E — "Send it" fires `video("Julian King Handiyide…")` and delivers.

### Added — wider conversation context window
- **`config.memory`** (env-overridable: `MEMORY_MAX_TURNS`, `MEMORY_SUMMARIZE_THRESHOLD`, `MEMORY_KEEP_RECENT`): JB's long-term memory shape is now config-driven instead of baked-in constants.
- **Defaults roughly doubled**: hard cap `maxTurns` 40→**64**, AI-summary fold threshold `summarizeThreshold` 25→**40**, verbatim-recent window `keepRecent` 20→**30**. A long chat now keeps 30 real turns word-for-word (was 20) plus the AI-condensed summary — that's 50% more vivid recall at trivial cost (all models have 128K–1M native context).
- **Rescue slot window doubled**: `ai.js` slot C now pastes the last `SLOTC_HISTORY_TURNS` = **16** history turns (was 8) so rescue rounds keep up with the wider memory, still cheap/fast.

### Added — agentic autonomy ("friend mode")
- **In-conversation initiative**: new `AUTONOMY (FRIEND-INITIATIVE)` persona section + `agenticSignalFor()` classifier in `brain/ai.js`. In DMs, JB now takes the wheel on emotional beats — someone apologizes → it proactively calls the `song` tool with "Sorry" and gifts them the track; rough day/stress → one chill comfort track; celebration/win → a hype track. Nudge-only (never forced), groups excluded, one terminal tool per turn.
- **Out-of-band initiative engine** (`brain/checkIn.js` rewritten): after a DM is quiet past `thresholdHours`, a scheduler opens an initiative **window** (every `intervalMinutes`) and lets the FULL tool-capable brain decide — fire a real tool (send a song, fetch weather, etc.) or just a short line. Implements the "actually agentic" tier: the model owns the judgement, not a canned script. Saved to memory so the next user message continues the thread.
- **Guardrails**: DMs only, quiet hours respected, 24h→12h threshold / 48h→24h cooldown gates, ONE initiative per cycle, global `dailyCeil` (2/day) persisted with day reset, 75s timeout so a flaky model can't wedge the scheduler.
- **Config**: `checkIn.intervalMinutes` (20) + `checkIn.dailyCeil` (2); `CHECKIN_THRESHOLD_HOURS`/`CHECKIN_COOLDOWN_HOURS` env defaults relaxed.
- **Wiring**: `handler.js` passes the command registry so autonomous turns have real tools; `ai.js` skips research-intent and deterministic-force nets during autonomous turns (they'd misfire on the note itself).

### Added — big feature batch (36 commands)
- **Fun/instant**: `.joke`, `.fact`, `.quote`, `.riddle`, `.8ball`, `.advice`, `.trivia`, `.horo` (daily horoscope)
- **Knowledge**: `.translate` (Google, keyless), `.dict` (dictionaryapi.dev + Wikipedia fallback), `.wiki` (with UA fix), `.ipinfo` (ipwho.is)
- **Math/code**: `.calc` (whitelisted safe eval), `.base64`, `.hash` (md5/sha1/sha256/sha512)
- **Crypto/fx**: `.crypto` (live coin prices), `.exchange` (live FX incl. ZWL)
- **Media**: `.qr` (PNG), `.tts` (voice notes via brain/tts), `.sticker` (ffmpeg webp + effects invert/bw/grayscale/blur), `.ping`
- **Dev**: `.github`, `.npm`
- **Group admin**: `.welcome` / `.goodbye` (custom messages, `@name` placeholder), `.group` family (promote/demote/kick/add/link/revoke/name/desc/open/close/tagall/bye)
- **Personal**: `.remember`/`.profile`, `.note`, `.todo`, `.recap`, `.xp`, `.xptop`, `.ban`/`.unban` (bot-wide), `.restart`, `.birthday` (set + auto-wish)
- **Reminders rewritten**: direct `.remind <min> <text>` + `list`/`cancel`, quiet-hour deferral
- **XP system**: 1 pt/min per user activity, level curve, leaderboard (`tools/xp.js`, `config.xp`)
- **Birthday wishes**: `tools/celebrate.js`, fired once/day from handler
- **Bot-wide blacklist**: `tools/blacklist.js` ban gate in handler (owner bypass)
- **Voice-note STT**: `brain/stt.js` — ptt → transcript → brain reply + voice answer, with circuit breaker + fallback to auto-shazam
- **Brain upgrades**: 18 new data tools in `toolDefs.js`; per-turn data-tool result cache (`CACHEABLE_DATA_TOOLS`); quiet-hour check-in skip
- **Robustness**: handler catch now replies friendly; `index.js` RSS/heap heartbeat; `start.sh` adds `--max-semi-space-size=32` heap tuning
- **Docs**: expanded README command tables; this CHANGELOG

### Fixed
- `cmd/group.js` nested-backtick syntax crash
- `brain/toolDefs.js` horo/translate escape + unbalanced-brace crash on exchange tool
- `cmd/remind.js` legacy tool-only usage
- `cmd/sticker.js` wrong tempManager API (`createTempFile` → `createTempFilePath`)
- `cmd/translate.js` dropping `to` target when the model passes `{text, to}`
- `cmd/base64.js` no longer returns usage for bare text — defaults to encode
- `cmd/ipinfo.js` joined its array too early (`lines.join is not a function`); swapped hostile IP APIs for ipwho.is
- `cmd/wiki.js` 403 → added proper `User-Agent`
- `cmd/horo.js` aztro API is dead → horoscope-app-api + fixed field name
- `cmd/dict.js` flaky upstream → Wikipedia intro fallback
- `cmd/todo.js` non-numeric `done`/`del` → text-match + sane errors
- `tools/celebrate.js` broadened date parsing (ISO + "May 10" formats)
- alias collisions: removed `google` (search.js) and `forget` (ai.js has it — `.remember <key>` alone now deletes)