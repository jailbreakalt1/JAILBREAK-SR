const axios = require('axios');

// Live/upcoming detection for YouTube videos. yt-search (and youtubei.js)
// can no longer flag live streams reliably against the current view model,
// so we fetch the watch page and look for markers in ytInitialPlayerResponse:
//   - "liveBroadcastDetails": { ..., "isLiveNow": true }  -> currently live
//   - "isUpcoming": true                                   -> scheduled, not watchable
// Returns 'live' | 'upcoming' | false, or null when the page couldn't be
// fetched (the caller should then let the download attempt run anyway).

const WATCH_URL = 'https://www.youtube.com/watch?v=';
const UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

function detectLiveState(html) {
  if (/"liveBroadcastDetails"\s*:\s*\{[^}]*"isLiveNow"\s*:\s*true/.test(html)) return 'live';
  if (/"isLiveNow"\s*:\s*true/.test(html)) return 'live';
  if (/"isLive"\s*:\s*true/.test(html)) return 'live';
  if (/"isUpcoming"\s*:\s*true/.test(html)) return 'upcoming';
  return false;
}

async function getLiveState(videoId) {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;
  try {
    const { data } = await axios.get(WATCH_URL + videoId, {
      headers: { 'User-Agent': UA },
      timeout: 20000,
      maxContentLength: 10 * 1024 * 1024,
    });
    return detectLiveState(data);
  } catch (err) {
    return null;
  }
}

module.exports = { getLiveState, detectLiveState };
