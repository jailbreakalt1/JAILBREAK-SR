/**
 * cmd/8ball.js
 *
 * Magic 8-ball — local answers, no API. asks for a question if none given.
 * Direct + brain tool.
 */

const ANSWERS = [
    "It is certain.",
    "It is decidedly so.",
    "Without a doubt.",
    "Yes — definitely.",
    "You may rely on it.",
    "As I see it, yes.",
    "Most likely.",
    "Outlook good.",
    "Yes.",
    "Signs point to yes.",
    "Reply hazy, try again.",
    "Ask again later.",
    "Better not tell you now.",
    "Cannot predict now.",
    "Concentrate and ask again.",
    "Don't count on it.",
    "My reply is no.",
    "My sources say no.",
    "Outlook not so good.",
    "Very doubtful.",
];

module.exports = {
    name: '8ball',
    aliases: ['magic8', 'ball8'],
    category: 'fun',
    description: 'Ask the magic 8-ball a yes/no question.',
    usage: '<your question>',

    async execute(sock, msg, args, extra = {}) {
        const question = args.join(' ').trim();
        if (!question) {
            const ask = 'ask me a yes/no question, like `.8ball should I nap right now`';
            if (extra.__brainCall) return { summary: ask };
            await extra.reply?.(ask);
            return { ok: true, summary: ask };
        }

        const answer = ANSWERS[Math.floor(Math.random() * ANSWERS.length)];
        const text = `🎱 *${question[0].toUpperCase()}${question.slice(1)}*\n\n${answer}`;

        if (extra.__brainCall) return { summary: `${question} → ${answer}` };

        try { await extra.react?.('🎱'); } catch (_) {}
        await extra.reply?.(text);
        return { ok: true, summary: `${question} → ${answer}` };
    },
};