/**
 * brain/nimClient.js
 *
 * Shared, cached OpenAI-compatible clients for the NVIDIA NIM endpoint.
 * One client per API key — models are selected per-request, not per-client.
 *
 * Usage:
 *   const { getClient } = require('./nimClient');
 *   const client = getClient(key1());   // or key2()
 */

const OpenAI = require('openai');
const { BASE_URL } = require('./modelRegistry');

const _clients = new Map();

/**
 * Returns a cached OpenAI client for the given API key.
 * Returns null if key is empty/placeholder.
 */
function getClient(apiKey) {
    if (!apiKey || apiKey.startsWith('$')) return null;
    if (_clients.has(apiKey)) return _clients.get(apiKey);
    const client = new OpenAI({ apiKey, baseURL: BASE_URL });
    _clients.set(apiKey, client);
    return client;
}

module.exports = { getClient };
