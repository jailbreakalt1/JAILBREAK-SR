/**
 * brain/stt.js
 *
 * Voice-note transcription (speech-to-text) for ptt audio messages, using
 * the omni vision model (Nemotron 3 Nano Omni — audio capable, key 2).
 *
 * Safety: if the endpoint rejects audio (unsupported input, auth, network),
 * we trip a circuit breaker and disable STT for the rest of the process —
 * the handler then falls back to the existing auto-shazam path, so a flaky
 * STT never breaks voice-message handling.
 */

const config   = require('../config');
const { MODELS, hasKey2 } = require('./modelRegistry');
const { getClient } = require('./nimClient');

let disabled = false;

function formatOf(mimetype) {
    const m = String(mimetype || '').toLowerCase();
    if (m.includes('ogg')) return 'ogg';
    if (m.includes('wav')) return 'wav';
    if (m.includes('amr')) return 'amr';
    if (m.includes('flac')) return 'flac';
    if (m.includes('m4a') || m.includes('mp4') || m.includes('aac')) return 'm4a';
    return 'mp3';
}

/**
 * Transcribe a voice-note buffer. Returns the transcript string, or null when
 * the audio has no speech (music), STT is off, or transcription failed.
 */
async function transcribe(buffer, mimetype = '') {
    if (disabled || !config.stt?.enabled) return null;
    if (!hasKey2()) return null;

    const client = getClient(MODELS.VISION_PRIMARY.key());
    if (!client) return null;

    try {
        const completion = await Promise.race([
            client.chat.completions.create({
                model: MODELS.VISION_PRIMARY.id(),
                messages: [{
                    role: 'user',
                    content: [
                        {
                            type: 'input_audio',
                            input_audio: {
                                data: buffer.toString('base64'),
                                format: formatOf(mimetype),
                            },
                        },
                        { type: 'text', text: 'Transcribe this audio exactly as spoken. If it is music, singing or contains no speech, reply with exactly MUSIC.' },
                    ],
                }],
                max_tokens: 512,
                temperature: 0,
                stream: false,
                ...MODELS.VISION_PRIMARY.extra,
            }),
            new Promise((_, reject) =>
                setTimeout(
                    () => reject(Object.assign(new Error('stt timeout'), { code: 'ECONNABORTED' })),
                    config.stt?.timeoutMs || 15000
                )
            ),
        ]);

        const text = String(completion.choices?.[0]?.message?.content || '').trim();
        if (!text) return null;
        if (/^MUSIC$/i.test(text)) return null;
        if (/^[\s♪♫🎵]*$/.test(text)) return null;
        console.log(`[STT] transcribed ${text.length} chars`);
        return text;
    } catch (err) {
        disabled = true;
        console.error(`[STT] circuit-breaker tripped for this process: ${err.message}`);
        return null;
    }
}

module.exports = { transcribe };