function listFromEnv(name, fallback = []) {
    return (process.env[name] || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .concat(fallback)
        .filter((item, index, all) => all.indexOf(item) === index);
}

const config = {
    ownerNumber: listFromEnv('OWNER_NUMBERS', ['263717456159', '263738104222']),
    ownerName:   listFromEnv('OWNER_NAMES', ['JB_AI-SR', 'JAILBREAK-DEVELOPER']),
    botName:     process.env.BOT_NAME     || 'JAILBREAK-SR',
    prefix:      process.env.PREFIX       || '.',
    sessionName: process.env.SESSION_NAME || 'session',
    sessionID:   process.env.SESSION_ID   || '',
    newsletterJid: process.env.NEWSLETTER_JID || '',
    timezone:    process.env.TIMEZONE     || 'Africa/Harare',
    // City name shown in JB's time context — independent of timezone code above.
    // Africa/Harare is the correct IANA name; displayCity is just what JB says.
    displayCity: process.env.DISPLAY_CITY  || 'Kwekwe',
    updateZipUrl: process.env.UPDATE_ZIP_URL || 'https://github.com/jailbreakalt1/JAILBREAK-SR/archive/refs/heads/main.zip',
    // ── Local downloader backend (jailbreakdl) ────────────────────────────────
    // Route all song/video downloads through this on 127.0.0.1 instead of
    // hosted APIs. Nothing to do here — the bot boots it automatically from
    // BACKEND_DIR (default: `../downloader-backend` next to this repo, then
    // ~/Documents/downloader-backend, then /root/Documents/downloader-backend).
    // Override the URL/dir via .env if you run it elsewhere or another machine.
    localBackend: {
        baseUrl: (process.env.LOCAL_BACKEND_URL || 'http://127.0.0.1:30102').replace(/\/+$/, ''),
        dir:     process.env.BACKEND_DIR || '',
    },
    // ── Vendored Python media backend (JAILBREAK-MEDIA-BACKEND) ──────────────
    // Separate service for Facebook/Instagram/TikTok/Pinterest. Comes with the
    // repo (JAILBREAK-MEDIA-BACKEND/) but runs as its own process on :8000 —
    // the bot auto-boots it at start (tools/ensureMediaBackend.js) if it's
    // down. Bearer only required if you set MEDIA_BACKEND_TOKEN on that side.
    mediaBackend: {
        baseUrl: (process.env.MEDIA_BACKEND_URL || 'http://127.0.0.1:8000').replace(/\/+$/, ''),
        port:    parseInt(process.env.MEDIA_BACKEND_PORT, 10) || 8000,
        token:   process.env.MEDIA_BACKEND_TOKEN || '',
        dir:     process.env.MEDIA_BACKEND_DIR || '',
    },
    autoRead: false,
    autoBio:  false,

    messages: {
        ownerOnly:      '⫸YEAAAA I Don Know U FAM 😒⫷',
        botAdminNeeded: '⫸JAILBREAK MUST BE AN ADMIN 1ST',
    },

    spam: {
        duplicateCooldown: 60,
        perUserLimit:      5,
        perUserWindow:     120,
        globalLimit:       30,
        globalWindow:      60,
        maxWarnings:       3,
    },

    // ── Weather — OpenWeatherMap ───────────────────────────────────────────────
    // Free key from https://openweathermap.org/api → override via OPEN_WEATHER_API
    weather: {
        apiKey: process.env.OPEN_WEATHER_API || '4902c0f2550f58298ad4146a92b65e10',
    },


    // ── Web Search — Firecrawl ────────────────────────────────────────────────
    // Search costs 1 credit per result. At limit:5 → ~200 searches/month free.
    // Override via FIRECRAWL_API_KEY.
    firecrawl: {
        apiKey: process.env.FIRECRAWL_API_KEY || 'fc-7ef376c781ab4b1088b87af3c84120b3',
        limit:  parseInt(process.env.FIRECRAWL_LIMIT, 10) || 5,
    },
    // Genius lyrics — override the three via GENIUS_* env vars.
    genius: {
        clientAccessToken: process.env.GENIUS_ACCESS_TOKEN || 'r_0eyQ2ropDyGqztpRZ_38rnUsO6Zw3LqCi_e7Ch4Ncz6N-ozkTRaF-Siz0kAOur',
        clientId:          process.env.GENIUS_CLIENT_ID    || 'i-gjcga_WIhgqdWjqK3ICcQ9yzva8vM3rRMbhz5CZZo05oSIKSpN4DtDhhio_8Jm',
        clientSecret:      process.env.GENIUS_CLIENT_SECRET || 'n4zkk34fd-6tIn-XAjcZqwkcXydoz_FS-8fKxIF3ov22GKjAu4HusUCkERTMVx9Nm7dOSAr3ehg1EkvtQTTqCA',
    },

    // ── AI Brain — model SLOTS (NVIDIA NIM) ─────────────────────────────────
    // JB tries these in order every time it thinks: SLOT C → SLOT A → SLOT B.
    // The console always tags which one ran or failed, e.g.:
    //   [JB-BRAIN] slot C rescue: nvidia/nemotron-3-super-120b-a12b
    //   [JB-BRAIN] slot A ...
    //   [JB-BRAIN] slot B: deepseek-ai/deepseek-v4-flash-0731
    // To swap a model, just edit the matching field below — the slot letter
    // in your console output always matches the field name here.
    // Get your key at https://build.nvidia.com → override via NVIDIA_API_KEY
    nvidia: {
        apiKey: process.env.NVIDIA_API_KEY || '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',
        // Key 1 — powers SLOT A and SLOT C below

        // ── SLOT A — primary brain, tried 2nd (bonus-quality attempt) ──
        // NOTE: meta/llama-3.1-8b-instruct reached end of life on NVIDIA
        // (removed 2026-08-26, now 410s). DiffusionGemma is the live
        // tool-calling model on key 1 — using it here also resolves the old
        // "vision:true" metadata wart (DiffusionGemma really is vision-capable).
        // Fast tier candidates to try on a calmer network: google/gemma-4-31b-it,
        // z-ai/glm-5.3-flash, nvidia/nemotron-3.5-lightning-30b-a3b.
        modelSlotA: process.env.NVIDIA_MODEL || 'google/diffusiongemma-26b-a4b-it',

        // ── SLOT C — rescue brain, tried 1st (main path — decides/calls tools first) ──
        // Nemotron-3-Super-120B-a12b (verified live ~2.2s tool calls) replaced
        // DiffusionGemma as the fast+reliable slot — Gemini's DiffusionGemma was
        // slower (1.9–15.7s) and varies wildly. Super ran as fast as 1.1s and
        // picks the right tool with thinking disabled.
        modelSlotC: process.env.NVIDIA_SLOT_C_MODEL || 'nvidia/nemotron-3-super-120b-a12b',
    },

    // ── Quiet hours ──────────────────────────────────────────────────────────
    // Bot stays proactive (check-ins, reminders, auto-messages) SILENT during
    // this window — it still answers when YOU message it.
    quiet: {
        start: parseInt(process.env.QUIET_START, 10) || 22, // 24h local clock
        end:   parseInt(process.env.QUIET_END,   10) || 6,
    },

    // ── XP / levels / streaks ────────────────────────────────────────────────
    xp: {
        enabled: process.env.XP_ENABLED !== 'false', // earned on human messages
    },

    // ── Voice-note transcription (STT) ───────────────────────────────────────
    // Tries the omni vision model to transcribe ptt voice notes before music
    // detection. Circuit-breaks after repeated failures so it never hangs the
    // message loop on an unsupported endpoint.
    stt: {
        enabled: process.env.STT_ENABLED !== 'false',
        timeoutMs: 15000,
    },

    // ── AI Eyes + memory summariser (NVIDIA NIM, OpenAI SDK) ──────────────
    // Separate key from above — used for:
    //   • SLOT B — fallback text brain, tried last (brain/ai.js)
    //   • vision replies when an image is sent (brain/visionAi.js)
    //   • background memory summarisation (brain/memory.js)
    nvidiaMedia: {
        apiKey: process.env.NVIDIA_MEDIA_API_KEY || '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',
        // Key 2 — powers SLOT B below, plus vision + summary models

        // ── SLOT B — fallback brain, tried last (best reasoning, 1M ctx) ──
        // deepseek-v4-pro was removed from the catalog; the live DeepSeek is
        // deepseek-v4-flash-0731.
        modelSlotB: process.env.NVIDIA_FALLBACK_MODEL || 'deepseek-ai/deepseek-v4-flash-0731',

        // Vision model — image/video/audio understanding (separate pipeline, not lettered)
        model:  process.env.NVIDIA_MEDIA_MODEL   || 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
        // Memory summarisation model (separate pipeline, not lettered)
        summaryModel: process.env.NVIDIA_SUMMARY_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b',
    },


    // ── Autonomous check-in ("miss you" feature) ──────────────────────────────
    // JB proactively messages DM users who haven't chatted in a while.
    // thresholdHours: how long quiet before JB checks in
    // cooldownHours:  minimum gap between two check-ins to the same person
    checkIn: {
        enabled:        process.env.CHECKIN_ENABLED !== 'false',
        thresholdHours: parseInt(process.env.CHECKIN_THRESHOLD_HOURS, 10) || 24,
        cooldownHours:  parseInt(process.env.CHECKIN_COOLDOWN_HOURS,  10) || 48,
    },
    // AI access control
    ai: {
        // 'all' = everyone, 'owner' = owner only
        access: process.env.AI_ACCESS || 'all',
    },
};

config.getConfigFromSocket = function getConfigFromSocket() {
    return config;
};

module.exports = config;