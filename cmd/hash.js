/**
 * cmd/hash.js
 *
 * Hash text with md5/sha1/sha256/sha512 via node:crypto — offline, no API.
 * Direct + brain tool.
 */

const crypto = require('crypto');

const ALGS = { md5: 'md5', sha1: 'sha1', sha256: 'sha256', sha512: 'sha512' };

module.exports = {
    name: 'hash',
    aliases: ['sha256'],
    category: 'utility',
    description: 'Hash text (md5/sha1/sha256/sha512).',
    usage: '[md5|sha1|sha256|sha512] <text>  default: sha256',

    async execute(sock, msg, args, extra = {}) {
        let alg = 'sha256';
        let rest = args.join(' ').trim();
        if (args.length > 1 && ALGS[args[0].toLowerCase()]) {
            alg = args[0].toLowerCase();
            rest = args.slice(1).join(' ').trim();
        }

        if (!rest) {
            const ask = 'give me text to hash, like `.hash secret123`';
            if (extra.__brainCall) return { summary: ask };
            await extra.reply?.(ask);
            return { ok: true, summary: ask };
        }

        const digest = crypto.createHash(ALGS[alg]).update(rest, 'utf8').digest('hex');
        const text = `🔐 *${alg}* (${digest.length * 4}-bit)\n\`${digest}\``;

        if (extra.__brainCall) return { summary: `${alg}(${rest}) = ${digest}` };

        try { await extra.react?.('🔐'); } catch (_) {}
        await extra.reply?.(text);
        return { ok: true, summary: text };
    },
};