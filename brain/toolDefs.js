/**
 * brain/toolDefs.js
 *
 * Native function-calling tool schemas for JB's agentic loop (NVIDIA NIM,
 * OpenAI-compatible `tools` API). Each entry maps directly to a real
 * cmd/*.js command.
 *
 * kind: 'data'     — read-only, safe to call multiple times in a loop.
 *                     Never messages the user directly — returns info for
 *                     the model to reason over and decide what to do next.
 * kind: 'terminal' — sends something to the user as a side effect (a file,
 *                     a card, lyrics). Only ONE terminal tool fires per
 *                     turn — after it runs, the loop drops all tools and
 *                     forces a short closing text reply.
 */

const TOOL_DEFS = [
    {
        kind: 'data',
        cmd:  'weather',
        schema: {
            type: 'function',
            function: {
                name: 'weather',
                description: "Get current weather and tomorrow's forecast for any city in the world.",
                parameters: {
                    type: 'object',
                    properties: {
                        city: { type: 'string', description: 'City name, e.g. "Harare" or "London"' },
                    },
                    required: ['city'],
                },
            },
        },
    },
    {
        kind: 'data',
        cmd:  'time',
        schema: {
            type: 'function',
            function: {
                name: 'time',
                description: 'Get the current date and time in Zimbabwe.',
                parameters: { type: 'object', properties: {} },
            },
        },
    },
    {
        kind: 'data',
        cmd:  'search',
        schema: {
            type: 'function',
            function: {
                name: 'search',
                description:
                    'Search the web for current/live info — news, prices, scores, recent events, ' +
                    'or anything you are not fully confident about. Generous tier, no cost concern — ' +
                    'use it whenever it would genuinely help, not just as a last resort.',
                parameters: {
                    type: 'object',
                    properties: {
                        query: { type: 'string', description: 'What to search for' },
                    },
                    required: ['query'],
                },
            },
        },
    },
    {
        kind: 'data',
        cmd:  'songguess',
        schema: {
            type: 'function',
            function: {
                name: 'songguess',
                description:
                    'Search to identify a song from a vague description or partial lyrics when you are NOT ' +
                    '100% certain of the exact title/artist (e.g. "it goes like oh oh I\'m in love"). ' +
                    'ALWAYS call this to confirm before calling lyrics/song/video if there is ANY doubt — ' +
                    'never guess a title or artist yourself from memory. Free YouTube search.',
                parameters: {
                    type: 'object',
                    properties: {
                        description: { type: 'string', description: 'The lyric fragment or vague description given by the user' },
                    },
                    required: ['description'],
                },
            },
        },
    },
    {
        kind: 'terminal',
        ownerOnly: true,
        cmd:  'song',
        schema: {
            type: 'function',
            function: {
                name: 'song',
                description:
                    'Download and send an audio track by name/artist. Only call this once the exact song is ' +
                    'known — either the user named it explicitly, it was already established earlier in this ' +
                    'chat, or songguess confirmed it. For a vague description, call songguess first and confirm ' +
                    'with the user before calling this.',
                parameters: {
                    type: 'object',
                    properties: {
                        query: { type: 'string', description: 'Song name and/or artist' },
                    },
                    required: ['query'],
                },
            },
        },
    },
    {
        kind: 'terminal',
        ownerOnly: true,
        cmd:  'video',
        schema: {
            type: 'function',
            function: {
                name: 'video',
                description: 'Download and send a YouTube video by search query.',
                parameters: {
                    type: 'object',
                    properties: {
                        query: { type: 'string', description: 'Video search query' },
                    },
                    required: ['query'],
                },
            },
        },
    },
    {
        kind: 'terminal',
        ownerOnly: true,
        cmd:  'lyrics',
        schema: {
            type: 'function',
            function: {
                name: 'lyrics',
                description:
                    'Look up and send the full lyrics of a song. Only call this once the exact song is known — ' +
                    'either the user named it explicitly, it was already established earlier in this chat, or ' +
                    'songguess confirmed it. If there is any doubt which song is meant, call songguess first — ' +
                    'never guess a title/artist yourself.',
                parameters: {
                    type: 'object',
                    properties: {
                        query: { type: 'string', description: 'Song name and/or artist' },
                    },
                    required: ['query'],
                },
            },
        },
    },
    {
        kind: 'terminal',
        ownerOnly: true,
        cmd:  'download_song',
        schema: {
            type: 'function',
            function: {
                name: 'download_song',
                description:
                    'Identify a song from audio/video the user just replied to AND download it in one go. ' +
                    'Use when they say "send me this song", "download this", "what is this and send it".',
                parameters: { type: 'object', properties: {} },
            },
        },
    },
    {
        kind: 'terminal',
        ownerOnly: true,
        cmd:  'find',
        schema: {
            type: 'function',
            function: {
                name: 'find',
                description:
                    'Identify a song from audio/video the user replied to, WITHOUT downloading it — ' +
                    'just tell them what it is.',
                parameters: { type: 'object', properties: {} },
            },
        },
    },
    {
        kind: 'terminal',
        ownerOnly: true,
        cmd:  'instagram',
        schema: {
            type: 'function',
            function: {
                name: 'instagram',
                description:
                    'Download and send the photo(s)/video(s) from an Instagram post, reel, or IGTV link the ' +
                    'user just sent or pasted. Call this with that exact link.',
                parameters: {
                    type: 'object',
                    properties: {
                        url: { type: 'string', description: 'The Instagram post/reel/tv URL' },
                    },
                    required: ['url'],
                },
            },
        },
    },
    {
        kind: 'terminal',
        cmd:  'remind',
        schema: {
            type: 'function',
            function: {
                name: 'remind',
                description:
                    'Schedule a reminder. JB will message the user again ON ITS OWN once the timer is up — ' +
                    'no further prompting needed from them. Use when the user asks to be reminded/pinged/nudged ' +
                    'about something later ("remind me in 20 min to...", "ping me in an hour about...").',
                parameters: {
                    type: 'object',
                    properties: {
                        minutes: { type: 'number', description: 'How many minutes from now to fire the reminder (1–1440).' },
                        message: { type: 'string', description: 'What to remind the user about.' },
                    },
                    required: ['minutes', 'message'],
                },
            },
        },
    },
    // ── Free data tools (read-only, no keys, safe in a loop) ──────────────────
    { kind: 'data', cmd: 'joke', schema: { type: 'function', function: { name: 'joke', description: 'Get a random clean joke.', parameters: { type: 'object', properties: {} } } } },
    { kind: 'data', cmd: 'fact', schema: { type: 'function', function: { name: 'fact', description: 'Get a random fun fact.', parameters: { type: 'object', properties: {} } } } },
    { kind: 'data', cmd: 'quote', schema: { type: 'function', function: { name: 'quote', description: 'Get a random quote of wisdom.', parameters: { type: 'object', properties: {} } } } },
    { kind: 'data', cmd: 'riddle', schema: { type: 'function', function: { name: 'riddle', description: 'Get a random riddle (with answer).', parameters: { type: 'object', properties: {} } } } },
    { kind: 'data', cmd: '8ball', schema: { type: 'function', function: { name: 'magic8', description: 'Ask the magic 8-ball. Call with the user\'s yes/no question.', parameters: { type: 'object', properties: { question: { type: 'string', description: 'The user\'s yes/no question' } }, required: ['question'] } } } },
    { kind: 'data', cmd: 'advice', schema: { type: 'function', function: { name: 'advice', description: 'Get a random piece of life advice.', parameters: { type: 'object', properties: {} } } } },
    { kind: 'data', cmd: 'trivia', schema: { type: 'function', function: { name: 'trivia', description: 'Get a random multiple-choice trivia question.', parameters: { type: 'object', properties: {} } } } },
    { kind: 'data', cmd: 'horo', schema: { type: 'function', function: { name: 'horo', description: "Get today's horoscope for a zodiac sign.", parameters: { type: 'object', properties: { sign: { type: 'string', description: 'One of the 12 zodiac signs, e.g. leo' } }, required: ['sign'] } } } },
    { kind: 'data', cmd: 'translate', schema: { type: 'function', function: { name: 'translate', description: 'Translate text between languages. English is the default target unless a target is given.', parameters: { type: 'object', properties: { text: { type: 'string', description: 'The text to translate' }, to: { type: 'string', description: 'Optional 2-letter target language code (default en)' } }, required: ['text'] } } } },
    { kind: 'data', cmd: 'dict', schema: { type: 'function', function: { name: 'dict', description: 'Look up the definition of an English word.', parameters: { type: 'object', properties: { word: { type: 'string', description: 'The word to define' } }, required: ['word'] } } } },
    { kind: 'data', cmd: 'wiki', schema: { type: 'function', function: { name: 'wiki', description: 'Get a Wikipedia summary for a topic.', parameters: { type: 'object', properties: { topic: { type: 'string', description: 'The topic to look up' } }, required: ['topic'] } } } },
    { kind: 'data', cmd: 'calc', schema: { type: 'function', function: { name: 'calc', description: 'Evaluate a math expression (numbers + - * / % ^ and brackets). Never hand-calculate.', parameters: { type: 'object', properties: { expression: { type: 'string', description: 'Arithmetic expression, e.g. (12+4)*3/2' } }, required: ['expression'] } } } },
    { kind: 'data', cmd: 'base64', schema: { type: 'function', function: { name: 'base64', description: 'Base64 encode or decode text.', parameters: { type: 'object', properties: { text: { type: 'string', description: 'Text or base64 to convert' }, mode: { type: 'string', enum: ['encode', 'decode'], description: 'encode or decode (default encode)' } }, required: ['text'] } } } },
    { kind: 'data', cmd: 'hash', schema: { type: 'function', function: { name: 'hash', description: 'Hash text with md5/sha1/sha256/sha512.', parameters: { type: 'object', properties: { text: { type: 'string', description: 'Text to hash' }, alg: { type: 'string', enum: ['md5', 'sha1', 'sha256', 'sha512'], description: 'Hash algorithm (default sha256)' } }, required: ['text'] } } } },
    { kind: 'data', cmd: 'crypto', schema: { type: 'function', function: { name: 'crypto', description: 'Get the live price of a cryptocurrency in USD/EUR/GBP plus 24h change.', parameters: { type: 'object', properties: { coin: { type: 'string', description: 'Coin id/name, e.g. bitcoin, ethereum, dogecoin' } }, required: ['coin'] } } } },
    { kind: 'data', cmd: 'exchange', schema: { type: 'function', function: { name: 'exchange', description: 'Convert an amount between currencies using live rates (supports ZWL).', parameters: { type: 'object', properties: { amount: { type: 'number', description: 'Amount to convert (default 1)' }, from: { type: 'string', description: '3-letter source currency code (default USD)' }, to: { type: 'string', description: '3-letter target currency code (default ZWL)' } } } } } },
    { kind: 'data', cmd: 'ipinfo', schema: { type: 'function', function: { name: 'ipinfo', description: 'Look up an IP address (geo, ISP, timezone). No IP given = the bot\'s own public IP.', parameters: { type: 'object', properties: { ip: { type: 'string', description: 'IP address to look up (optional)' } } } } } },
    { kind: 'data', cmd: 'xptop', schema: { type: 'function', function: { name: 'xptop', description: 'Get the XP leaderboard (top users by activity).', parameters: { type: 'object', properties: {} } } } },
];

module.exports = { TOOL_DEFS };
