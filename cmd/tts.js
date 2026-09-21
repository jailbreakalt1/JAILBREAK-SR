/**
 * cmd/tts.js
 *
 * Turn text into a voice note on demand (edge-tts, free).
 * Direct command only — wraps brain/tts.generateAudio.
 */

const tts = require('../brain/tts');

const MAX_CHARS = 400;

module.exports = {
    name: 'tts',
    aliases: ['speak', 'say'],
    category: 'utility',
    description: 'Convert text to a voice note.',
    usage: '<text>',

    async execute(sock, msg, args, extra = {}) {
        const chatId = extra.from || msg.key.remoteJid;
        const text = args.join(' ').trim();

        if (!text) {
            const ask = 'give me text to say, like `.tts hi there, what\u2019s good`';
            await extra.reply?.(ask);
            return { ok: true, summary: ask };
        }
        if (text.length > MAX_CHARS) {
            const note = `that text is ${text.length} chars — keep it under ${MAX_CHARS} and I\u2019ll say it.`;
            await extra.reply?.(note);
            return { ok: true, summary: note };
        }

        try {
            const audio = await tts.generateAudio(text);
            await sock.sendMessage(chatId, {
                audio,
                mimetype: 'audio/ogg; codecs=opus',
                ptt: true,
            }, { quoted: msg });
            console.log(`[CMD-TTS] said ${text.length} chars to ${chatId}`);
            return { ok: true, summary: 'Voice note sent to the user.' };
        } catch (err) {
            const note = `voice synth failed — ${err.message}`;
            await extra.reply?.(note);
            return { ok: false, reason: 'tts_failed', message: err.message };
        }
    },
};