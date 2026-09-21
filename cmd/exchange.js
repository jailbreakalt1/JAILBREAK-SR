/**
 * cmd/exchange.js
 *
 * Live FX rates via open.er-api.com — free, no key, includes ZWL.
 * Usage: `.exchange <amount> <FROM> <TO>`  (defaults: 1 USD → ZWL)
 * Direct + brain tool.
 */

const axios = require('axios');

const THREE = /^[A-Z]{3}$/;

function fmt(n) {
    return n >= 1e6 ? n.toExponential(4)
        : n >= 1e3 ? n.toLocaleString('en-US', { maximumFractionDigits: 0 })
        : n >= 1 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 })
        : n.toFixed(6);
}

module.exports = {
    name: 'exchange',
    aliases: ['fx', 'forex', 'convert'],
    category: 'utility',
    description: 'Convert money between currencies (live rates).',
    usage: '[amount] [FROM] [TO]  e.g. `.exchange 50 USD ZWL`',

    async execute(sock, msg, args, extra = {}) {
        let amount = 1, from = 'USD', to = 'ZWL';

        if (args.length >= 3) {
            const parsedAmount = parseFloat(args[0]);
            if (!Number.isFinite(parsedAmount)) {
                const note = 'amount should be a number, like `.exchange 100 USD ZWL`';
                if (extra.__brainCall) return { summary: note };
                await extra.reply?.(note);
                return { ok: true, summary: note };
            }
            amount = Math.abs(parsedAmount);
            from = args[1].toUpperCase();
            to = args[2].toUpperCase();
        } else if (args.length === 2) {
            from = args[0].toUpperCase();
            to = args[1].toUpperCase();
        } else if (args.length === 1 && THREE.test(args[0].toUpperCase())) {
            from = args[0].toUpperCase();
        } else if (args.length === 1) {
            to = args[0].toUpperCase();
        }

        if (!THREE.test(from) || !THREE.test(to)) {
            const note = 'currency codes must be 3 letters, like `.exchange 50 USD ZWL`';
            if (extra.__brainCall) return { summary: note };
            await extra.reply?.(note);
            return { ok: true, summary: note };
        }

        let out;
        try {
            const { data } = await axios.get(`https://open.er-api.com/v6/latest/${from}`, { timeout: 10000 });
            if (data && data.result !== 'success') throw new Error(data['error-type'] || 'bad response');
            const rate = data.rates[to];
            if (rate === undefined) {
                throw new Error(`"${to}" isn't a supported code (try ZWL, USD, EUR, GBP)`);
            }
            out = `💱 *${fmt(amount)} ${from} = ${fmt(amount * rate)} ${to}*\n` +
                  `_rate: 1 ${from} = ${fmt(rate)} ${to} · updated ${data.time_last_update_utc || 'recently'}_`;
        } catch (err) {
            out = `exchange failed — ${err.message}`;
        }

        if (extra.__brainCall) return { summary: out };

        try { await extra.react?.('💱'); } catch (_) {}
        if (!extra.reply) {
            await sock.sendMessage(extra.from || msg.key.remoteJid, { text: out }, { quoted: msg });
        } else {
            await extra.reply(out);
        }
        return { ok: true, summary: out };
    },
};