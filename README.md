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

## Commands

| Command | Aliases | Description |
|---------|---------|-------------|
| `.song <query>` | `.play`, `.music` | Download song as audio |
| `.video <query>` | `.ytv`, `.ytmp4` | Download YouTube video as MP4 |
| `.lyrics <query>` | `.lyric` | Song lyrics (Genius) |
| `.weather <city>` | `.w` | Weather (OpenWeatherMap) |
| `.ai <msg>` | `.ask`, `.jb` | Straight to the brain |
| `.search <q>` | | Web search (Firecrawl) |
| `.img <q>` | `.image` | Image search |
| `.time` | | Time/date context |
| `.remind <claim>` | | Reminders |
| `.spy <claim>` | | Address/city lookup |
| `.find`, `.instagram`, `.viewonce`, `.songguess` | | Media + games |

## Config

Center of truth is `config.js` — baked API keys, owner numbers
(`OWNER_NUMBERS`), prefix, model slots, check-in/anti-spam tuning. Anything can
be overridden without touching code via the matching var in `.env`.

## Git hygiene

Tracked by the repo: bot + backend source, `.env.example`, yt-dlp POT plugins.
Gitignored (stays on your box): `.env`, `session/`, `temp/`, `database/`,
backend `cookies*.txt`, `node_modules/`, large `bin/` binaries, all `.log`s.

## License

MIT