/**
 * brain/nvidiaMediaClient.js
 *
 * Compatibility shim — re-exports getMediaClient using the new nimClient.
 * Kept so any external code that imports this still works unchanged.
 */

const { getClient }  = require('./nimClient');
const { MODELS, BASE_URL } = require('./modelRegistry');

function getMediaClient() {
    return getClient(MODELS.VISION_PRIMARY.key());
}

module.exports = { getMediaClient, NVIDIA_BASE_URL: BASE_URL };
