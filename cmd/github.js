/**
 * cmd/github.js
 *
 * GitHub repo info via the public API (no key — unauthenticated limit).
 * Direct + brain tool.
 */

const axios = require('axios');

module.exports = {
    name: 'github',
    aliases: ['gh', 'repo'],
    category: 'utility',
    description: 'Get a GitHub repository overview.',
    usage: '<owner/repo>  e.g. `.github jailbreakalt1/JAILBREAK-SR`',

    async execute(sock, msg, args, extra = {}) {
        const repo = (args[0] || '').replace(/^https?:\/\/(www\.)?github\.com\//i, '').trim();

        if (!repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
            const ask = 'pass a repo like `.github jailbreakalt1/JAILBREAK-SR`, or paste a GitHub link';
            if (extra.__brainCall) return { summary: ask };
            await extra.reply?.(ask);
            return { ok: true, summary: ask };
        }

        let out;
        try {
            const { data } = await axios.get(`https://api.github.com/repos/${repo}`, {
                headers: { 'User-Agent': 'JAILBREAK-SR' },
                timeout: 8000,
            });
            const recent = await axios.get(`https://api.github.com/repos/${repo}/commits`, {
                headers: { 'User-Agent': 'JAILBREAK-SR' },
                timeout: 8000,
            });
            const top = (recent.data || [])[0];
            const parts = [
                `🐙 *${data.full_name}*`,
                data.description ? `${data.description}` : '',
                data.language ? `\n🛠 ${data.language}` : '',
                `⭐ ${data.stargazers_count ?? 0}  ·  🍴 ${data.forks_count ?? 0}  ·  🐛 ${data.open_issues_count ?? 0}`,
                `${data.license ? `📄 ${data.license.spdx_id || data.license.name}` : ''}${data.homepage ? `  ·  🔗 ${data.homepage}` : ''}`,
                top ? `\n🕒 latest commit: ${(top.commit.message || '').split('\n')[0]}` : '',
                `\n${data.html_url}`,
            ].filter(Boolean).join('\n');
            out = parts;
        } catch (err) {
            out = (err.response && err.response.status === 404)
                ? `no GitHub repo named "${repo}" was found`
                : `github lookup failed — ${err.message}`;
        }

        if (extra.__brainCall) return { summary: out };

        try { await extra.react?.('🐙'); } catch (_) {}
        if (!extra.reply) {
            await sock.sendMessage(extra.from || msg.key.remoteJid, { text: out }, { quoted: msg });
        } else {
            await extra.reply(out);
        }
        return { ok: true, summary: out };
    },
};