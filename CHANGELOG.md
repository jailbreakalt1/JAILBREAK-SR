# Changelog

All notable changes to JAILBREAK-SR.

## [Unreleased]

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