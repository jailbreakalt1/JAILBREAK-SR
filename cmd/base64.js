/**
 * cmd/base64.js
 *
 * Base64 encode / decode using node:buffer — offline, no API.
 * Direct + brain tool.
 */

module.exports = {
    name: 'base64',
    aliases: ['b64'],
    category: 'utility',
    description: 'Base64 encode or decode text.',
    usage: 'encode|decode <text>',

    async execute(sock, msg, args, extra = {}) {
        let mode = (args[0] || '').toLowerCase();
        let rest = args.join(' ').trim();
        if (mode === 'encode' || mode === 'decode') {
            rest = args.slice(1).join(' ').trim();
        } else {
            mode = 'encode';
        }

        if (!rest) {
            const ask = `give me text to ${mode}, like \`.base64 ${mode} hello world\``;
            if (extra.__brainCall) return { summary: ask };
            await extra.reply?.(ask);
            return { ok: true, summary: ask };
        }

        let text;
        try {
            if (mode === 'encode') {
                text = `🔒 *Base64 (encode)*:\n${Buffer.from(rest, 'utf8').toString('base64')}`;
            } else {
                const decoded = Buffer.from(rest, 'base64').toString('utf8');
                if (!decoded.trim() || /[\uFFFD]/.test(decoded)) throw new Error('invalid base64');
                text = `🔓 *Base64 (decode)*:\n${decoded}`;
            }
        } catch (err) {
            text = `couldn't ${mode} that — ${err.message}`;
        }

        if (extra.__brainCall) return { summary: text };

        try { await extra.react?.(mode === 'encode' ? '🔒' : '🔓'); } catch (_) {}
        await extra.reply?.(text);
        return { ok: true, summary: text };
    },
};