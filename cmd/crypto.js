/**
 * cmd/crypto.js
 *
 * Live cryptocurrency prices via CoinGecko free API — no key.
 * Direct + brain tool.
 */

const axios = require('axios');

const ALIASES = {
    btc: 'bitcoin', eth: 'ethereum', sol: 'solana', xrp: 'ripple',
    ada: 'cardano', dot: 'polkadot', doge: 'dogecoin', shib: 'shiba-inu',
    ltc: 'litecoin', bnb: 'binancecoin', trx: 'tron', matic: 'polygon',
    ton: 'the-open-network', xmr: 'monero', avax: 'avalanche-2',
};

module.exports = {
    name: 'crypto',
    aliases: ['coin', 'crypto-price'],
    category: 'utility',
    description: 'Live crypto price (USD/EUR/GBP + 24h change).',
    usage: '<coin>  e.g. `.crypto bitcoin`',

    async execute(sock, msg, args, extra = {}) {
        const raw = args.join('-').toLowerCase().trim();
        const coin = raw ? (ALIASES[raw] || raw) : 'bitcoin';

        let out;
        try {
            const { data } = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
                params: {
                    ids: coin,
                    vs_currencies: 'usd,eur,gbp',
                    include_24hr_change: 'true',
                    include_24hr_vol: 'true',
                    include_market_cap: 'true',
                },
                timeout: 10000,
            });
            const c = data && data[coin];
            if (!c || c.usd === undefined) throw new Error('that coin id is unknown');
            const arrow = (c.usd_24h_change ?? 0) >= 0 ? '🟢' : '🔴';
            const fmt = (n) => n >= 1 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : n.toFixed(8);
            out = [
                `💰 *${coin.replace(/[-_]/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())}*`,
                '',
                `🇺🇸 $${fmt(c.usd)}  ·  🇪🇺 €${fmt(c.eur)}  ·  🇬🇧 £${fmt(c.gbp)}`,
                `${arrow} 24h: ${c.usd_24h_change >= 0 ? '+' : ''}${c.usd_24h_change.toFixed(2)}%`,
                c.usd_market_cap ? `\n📊 market cap: $${(c.usd_market_cap / 1e9).toFixed(2)}B` : '',
            ].filter(Boolean).join('\n');
        } catch (err) {
            out = `crypto lookup failed — ${err.message}`;
        }

        if (extra.__brainCall) return { summary: out };

        try { await extra.react?.('💰'); } catch (_) {}
        if (!extra.reply) {
            await sock.sendMessage(extra.from || msg.key.remoteJid, { text: out }, { quoted: msg });
        } else {
            await extra.reply(out);
        }
        return { ok: true, summary: out };
    },
};