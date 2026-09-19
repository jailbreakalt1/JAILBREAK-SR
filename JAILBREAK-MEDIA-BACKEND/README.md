# JAILBREAK MEDIA BACKEND

Dedicated media download backend for Pinterest, Instagram, TikTok, and Facebook.

**100% Python** — FastAPI + **yt-dlp** (the battle-tested downloader) as the primary
provider, with pure-Python scrape/API fallbacks behind it. Deployable as its own
service on Render or Vercel.

## Endpoints

| Method | Path                          | Description                              |
| ------ | ----------------------------- | ---------------------------------------- |
| GET    | `/api/health`                 | Service status + supported platforms     |
| GET/POST | `/api/download/:platform?url=` | Returns `{ ok, platform, data: [...] }` |

Response shape for each item in `data`:

```json
{ "url": "https://...", "type": "video|image", "thumbnail": false }
```

Example:

```bash
curl "http://localhost:8000/api/download/pinterest?url=https://www.pinterest.com/pin/123/"
```

## Local dev

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --reload        # http://localhost:8000
```

## Env vars

| Var                  | Default          | Notes                                  |
| -------------------- | ---------------- | -------------------------------------- |
| `MEDIA_BACKEND_TOKEN` | *(none)*         | If set, all `/api/*` calls need `Authorization: Bearer <token>` |
| `INSTAGAPI_KEY`      | *(none)*         | Optional Instagram last-resort fallback (30 free req/mo) |
| `LOG_REQUEST`        | `0`              | Set to `1` to log every request        |
| `NETWORK_TIMEOUT`    | `25`             | Per-provider HTTP/network timeout (s)  |

A `cookies.txt` (Netscape format) placed in this folder is passed automatically
to yt-dlp — required for locked-down Instagram / Facebook content.

## Deploy on Render

1. Push this folder to GitHub.
2. Render → New → Web Service → pick the repo.
3. Runtime: **Python**. Build command: `pip install -r requirements.txt`.
   Start command: `bash -c "uvicorn app:app --host 0.0.0.0 --port $PORT"` (a
   `Procfile` with the same start command is included, so clicking "Use
   Procfile" or default detection also works).
4. Set env vars (`MEDIA_BACKEND_TOKEN`, `INSTAGAPI_KEY`) in the dashboard.

## Deploy on Vercel

Vercel auto-detects FastAPI when it finds a top-level `app` FastAPI instance —
`app.py` in this project is exactly that. No framework config needed.

```bash
npm i -g vercel
vercel        # deploy
vercel --prod
```

The included `vercel.json` bumps the function `maxDuration` to 60s. Vercel
serverless functions still time out below yt-dlp's slower cases — a paid plan
with extended duration, or Render, is recommended if you hit timeouts.

## Bot wiring (JAILBREAK-SR)

In the bot, `tools/mediaDownloader.js` reads:

```
MEDIA_BACKEND_URL=http://127.0.0.1:8000   # or https://your-backend.onrender.com
MEDIA_BACKEND_TOKEN=...                    # optional
```

## Fallback chains per platform

Each platform tries providers in order until one returns media:

- **instagram**: yt-dlp → imginn.com scrape → siputzx API → InstaGapi (optional)
- **pinterest**: yt-dlp → siputzx API → pin-page scrape
- **tiktok**: yt-dlp → siputzx API → TikTok page sniff
- **facebook**: yt-dlp → ryzendesu fbdown → eliteprotech fbdown