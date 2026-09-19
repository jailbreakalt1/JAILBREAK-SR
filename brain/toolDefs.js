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
];

module.exports = { TOOL_DEFS };
