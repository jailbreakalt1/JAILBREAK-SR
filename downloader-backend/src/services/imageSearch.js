'use strict';

const MAX_COUNT = 30;
const DEFAULT_COUNT = 10;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

const PLACEHOLDER_RE = /(?:blank|clear|pixel|spacer|white|loading)[-_]?(?:\.gif|\.png)(?:\?.*)?$/i;
const PROXY_RE = /^https:\/\/external-content\.duckduckgo\.com\/iu\/?/;

function isCleanImageUrl(url) {
  if (typeof url !== 'string') return false;
  if (!/^https?:\/\//i.test(url)) return false;
  if (PROXY_RE.test(url)) return true;
  if (PLACEHOLDER_RE.test(new URL(url).pathname || url)) return false;
  return true;
}

function unique(values) {
  return [...new Set(values)];
}

function unwrapDdgProxy(url) {
  try {
    const u = new URL(url);
    if (!PROXY_RE.test(u.href)) return url;
    const target = u.searchParams.get('u');
    if (target) return target;
    const data = u.searchParams.get('data');
    if (data) {
      const decoded = decodeURIComponent(data);
      const match = decoded.match(/"src":"(https?:\/\/[^"]+)"/);
      if (match) return match[1];
    }
    return url;
  } catch {
    return url;
  }
}

async function fetchText(url) {
  const res = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url.split('/')[2]}`);
  return res.text();
}

/**
 * DuckDuckGo vqd token + JSON image API (i.js) — the most reliable source.
 */
async function searchDdgJson(query, count) {
  const page = await fetchText(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`);
  let vqd = null;
  const patterns = [
    /vqd=(?:"|')?([0-9]+-[0-9]+)(?:"|')?/,
    /"vqd":"([0-9]+-[0-9]+)"/,
    /vqd=['"]([^'"]+)['"]/,
  ];
  for (const pattern of patterns) {
    const match = page.match(pattern);
    if (match) { vqd = match[1]; break; }
  }
  if (!vqd) throw new Error('Could not obtain DuckDuckGo vqd token');

  const res = await fetch(
    `https://duckduckgo.com/i.js?o=json&q=${encodeURIComponent(query)}&vqd=${vqd}&f=,,,&p=1`,
    { headers: HEADERS, signal: AbortSignal.timeout(15000) }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status} from DuckDuckGo i.js`);
  const data = await res.json();
  const urls = (data.results || []).map((r) => r.image).filter(isCleanImageUrl);
  return unique(urls).slice(0, count);
}

/**
 * Fallback: parse DuckDuckGo HTML page for thumbnails, unwrapping the
 * external-content proxy to the real source URL.
 */
async function searchDdgHtml(query, count) {
  const page = await fetchText(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`);
  const urls = [];
  const imgRe = /<img[^>]+(?:data-src|src)=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = imgRe.exec(page)) !== null && urls.length < count) {
    let candidate = match[1];
    if (candidate.startsWith('//')) candidate = `https:${candidate}`;
    candidate = unwrapDdgProxy(candidate);
    if (isCleanImageUrl(candidate)) urls.push(candidate);
  }
  return unique(urls).slice(0, count);
}

/**
 * Last resort: Bing image results, pulling the real image URL (murl) out of
 * the embedded JSON metadata.
 */
async function searchBing(query, count) {
  const page = await fetchText(`https://www.bing.com/images/search?q=${encodeURIComponent(query)}`);
  const urls = [];
  const murlRe = /"murl":"((?:https?:\/\/[^"\\]|\\.)*)"/g;
  let match;
  while ((match = murlRe.exec(page)) !== null && urls.length < count) {
    const candidate = match[1].replace(/\\\//g, '/').replace(/\\\\/g, '\\');
    if (isCleanImageUrl(candidate)) urls.push(candidate);
  }
  return unique(urls).slice(0, count);
}

/**
 * Search images across DuckDuckGo (JSON → HTML) then Bing.
 * Returns up to `count` unique image URLs.
 */
async function searchImages(query, count = DEFAULT_COUNT) {
  const limit = Math.min(Math.max(Number(count) || DEFAULT_COUNT, 1), MAX_COUNT);
  const errors = [];
  for (const source of [searchDdgJson, searchDdgHtml, searchBing]) {
    try {
      const urls = await source(query, limit);
      if (urls.length > 0) return urls;
    } catch (err) {
      errors.push(err.message);
    }
  }
  const detail = errors.length ? ` (${errors.join('; ')})` : '';
  throw new Error(`All image sources failed${detail}`);
}

module.exports = { searchImages, MAX_COUNT, DEFAULT_COUNT, isCleanImageUrl, unwrapDdgProxy };