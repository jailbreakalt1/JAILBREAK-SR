function listFromEnv(name, fallback = []) {
    return (process.env[name] || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .concat(fallback)
        .filter((item, index, all) => all.indexOf(item) === index);
}

const config = {
    ownerNumber: listFromEnv('263738104222', ['263717456159']),
    ownerName: listFromEnv('JB_AI-SR', ['JAILBREAK-DEVELOPER']),
    botName: process.env.BOT_NAME || 'JAILBREAK-SR',
    prefix: process.env.PREFIX || '.',
    sessionName: process.env.SESSION_NAME || 'session',
    sessionID: process.env.SESSION_ID || '',
    newsletterJid: process.env.NEWSLETTER_JID || '',
    timezone: process.env.TIMEZONE || 'Africa/Harare',
    autoRead: false,
    autoBio: false,

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
        perUserWindow:120,
        globalLimit: 30,
        globalWindow: 60,
        maxWarnings: 3,
    }
};

config.getConfigFromSocket = function getConfigFromSocket() {
    return config;
};

module.exports = config;
