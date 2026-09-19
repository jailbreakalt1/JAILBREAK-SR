// No-cookie constraint means public posts only; low success rate is expected.
module.exports = {
  platform: 'INSTAGRAM',
  displayName: 'Instagram',
  getOptions(url, opts = {}) {
    return {
      formatSelector: 'best',
      headers: {},
      extraArgs: [],
      defaultMediaType: 'video',
    };
  },
};
