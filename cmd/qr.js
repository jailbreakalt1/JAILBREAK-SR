/**
 * cmd/qr.js
 *
 * Generate a QR code image via qrserver.com (free) and send it.
 * Sends media directly — terminal-style command.
 */

const axios = require('axios');

module.exports = {
    name: 'qr',
    aliases: ['qrcode'],
    category: 'utility',
    description: 'Make a QR code from text/URL.',
    usage: '<text or link>',

    async execute(sock, msg, args, extra = {}) {
        const chatId = extra.from || msg.key.remoteJid;
        const data = args.join(' ').trim();

        if (!data) {
            const ask = 'give me something to encode, like `.qr https://example.com`';
            if (extra.__brainCall) return { summary: ask };
            await extra.reply?.(ask);
            return { ok: true, summary: ask };
        }

        try {
            const { data: image } = await axios.get('https://api.qrserver.com/v1/create-qr-code/', {
                params: { size: '512x512', data },
                responseType: 'arraybuffer',
                timeout: 15000,
            });
            await sock.sendMessage(chatId, { image, mimetype: 'image/png' }, { quoted: msg });
            return { ok: true, summary: 'QR code image sent to the user.' };
        } catch (err) {
            const note = `couldn't make that QR — ${err.message}`;
            if (extra.__brainCall) return { summary: note };
            await extra.reply?.(note);
            return { ok: false, reason: 'qr_failed', message: err.message };
        }
    },
};