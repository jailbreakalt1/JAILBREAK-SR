module.exports = {
  platform: 'TIKTOK',
  displayName: 'TikTok',
  getOptions(url, opts = {}) {
    return {
      formatSelector: 'best[ext=mp4]',
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      },
      extraArgs: [],
      defaultMediaType: 'video',
    };
  },
};
