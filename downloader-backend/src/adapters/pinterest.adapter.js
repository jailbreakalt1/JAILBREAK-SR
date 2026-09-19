const path = require('path');
const fsp = require('fs/promises');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const OG_IMAGE_RE = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i;
const OG_IMAGE_ALT_RE = /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i;

function extractOgImage(html) {
  const direct = html.match(OG_IMAGE_RE);
  if (direct) return direct[1];
  const alt = html.match(OG_IMAGE_ALT_RE);
  return alt ? alt[1] : null;
}

async function fallbackToImage(url, requestId, dir) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`pin page fetch failed: ${res.status}`);
  const html = await res.text();

  const imageUrl = extractOgImage(html);
  if (!imageUrl) throw new Error('no og:image found on pin page');

  const imgRes = await fetch(imageUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!imgRes.ok) throw new Error(`image fetch failed: ${imgRes.status}`);
  const buffer = Buffer.from(await imgRes.arrayBuffer());

  const extMatch = imageUrl.split('?')[0].match(/\.(jpe?g|png|webp|gif|avif|heic)$/i);
  const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
  const filePath = path.join(dir, `pin-image-${requestId.slice(0, 8)}.${ext}`);
  await fsp.writeFile(filePath, buffer);
  return filePath;
}

module.exports = {
  platform: 'PINTEREST',
  displayName: 'Pinterest',
  getOptions(url, opts = {}) {
    return {
      formatSelector: 'best',
      headers: {},
      extraArgs: [],
      defaultMediaType: 'unknown',
    };
  },
  // Image-only pins have no video — yt-dlp reports "No video formats found!".
  // The extractor calls this to fetch the pin's og:image directly.
  fallbackToImage,
};