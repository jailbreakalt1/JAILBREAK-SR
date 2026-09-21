# JAILBREAK-SR — WhatsApp Bot

A feature-rich WhatsApp bot built with Baileys: AJ-driven replies, song/video
downloads, lyrics, weather, reminders, group tools — and its own local
downloader backend, all in one folder.

## Single-folder self-host (Termux / old phone / any box)

API keys are baked into `config.js`, so a bare clone runs with zero setup:

```bash
git clone https://github.com/jailbreakalt1/JAILBREAK-SR.git
cd JAILBREAK-SR
npm i
npm --prefix downloader-backend i          # local media backend deps
npm start
```

- The bot auto-boots `downloader-backend/` on first start (pings `/health`
  first) and routes every song/video through `http://127.0.0.1:30102`.
- If the backend won't start, the bot falls back to its own `bin/yt-dlp`.
- Optional overrides live in `.env` (loaded by `tools/dotEnv.js` at boot;
  see `.env.example`). Not needed — config defaults just work.

### Termux / ARM phone note

The backend ships x86_64 binaries in `bin/` that won't run on ARM. Use the
Termux native packages instead:

```bash
pkg install ffmpeg yt-dlp
export YTDLP_BINARY=yt-dlp
export FFMPEG_BINARY=ffmpeg
# then: npm --prefix downloader-backend start (or just npm start)
```

## Social links (Facebook / Instagram / TikTok / Pinterest)

Pasted social links are auto-downloaded (owner-only) — no prefix needed. The
bot auto-boots the vendored Python service in `JAILBREAK-MEDIA-BACKEND/` on
`http://127.0.0.1:8000` (first run creates its `.venv` and pip-installs
`fastapi uvicorn requests yt-dlp`). It runs as its own process alongside the
Node backend; `GET /api/health` confirms it's up.

- Comes with the clone — nothing extra to download on a blank phone.
- If Python/pip is missing the bot just logs it (non-fatal) and social links
  degrade to the Node backend (yt-dlp only) until Python is available.
- Optional Bearer auth: start the Python service with `MEDIA_BACKEND_TOKEN`
  set and mirror it in `.env` as `MEDIA_BACKEND_TOKEN`.
- Explicit command: `.instagram <url>` (`.ig`, `.insta`, `.reels`).

## Commands

**Media & songs**
| Command | Aliases | Description |
|---------|---------|-------------|
| `.song <query>` | `.play`, `.music` | Download song as audio |
| `.video <query>` | `.ytv`, `.ytmp4` | YouTube video as MP4 |
| `.lyrics <query>` | `.lyric` | Song lyrics (Genius) |
| `.find`, `.instagram` | `.ig`, `.reels` | Media links + social downloads |
| `.viewonce` | | View-once media save (owner) |

**Info & brains**
| Command | Aliases | Description |
|---------|---------|-------------|
| `.ai <msg>` | `.ask`, `.jb` | Straight to the brain |
| `.search <q>` | | Web search (Firecrawl) |
| `.img <q>` | `.image` | Image search |
| `.weather <city>` | `.w` | Weather |
| `.time` / `.date` | | Time/date context |
| `.wiki <topic>` | `.wikipedia`, `.wp` | Wikipedia summary |
| `.dict <word>` | `.dictionary`, `.define` | Dictionary |
| `.translate <code> <text>` | `.tr`, `.tl` | Google translate |
| `.ipinfo [ip]` | `.ip`, `.whereis` | IP / geo lookup |
| `.crypto <coin>` | | Live coin price |
| `.exchange <amt> <from> <to>` | | Live FX rates (ZWL too) |
| `.horo <sign>` | `.horoscope` | Daily horoscope |
| `.trivia` | | Random trivia question |
| `.quote` / `.fact` / `.joke` / `.riddle` | | Random wisdom / laughs |

**Utilities**
| Command | Aliases | Description |
|---------|---------|-------------|
| `.tts <text>` | | Text-to-speech voice note |
| `.sticker` | (with effects: `invert`, `bw`…) | Image/GIF → sticker |
| `.qr <text>` | | QR code |
| `.calc <expr>` | | Safe math calculator |
| `.base64 <encode\|decode> <text>` | `.b64` | Base64 |
| `.hash <text>` | | md5/sha1/sha256/sha512 |
| `.ping` | | Latency / uptime / RSS |
| `.npm <pkg>` | | npm package info |
| `.github <repo>` | | Repo info |

**Personal**
| Command | Aliases | Description |
|---------|---------|-------------|
| `.remind <min> <text>` | | Reminders (`list`/`cancel`) |
| `.note add\|list\|del\|clear` | | Private notes |
| `.todo add\|done\|del\|clear` | `.tasks` | To-do list |
| `.xp` / `.xptop` | | Activity points + leaderboard |
| `.birthday` | `.bday` | Set & get wished (`.setbirthday <date>`) |
| `.remember <k> <v>` | `.profile` | Remember facts about you |
| `.recap` | | Recent context recap |

**Group (admins)**
| Command | Aliases | Description |
|---------|---------|-------------|
| `.welcome on\|off [msg]` / `.goodbye` | | Custom join/leave messages (`@name`) |
| `.group promote\|demote\|kick\|add\|link\|revoke\|name\|desc\|open\|close\|tagall\|bye` | | Group admin toolkit |
| `.sudo allow <cmd>` | `.sallow` | Allow a command in this group |

**Owner**
| Command | Aliases | Description |
|---------|---------|-------------|
| `.ban <num>` / `.unban <num>` | | Bot-wide ban gate |
| `.restart` | | Restart cleanly (start.sh auto-respawns) |

## Config

Center of truth is `config.js` — baked API keys, owner numbers
(`OWNER_NUMBERS`), prefix, model slots, quiet hours
(`config.quiet`), XP (`config.xp`), STT (`config.stt`), conversation context
window (`config.memory` — how many turns JB keeps verbatim vs. folds into an
AI summary). Anything can be overridden without touching code via the matching
var in `.env`.

## Autonomy ("friend mode")

JB is not a vending machine. Two layers of self-initiative make it act like a friend:

1. **In-conversation** (`brain/persona.js` + `brain/ai.js`): on emotional beats in DMs it proactively
   fires a song without being asked — apology → "Sorry", rough day/stress → a comfort track,
   celebration/win → a hype track. Nudge-only, groups excluded, one terminal tool per turn.
2. **Out-of-band** (`brain/checkIn.js`): when a DM partner has been quiet past
   `checkIn.thresholdHours`, a scheduler (every `checkIn.intervalMinutes`) opens an initiative window
   and lets the FULL tool-capable brain act on its own — send a song, fetch live data, or just a short line.
   Guarded by: DMs only, quiet hours, a `checkIn.cooldownHours` gap, one send per cycle, a global
   `checkIn.dailyCeil` per day, and a 75s timeout. Results are saved to memory so replies continue the thread.

## Git hygiene

Tracked by the repo: bot + backend source, `.env.example`, yt-dlp POT plugins.
Gitignored (stays on your box): `.env`, `session/`, `temp/`, `database/`,
backend `cookies*.txt`, `node_modules/`, large `bin/` binaries, all `.log`s.

## License

MIT