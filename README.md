# JAILBREAK-SR — WhatsApp Bot

A feature-rich WhatsApp bot built with Baileys, featuring song/video/image downloads, group management, and distributed job processing via Jailbreak Orchestrator.

## Self-host (Termux / old phone / any box)

No shell environment or hosted services needed — a bare clone works:

```bash
git clone https://github.com/jailbreakalt1/JAILBREAK-SR.git
cd JAILBREAK-SR
npm i
cp .env.example .env      # paste your own API keys
npm start
```

Config is loaded automatically from `.env` at boot (`tools/dotEnv.js`) before
anything reads `process.env`, so nothing to export. `.env` is gitignored.

Media downloads route through the local **jailbreakdl** backend
(`git clone https://github.com/jailbreakalt1/downloader-backend`), which the
bot boots automatically on first start (`LOCAL_BACKEND_URL`,
`BACKEND_DIR` in `.env`). If it can't come up, the bot falls back to its own
yt-dlp.

## Features

- **Song Download** (`.song`, `.play`, `.music`) — Search YouTube, download MP3 via distributed workers
- **Video Download** (`.video`, `.ytv`, `.ytmp4`) — Download YouTube videos as MP4
- **Image Search** (`.img`, `.image`) — Artist photos or general image search
- **Group Management** — Welcome/goodbye, antilink, antiword, sudo allow/deny
- **Quota System** — Daily per-user limits via Jailbreak Orchestrator
- **Distributed Workers** — Offload downloads to separate worker processes

## Architecture

```
┌─────────────┐     HTTP API      ┌──────────────────┐     ┌─────────────┐
│  WhatsApp   │ ◄──────────────►  │ Jailbreak        │ ◄──► │  Worker 1   │
│    Bot      │  submit/poll      │ Orchestrator     │      │ (downloads) │
└─────────────┘                   │ (queue + quota)  │      └─────────────┘
                                  └──────────────────┘             ▲
                                                                     │
                                                                    ┌┴┐
                                                                    │ │
                                                                    ▼ ▼
                                                             ┌─────────────┐
                                                             │  Worker N   │
                                                             │ (downloads) │
                                                             └─────────────┘
```

The bot no longer downloads media directly. Instead:
1. Bot submits a job to the Orchestrator (`download-song`, `download-video`, `download-image`)
2. Orchestrator queues the job and enforces quota
3. Workers poll for jobs, execute downloads, store results
4. Bot polls for completion and sends the file to the user

## Quick Start

### 1. Configure Environment

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
# Edit .env with your tokens, IPs, etc.
```

Required variables:
- `ORCHESTRATOR_URL` — e.g., `http://your-server-ip:30202`
- `ORCHESTRATOR_TOKEN` — Shared secret from orchestrator config
- `ORCHESTRATOR_WORKER_ID` — Unique ID for this bot instance
- `ORCHESTRATOR_WORKER_CAPACITY` — How many concurrent jobs (default: 1)

### 2. Start the Orchestrator

On your orchestrator server:

```bash
cd jailbreak_orchestrator
PORT=30202 ORCHESTRATOR_TOKEN=your-secret-token DATABASE_PATH=./data/orchestrator.db node src/server.js
```

### 3. Start Workers

On each worker machine (can be same as orchestrator or different):

```bash
cd JAILBREAK-SR
ORCHESTRATOR_URL=http://orchestrator-ip:30202 ORCHESTRATOR_TOKEN=your-secret-token ORCHESTRATOR_WORKER_ID=worker-1 ORCHESTRATOR_WORKER_CAPACITY=2 node orchestrator-worker.js
```

### 4. Start the Bot

```bash
cd JAILBREAK-SR
npm start
```

## Commands

| Command | Aliases | Description |
|---------|---------|-------------|
| `.song <query>` | `.play`, `.music` | Download song as MP3 |
| `.video <query>` | `.ytv`, `.ytmp4`, `.ytvid` | Download YouTube video as MP4 |
| `.img <query>` | `.image`, `.images` | Search artist photos or images |

## Configuration

### Bot Config (`config.js` / `.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `ORCHESTRATOR_ENABLED` | `1` | Enable orchestrator integration |
| `ORCHESTRATOR_URL` | `http://localhost:30202` | Orchestrator API base URL |
| `ORCHESTRATOR_TOKEN` | `` | Shared secret for auth |
| `ORCHESTRATOR_WORKER_ID` | `bot-<random>` | Unique bot instance ID |
| `ORCHESTRATOR_WORKER_CAPACITY` | `1` | Max concurrent jobs for bot |
| `TIMEZONE` | `Africa/Harare` | Timezone for daily quota reset |

### Orchestrator Config (`jailbreak_orchestrator/src/config.js`)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `30202` | HTTP port |
| `ORCHESTRATOR_TOKEN` | `` | Shared secret (must match bot/workers) |
| `DAILY_QUOTA` | `10` | Daily requests per user |
| `MAX_GLOBAL_JOBS` | `3` | Max concurrent jobs globally |
| `MAX_JOBS_PER_WORKER` | `1` | Max concurrent jobs per worker |
| `WORKER_TIMEOUT_SECONDS` | `90` | Job lease timeout |
| `JOB_MAX_ATTEMPTS` | `3` | Retry attempts before failure |
| `QUOTA_FAILURE_POLICY` | `release` | `count` or `release` on failure |
| `TIMEZONE` | `Africa/Harare` | Quota reset timezone |

## API Endpoints (Orchestrator)

- `GET /health` — Health check
- `GET /api/status` — Queue/worker/quota status (auth required)
- `POST /api/workers/register` — Register worker (auth required)
- `POST /api/workers/heartbeat` — Worker heartbeat (auth required)
- `GET /api/jobs/poll` — Poll for assigned jobs (auth required)
- `POST /api/jobs/submit` — Submit new job (auth required)
- `POST /api/jobs/:id/start` — Mark job as running (auth required)
- `POST /api/jobs/:id/complete` — Mark job complete with result (auth required)
- `POST /api/jobs/:id/fail` — Mark job failed (auth required)
- `GET /api/jobs/:id` — Get job status/result (auth required)
- `POST /api/quota/check` — Check user quota (auth required)

## Worker Commands

The worker handles these job types:
- `download-song` — YouTube audio → MP3
- `download-video` — YouTube video → MP4
- `download-image` — Artist/image search → URLs

## Fallback Behavior

If the orchestrator is unavailable, commands fall back to local downloads using the original logic (EliteProTech, jailbreakdl, etc.).

## License

MIT