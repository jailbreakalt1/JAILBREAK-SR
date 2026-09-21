/**
 * cmd/calc.js
 *
 * Safe arithmetic calculator — the expression is validated against a strict
 * whitelist (digits, basic operators, brackets, percent) before evaluation,
 * so no function calls, identifiers or object keys can ever sneak through.
 * Direct + brain tool.
 */

const ALLOWED = /^[0-9+\-*/().%\s^]+$/;

function evaluate(expr) {
    if (!expr || !ALLOWED.test(expr)) throw new Error('expression contains invalid characters');
    const sanitized = expr.replace(/\^/g, '**').replace(/%/g, '/100');
    // Function() scopes eval away from local access; only arithmetic survives
    // the whitelist above anyway.
    const result = Function(`"use strict"; return (${sanitized});`)();
    if (typeof result !== 'number' || !Number.isFinite(result)) throw new Error('not a finite number');
    return Math.round(result * 1e6) / 1e6;
}

module.exports = {
    name: 'calc',
    aliases: ['calc?', 'calculator', 'solve'],
    category: 'utility',
    description: 'Evaluate a math expression.',
    usage: '<expression>  e.g. `.calc (12+4)*3/2`',

    async execute(sock, msg, args, extra = {}) {
        const expr = args.join(' ').replace(/[×÷]/g, (m) => (m === '×' ? '*' : '/')).trim();
        if (!expr) {
            const ask = 'give me a math expression, like `.calc 45*7+1`';
            if (extra.__brainCall) return { summary: ask };
            await extra.reply?.(ask);
            return { ok: true, summary: ask };
        }

        const text = `🧮 ${expr} = ${evaluate(expr)}`;

        if (extra.__brainCall) return { summary: text };

        try { await extra.react?.('🧮'); } catch (_) {}
        await extra.reply?.(text);
        return { ok: true, summary: text };
    },
};