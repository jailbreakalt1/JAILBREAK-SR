const pinterest = require('./pinterest.adapter');
const tiktok = require('./tiktok.adapter');
const facebook = require('./facebook.adapter');
const instagram = require('./instagram.adapter');

const adapters = [pinterest, tiktok, facebook, instagram];

const registry = Object.fromEntries(adapters.map((a) => [a.platform, a]));

function getAdapter(platform) {
  const adapter = registry[platform];
  if (!adapter) {
    throw new Error(`No adapter for platform: ${platform}`);
  }
  return adapter;
}

function listPlatforms() {
  return Object.keys(registry);
}

module.exports = {
  registry,
  getAdapter,
  listPlatforms,
};
