function listFromEnv(name, fallback = []) {
    return (process.env[name] || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .concat(fallback)
        .filter((item, index, all) => all.indexOf(item) === index);
}

const config = {
    ownerNumber: listFromEnv('OWNER_NUMBER', ['263738104222', '263717456159', '263788815751', '263779414842']),
    ownerName: listFromEnv('OWNER_NAME', ['JB_AI-SR', 'JAILBREAK-DEVELOPER']),

    botName: process.env.BOT_NAME || 'JAILBREAK-SR',
    prefix: process.env.PREFIX || '.',
    sessionName: process.env.SESSION_NAME || 'session',
    sessionID: process.env.SESSION_ID || '',
    newsletterJid: process.env.NEWSLETTER_JID || '',
    timezone: process.env.TIMEZONE || 'Africa/Harare',
    updateZipUrl: process.env.UPDATE_ZIP_URL || 'https://github.com/jailbreakalt1/JAILBREAK-SR/archive/refs/heads/main.zip',
    autoRead: false,
    autoBio: false,
    mode: process.env.MODE || 'owner',

    // Dedicated media download backend (Instagram/Pinterest/TikTok/Facebook).
    // Standalone service: JAILBREAK-MEDIA-BACKEND (hosted on Render/Vercel).
    mediaBackend: {
        url: process.env.MEDIA_BACKEND_URL || 'http://127.0.0.1:3000',
        token: process.env.MEDIA_BACKEND_TOKEN || '',
    },

    // InstaGapi — free Instagram API (30 req/mo), sign up at instagapi.com.
    // Used by the media backend as an optional Instagram fallback.
    // Set key via env var: INSTAGAPI_KEY
    instagapi: {
        apiKey: process.env.INSTAGAPI_KEY || '',
    },

    messages: {
        wait: '⫎COMPUTING 🤖⧯',
        success: '◈U WELCOME 🥱⧯',
        error: '⫎ ERROR 💀⧯',
        ownerOnly: '⫎YEAAAA I Don Know U FAM 😒⧯',
        adminOnly: '⫎YEAAA UR NOT AN ADMIN FAM 🥱⧯',
        groupOnly: '⫎THIS IS MEANT FOR GROUPS GENIUS😒⧯',
        privateOnly: '⫎I DONN LIKE CROWDS 😳 *MAYBE* DM◈',
        botAdminNeeded: '⫎JAILBREAK MUST BE AN ADMIN 1ST',
        invalidCommand: '❓FAAAAHHHHHHHHHHHHH⫎'
    },
    spam: {
        duplicateCooldown: 60,
        perUserLimit: 5,
        perUserWindow: 120,
        globalLimit: 30,
        globalWindow: 60,
        maxWarnings: 3,
    },

    // Genius API — get yours at https://genius.com/api-clients.
    // Secrets come from env vars, never from the repo.
    genius: {
        clientAccessToken: process.env.GENIUS_ACCESS_TOKEN || 'r_0eyQ2ropDyGqztpRZ_38rnUsO6Zw3LqCi_e7Ch4Ncz6N-ozkTRaF-Siz0kAOur',
        clientId:          process.env.GENIUS_CLIENT_ID    || 'i-gjcga_WIhgqdWjqK3ICcQ9yzva8vM3rRMbhz5CZZo05oSIKSpN4DtDhhio_8Jm',
        clientSecret:      process.env.GENIUS_CLIENT_SECRET || 'n4zkk34fd-6tIn-XAjcZqwkcXydoz_FS-8fKxIF3ov22GKjAu4HusUCkERTMVx9Nm7dOSAr3ehg1EkvtQTTqCA',
    }
};

config.getConfigFromSocket = function getConfigFromSocket() {
    return config;
};

module.exports = config;