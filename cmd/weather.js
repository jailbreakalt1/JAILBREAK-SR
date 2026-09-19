/**
 * cmd/weather.js
 *
 * Fetches current + tomorrow's weather for a city via OpenWeatherMap.
 * Works both as a direct command (.weather London) and as a brain-triggered
 * action — when called by the AI brain, results are returned as a string so
 * the brain can relay them naturally in its own words.
 *
 * Requires:
 *   OPEN_WEATHER_API  — your OpenWeatherMap API key (in .env)
 */

const axios  = require('axios');
const config = require('../config');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Fetch current weather + 24-hour forecast for a city.
 * Returns a plain object with the data we care about, or throws on error.
 */
async function fetchWeather(city) {
    const key = config.weather.apiKey || process.env.OPEN_WEATHER_API;
    if (!key) throw new Error('Weather API key not set — add OPEN_WEATHER_API to .env or set config.weather.apiKey');

    const base = 'https://api.openweathermap.org/data/2.5';

    // Try the city as given, then with ",ZW" appended — many smaller Zimbabwean
    // cities (Kwekwe, Gweru, Masvingo etc.) only resolve when the country code
    // is included, because OpenWeatherMap disambiguates by country on exact match.
    const queriesToTry = [city];
    if (!city.includes(',')) queriesToTry.push(`${city},ZW`);

    let lastErr;
    for (const cityQuery of queriesToTry) {
        try {
            const enc = encodeURIComponent(cityQuery);
            const [currentRes, forecastRes] = await Promise.all([
                axios.get(`${base}/weather?q=${enc}&units=metric&appid=${key}`, { timeout: 10000 }),
                axios.get(`${base}/forecast?q=${enc}&units=metric&appid=${key}`, { timeout: 10000 }),
            ]);

            const c = currentRes.data;
            const f = forecastRes.data;

            if (!c?.weather?.length || !c?.main) throw new Error(`Broken weather payload for ${cityQuery}`);

            const tomorrow = f.list?.[8] || f.list?.[0];

            return {
                location:    `${c.name}, ${c.sys?.country || '?'}`,
                status:      `${c.weather[0].main} (${c.weather[0].description || ''})`,
                temp:        c.main.temp,
                feelsLike:   c.main.feels_like,
                humidity:    c.main.humidity,
                wind:        c.wind?.speed,
                icon:        c.weather[0]?.icon,
                tomorrow: {
                    status: tomorrow?.weather?.[0]?.main || 'Unknown',
                    temp:   tomorrow?.main?.temp,
                },
            };
        } catch (err) {
            lastErr = err;
            // Only retry if it was a 404 — other errors (network, auth) fail immediately
            if (err.response?.status !== 404) throw err;
        }
    }
    throw new Error(`City not found: ${city}`);
}

/**
 * Build the formatted card string for direct-command replies.
 */
function buildCard(d) {
    return (
`╔════════════════════╗
   ╼ 𝚆𝙴𝙰𝚃𝙷𝙴𝚁 𝚁𝙴𝙿𝙾𝚁𝚃 ╾
╚════════════════════╝
⎛
  ◈ 𝙻𝙾𝙲𝙰𝚃𝙸𝙾𝙽 : \`${d.location}\`
  ◈ 𝚂𝚃𝙰𝚃𝚄𝚂  : \`${d.status}\`

  ⧯ *CURRENT CONDITIONS*
  ◈ Temp     : \`${d.temp}°C\` (Feels: \`${d.feelsLike}°C\`)
  ◈ Humidity : \`${d.humidity}%\`
  ◈ Wind     : \`${d.wind} m/s\`

  ⧯ *TOMORROW'S OUTLOOK*
  ◈ Status   : \`${d.tomorrow.status}\`
  ◈ Temp     : \`${d.tomorrow.temp}°C\`
⎝`
    );
}

/**
 * Build a compact natural-language summary for the AI brain to relay.
 * The brain will rephrase this in its own voice — keep it fact-dense.
 */
function buildBrainSummary(d) {
    return (
        `Weather for ${d.location}: ` +
        `Currently ${d.status}, ${d.temp}°C (feels like ${d.feelsLike}°C), ` +
        `humidity ${d.humidity}%, wind ${d.wind} m/s. ` +
        `Tomorrow: ${d.tomorrow.status}, ${d.tomorrow.temp}°C.`
    );
}

// ── Command export ────────────────────────────────────────────────────────────

module.exports = {
    name: 'weather',
    aliases: ['w', 'meteo'],
    category: 'public',
    description: "Get current weather and tomorrow's forecast for any city.",
    usage: '.weather <city>',

    /**
     * @param {object} sock   - Baileys socket
     * @param {object} msg    - Raw message object
     * @param {string[]} args - Parsed args array  (args[0] onward = city words)
     * @param {object} extra  - { reply, react, from, sender, pushName, ... }
     *                          extra.__brainCall = true when triggered by AI brain
     */
    async execute(sock, msg, args, extra = {}) {
        const { reply, react } = extra;
        const from = extra.from || msg.key.remoteJid;

        const city = args.join(' ').trim();

        // ── No city provided ──────────────────────────────────────────────────
        if (!city) {
            if (extra.__brainCall) {
                // Brain called without a city — tell it so it can ask the user
                return { error: 'no_city' };
            }
            return reply('*🔍 CITY REQUIRED*\n\nExample: `.weather Harare`, `.weather London`, `.weather Tokyo`');
        }

        // ── React to show we're working ───────────────────────────────────────
        if (react) await react('🌍');

        try {
            const data = await fetchWeather(city);

            // ── Brain-triggered path: return summary, let brain rephrase it ──
            if (extra.__brainCall) {
                return { summary: buildBrainSummary(data) };
            }

            // ── Direct command path: send formatted card ──────────────────────
            const iconUrl = `https://openweathermap.org/img/wn/${data.icon}@4x.png`;

            await sock.sendMessage(
                from,
                {
                    text: buildCard(data),
                    contextInfo: {
                        externalAdReply: {
                            title: `WEATHER: ${data.location.toUpperCase()}`,
                            body: `${data.temp}°C · ${data.status}`,
                            mediaType: 1,
                            thumbnailUrl: iconUrl,
                        },
                    },
                },
                { quoted: msg }
            );

            if (react) await react('✅');

        } catch (err) {
            console.error('[WEATHER]', err.message);

            if (extra.__brainCall) {
                return { error: err.message };
            }

            if (react) await react('❌');

            if (err.message.startsWith('City not found')) {
                return reply(`*CITY NOT FOUND*\n\nCouldn't locate weather data for: \`${city}\``);
            }
            return reply('*ERROR* — Weather lookup failed. Try again in a moment.');
        }
    },
};
