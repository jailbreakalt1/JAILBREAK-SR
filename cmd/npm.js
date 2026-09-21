/**
 * cmd/npm.js
 *
 * npm package info via the public registry — no key.
 * Direct + brain tool.
 */

const axios = require('axios');

module.exports = {
    name: 'npm',
    aliases: ['npmpkg', 'package'],
    category: 'utility',
    description: 'Get npm package details.',
    usage: '<package-name>',

    async execute(sock, msg, args, extra = {}) {
        const pkg = (args[0] || '').toLowerCase().trim().replace(/^npm:\/\//i, '');
        if (!pkg || !/^[a-z0-9][a-z0-9._-]*(@[a-z0-9][a-z0-9._-]*)?$/.test(pkg)) {
            const ask = 'give me a package name, like `.npm express`';
            if (extra.__brainCall) return { summary: ask };
            await extra.reply?.(ask);
            return { ok: true, summary: ask };
        }

        let out;
        try {
            const { data } = await axios.get(`https://registry.npmjs.org/${encodeURIComponent(pkg)}`, { timeout: 8000 });
            const version = data['dist-tags'] && data['dist-tags'].latest;
            const v = version && data.versions[version];
            if (!version || !v) throw new Error('no version data');
            const author = v.author ? (typeof v.author === 'string' ? v.author : v.author.name) : '';
            const size = v.dist ? `${(v.dist.unpackedSize / 1024 / 1024).toFixed(1)}MB` : 'n/a';
            out = [
                `📦 *${data.name}@${version}*`,
                v.description ? `${v.description}` : '',
                `\n🛠 size: ${size}  ·  ⏳ updated: ${(v.gitHead ? v.gitHead.slice(0, 7) : 'n/a')}`,
                author ? `👤 ${author}` : '',
                v.repository && v.repository.url ? `\n${v.repository.url}` : '',
            ].filter(Boolean).join('\n');
        } catch (err) {
            out = (err.response && err.response.status === 404)
                ? `no npm package named "${pkg}" was found`
                : `npm lookup failed — ${err.message}`;
        }

        if (extra.__brainCall) return { summary: out };

        try { await extra.react?.('📦'); } catch (_) {}
        if (!extra.reply) {
            await sock.sendMessage(extra.from || msg.key.remoteJid, { text: out }, { quoted: msg });
        } else {
            await extra.reply(out);
        }
        return { ok: true, summary: out };
    },
};