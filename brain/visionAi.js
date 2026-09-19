/**
 * brain/visionAi.js
 *
 * JB's perception brain — called when a message contains image media.
 *
 * Strategy: race both vision models in parallel, first to respond wins.
 *
 *   Primary:  Nemotron 3 Nano Omni   (key 2) — image + video + audio, 256K
 *   Fallback: DiffusionGemma 26B     (key 1) — image + video, 256K
 *
 * Key facts applied from model research:
 *  - Nemotron Omni: uses reasoning_budget + enable_thinking, system prompt OK
 *  - DiffusionGemma: uses enable_thinking, system prompt OK, multi-image OK
 *  - Llama-3.2-11b: NO system messages with images, single image only → NOT used here
 *    (removed from previous version — it was breaking per official NIM docs)
 *  - Both primary and fallback accept multiple images
 *
 * Handler already applies a 40s outer timeout — we use 28s internally
 * so we always send back a proper error string, never let the handler timeout fire.
 */

const config = require('../config');
const { MODELS, hasKey1, hasKey2 } = require('./modelRegistry');
const { getClient }   = require('./nimClient');
const { persona }     = require('./persona');
const memory          = require('./memory');
const userProfiles    = require('./userProfiles');
const people          = require('./people');
const { nowInConfiguredTimezone, resolveTimezone } = require('../tools/timezone');

const VISION_TIMEOUT = 28000;

// ── Strip thinking tags from model output ─────────────────────────────────────

function stripThinking(raw) {
    return raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim() || raw.trim();
}

// ── Build the message array ───────────────────────────────────────────────────

function buildMessages(jid, userText, images, meta, omitSystem = false) {
    const fullHistory = memory.get(jid);
    // Drop the placeholder we just added so it won't duplicate in vision content
    const history = fullHistory.slice(0, -1);

    const _now       = nowInConfiguredTimezone();
    const _tz        = resolveTimezone();
    const timeNote   = `\nRight now in Zimbabwe (${_tz}): ${_now.format('h:mm A')}, ${_now.format('dddd D MMMM YYYY')}.`;

    const systemContent =
        persona +
        timeNote +
        '\nYou were just sent an image. Look at it and respond naturally and in character.' +
        (meta.pushName ? `\nThe user's name is ${meta.pushName}.` : '') +
        userProfiles.getPromptBlock(jid) +
        people.getResumeBlock(meta.sender || jid);

    const imageParts = images.map(img => ({
        type:      'image_url',
        image_url: { url: `data:${img.mimetype || 'image/jpeg'};base64,${img.base64}` },
    }));

    const userMessage = {
        role: 'user',
        content: [
            ...imageParts,
            { type: 'text', text: userText?.trim() || 'What do you see?' },
        ],
    };

    if (omitSystem) {
        // Some models don't accept system messages when images are present
        return [...history, userMessage];
    }

    return [
        { role: 'system', content: systemContent },
        ...history,
        userMessage,
    ];
}

// ── Single vision attempt with hard timeout ───────────────────────────────────

async function visionCall(client, modelDef, messages, label) {
    const call = client.chat.completions.create({
        model:       modelDef.id(),
        messages,
        temperature: 0.6,
        top_p:       0.95,
        max_tokens:  1024,
        stream:      false,
        ...modelDef.extra,
    });

    const completion = await Promise.race([
        call,
        new Promise((_, reject) =>
            setTimeout(
                () => reject(Object.assign(new Error(`${label} timeout`), { code: 'ECONNABORTED' })),
                VISION_TIMEOUT
            )
        ),
    ]);

    const raw = completion.choices?.[0]?.message?.content || '';
    if (!raw) throw new Error(`Empty response from ${label}`);
    return stripThinking(raw);
}

// ── Main see() ────────────────────────────────────────────────────────────────

/**
 * @param {string} jid
 * @param {string} userText
 * @param {{mimetype: string, base64: string}[]} images
 * @param {object} [meta]  - { pushName }
 * @returns {Promise<{ type: 'text', reply: string }>}
 */
async function see(jid, userText, images, meta = {}) {
    if (!Array.isArray(images) || images.length === 0) {
        return { type: 'text', reply: "didn't actually get an image to look at, try resending" };
    }

    if (!hasKey1() && !hasKey2()) {
        return { type: 'text', reply: "eyes are offline — no API keys set. check config.js" };
    }

    // Store placeholder in memory before building messages
    const captionForMemory = userText?.trim() || '[sent an image]';
    memory.add(jid, 'user', captionForMemory);

    // Build contestant calls
    const contestants = [];

    // Primary: Nemotron Omni on key 2 — full system prompt + multi-image
    if (hasKey2()) {
        const client = getClient(MODELS.VISION_PRIMARY.key());
        if (client) {
            const msgs = buildMessages(jid, userText, images, meta, false);
            contestants.push(
                visionCall(client, MODELS.VISION_PRIMARY, msgs, 'nemotron-omni')
                    .then(reply => ({ reply, slot: 'nemotron-omni' }))
            );
        }
    }

    // Fallback: DiffusionGemma on key 1 — also multi-image capable, different key
    if (hasKey1()) {
        const client = getClient(MODELS.VISION_FALLBACK.key());
        if (client) {
            const msgs = buildMessages(jid, userText, images, meta, false);
            contestants.push(
                visionCall(client, MODELS.VISION_FALLBACK, msgs, 'diffusiongemma')
                    .then(reply => ({ reply, slot: 'diffusiongemma' }))
            );
        }
    }

    if (contestants.length === 0) {
        return { type: 'text', reply: "eyes are offline — API keys not configured" };
    }

    let winner;
    try {
        winner = await Promise.any(contestants);
    } catch (aggErr) {
        // All failed
        const errors = aggErr.errors || [aggErr];
        errors.forEach((e, i) => {
            const status = e.status || e.response?.status;
            console.error(`[JB-VISION] slot ${i} failed ${status || e.code || ''}: ${e.message}`);
        });

        const statuses = errors.map(e => e.status || e.response?.status);
        if (statuses.some(s => s === 401)) return { type: 'text', reply: "media API key's not working, check config" };
        if (statuses.some(s => s === 429)) return { type: 'text', reply: 'getting too many requests, chill for a sec' };
        return { type: 'text', reply: `couldn't process that image rn, try again in ${config.spam.duplicateCooldown}s` };
    }

    console.log(`[JB-VISION] ${winner.slot} won for ${jid}`);
    memory.add(jid, 'assistant', winner.reply);
    return { type: 'text', reply: winner.reply };
}

module.exports = { see };
