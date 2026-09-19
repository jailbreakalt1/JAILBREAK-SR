/**
 * brain/modelRegistry.js
 *
 * Single source of truth for every NVIDIA NIM model used by JB.
 * Researched capabilities (June 2026):
 *
 *  ┌─────────────────────────────────────────────────────────────────────┐
 *  │ Model                               Key  Ctx    Vision  Audio  Tools│
 *  │ nvidia/nemotron-3-super-120b-a12b    1  256K     ✗       ✗    ✓   │
 *  │ deepseek-ai/deepseek-v4-flash-0731   2  256K     ✗       ✗    ✓   │
 *  │ google/diffusiongemma-26b-a4b-it     1  256K   ✓img+vid  ✗    ✓   │
 *  │ nvidia/nemotron-3-nano-omni-*        2  256K   ✓img+vid  ✓    ✓   │
 *  │ google/gemma-4-31b-it                1  128K     ✗       ✗    ✓*  │
 *  │ meta/llama-3.2-11b-vision-instruct   2  128K   ✓1img    ✗    ✗   │
 *  └─────────────────────────────────────────────────────────────────────┘
 *
 *  Notes:
 *  - meta/llama-3.1-8b-instruct is EOL on NVIDIA (removed 2026-08-26) —
 *    meta/llama-3.1-* must NOT be used anywhere.
 *  - Nemotron-3-Super/DiffusionGemma use `chat_template_kwargs: { enable_thinking: bool }`
 *    (Super/Omni MUST have thinking OFF for fast tool calls — with it on they narrate)
 *  - DeepSeek uses `chat_template_kwargs: { thinking: false }` (different key!)
 *  - Nemotron Omni uses `reasoning_budget: 4096` + `chat_template_kwargs: { enable_thinking: true }`
 *  - Llama-3.2-11b-vision: NO system messages when image present, single image only
 *  - All served via https://integrate.api.nvidia.com/v1
 */

const config = require('../config');

const BASE_URL = 'https://integrate.api.nvidia.com/v1';

// ── Key resolvers ─────────────────────────────────────────────────────────────

function key1() { return config.nvidia?.apiKey      || process.env.NVIDIA_API_KEY       || ''; }
function key2() { return config.nvidiaMedia?.apiKey || process.env.NVIDIA_MEDIA_API_KEY || ''; }

function hasKey1() { const k = key1(); return !!(k && k !== '$NVIDIA_API_KEY'); }
function hasKey2() { const k = key2(); return !!(k && k !== '$NVIDIA_MEDIA_API_KEY'); }

// Trims whitespace off a config-supplied model id. A stray leading/trailing
// space (easy to introduce when hand-editing config.js) makes the model id
// invalid, the API call fails, and — for relay-style calls — that failure
// can surface as raw internal data leaking into the chat. Guard against it.
function trimId(value) {
    return typeof value === 'string' ? value.trim() : value;
}

// ── Model definitions ─────────────────────────────────────────────────────────

const MODELS = {
    // ── PRIMARY TEXT BRAIN — SLOT A (Key 1) ─────────────────────────────────
    // 256K ctx, image+video capable, function calling (thinking mode), fast
    // Console tag: [JB-BRAIN] slot A
    PRIMARY: {
        id:       () => trimId(config.nvidia?.modelSlotA) || 'google/diffusiongemma-26b-a4b-it',
        key:      key1,
        hasKey:   hasKey1,
        vision:   true,     // supports images and video
        audio:    false,
        tools:    true,
        ctx:      256000,
        extra:    { chat_template_kwargs: { enable_thinking: false } },
        extraThink: { chat_template_kwargs: { enable_thinking: true } },
    },

    // ── FALLBACK TEXT BRAIN — SLOT B (Key 2) ────────────────────────────────
    // 1M ctx, best reasoning + tool-calling, text only
    // Console tag: [JB-BRAIN] slot B
    FALLBACK: {
        id:       () => {
            const m = trimId(config.nvidiaMedia?.modelSlotB);
            return (m && m !== 'https://integrate.api.nvidia.com') ? m : 'deepseek-ai/deepseek-v4-flash-0731';
        },
        key:      key2,
        hasKey:   hasKey2,
        vision:   false,
        audio:    false,
        tools:    true,
        ctx:      1000000,
        extra:    { chat_template_kwargs: { thinking: false } },  // DeepSeek uses "thinking", not "enable_thinking"
    },

    // ── RESCUE TEXT BRAIN — SLOT C (Key 1) ──────────────────────────────────
    // 256K ctx, main path, tool-calling capable
    // Nemotron-3-Super-120B-a12b is faster AND stronger than the DiffusionGemma
    // it replaced (verified live: ~2.2s tool call vs DiffusionGemma's 1.9–15.7s).
    // Thinking must be DISABLED or it narrates instead of calling tools.
    // Console tag: [JB-BRAIN] slot C rescue
    RESCUE: {
        id:       () => trimId(config.nvidia?.modelSlotC) || 'nvidia/nemotron-3-super-120b-a12b',
        key:      key1,
        hasKey:   hasKey1,
        vision:   false,
        audio:    false,
        tools:    true,
        ctx:      256000,
        extra:    { chat_template_kwargs: { enable_thinking: false } },
    },

    // ── PRIMARY VISION (Key 2) ──────────────────────────────────────────────
    // 256K ctx, image + video + AUDIO, reasoning, highest multimodal quality
    VISION_PRIMARY: {
        id:       () => trimId(config.nvidiaMedia?.model) || 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
        key:      key2,
        hasKey:   hasKey2,
        vision:   true,
        audio:    true,   // unique — can process audio too
        tools:    true,
        ctx:      256000,
        extra:    { reasoning_budget: 4096, chat_template_kwargs: { enable_thinking: true } },
    },

    // ── FALLBACK VISION (Key 1) ─────────────────────────────────────────────
    // DiffusionGemma also handles images — different key from primary vision
    // IMPORTANT: supports multiple images, system messages OK
    VISION_FALLBACK: {
        id:       () => 'google/diffusiongemma-26b-a4b-it',
        key:      key1,
        hasKey:   hasKey1,
        vision:   true,
        audio:    false,
        tools:    false,  // no need to action-parse vision responses
        ctx:      256000,
        extra:    { chat_template_kwargs: { enable_thinking: false } },
    },

    // ── SUMMARY MODEL (Key 2) ───────────────────────────────────────────────
    // fast, good instruction following for memory condensation
    // deepseek-v4-flash kept timing out on summary (18s+ sick nights); the
    // Nemotron that slots into SLOT C is fast + healthy, so summary leads with it.
    SUMMARY: {
        id:       () => 'nvidia/nemotron-3-super-120b-a12b',
        key:      key2,
        hasKey:   hasKey2,
        vision:   false,
        audio:    false,
        tools:    false,
        ctx:      256000,
        extra:    { chat_template_kwargs: { enable_thinking: false } },
    },

    // ── SUMMARY FALLBACK (Key 1) ────────────────────────────────────────────
    // Reuses SLOT C's model — same fast/cheap model, different pipeline
    SUMMARY_FALLBACK: {
        id:       () => trimId(config.nvidia?.modelSlotC) || 'google/diffusiongemma-26b-a4b-it',
        key:      key1,
        hasKey:   hasKey1,
        vision:   false,
        audio:    false,
        tools:    false,
        ctx:      128000,
        extra:    {},
    },
};

module.exports = { MODELS, BASE_URL, key1, key2, hasKey1, hasKey2 };
