'use strict';

const { ContentRequiresLoginError } = require('../utils/errors');

const LOGIN_WALL_MARKERS = [
  'you must log in to continue',
  'log in to continue',
  'you need to log in',
  'please log in',
  'login required',
];

async function preflight(url) {
  let response;
  try {
    response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    return;
  }
  const html = await response.text().catch(() => '');
  if (!html) return;
  const lower = html.toLowerCase();
  if (LOGIN_WALL_MARKERS.some((marker) => lower.includes(marker))) {
    throw new ContentRequiresLoginError("That post isn't public, so I can't grab it.");
  }
}

module.exports = {
  platform: 'FACEBOOK',
  displayName: 'Facebook',
  preflight,
  getOptions(url, opts = {}) {
    return {
      formatSelector: 'bestvideo+bestaudio/best',
      headers: {},
      extraArgs: [],
      defaultMediaType: 'video',
    };
  },
};
