'use strict';

const fs = require('fs');
const config = require('../config');

const PLATFORM_DOMAINS = {
  youtube: ['youtube.com', 'www.youtube.com'],
  tiktok: ['tiktok.com', 'www.tiktok.com'],
  instagram: ['instagram.com', 'www.instagram.com'],
  facebook: ['facebook.com', 'www.facebook.com', 'fb.watch'],
};

function parseCookies(content) {
  const cookies = [];
  for (const raw of String(content).split('\n')) {
    let line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#HttpOnly_')) {
      line = line.replace(/^#HttpOnly_/, '');
    } else if (line.startsWith('#')) {
      continue;
    }
    const parts = line.split('\t');
    if (parts.length < 7) continue;
    const domain = parts[0];
    const expiry = Number(parts[4]);
    const name = parts[5];
    if (!domain || !name) continue;
    cookies.push({
      domain,
      name,
      expiry: Number.isFinite(expiry) ? expiry : 0, // 0 = session cookie
    });
  }
  return cookies;
}

function isExpired(cookie, nowSec) {
  return cookie.expiry > 0 && cookie.expiry <= nowSec;
}

function checkCookieFile(filePath = config.cookiesFile) {
  const report = {
    present: false,
    path: filePath,
    status: 'missing',
  };

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return report;
  }
  report.present = true;
  report.lastModified = stat.mtime.toISOString();
  report.ageSec = Math.max(0, Math.round((Date.now() - stat.mtimeMs) / 1000));

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return { ...report, status: 'unreadable' };
  }

  const cookies = parseCookies(content);
  const nowSec = Date.now() / 1000;
  const expired = cookies.filter((c) => isExpired(c, nowSec)).length;
  const session = cookies.filter((c) => c.expiry === 0).length;
  const active = cookies.length - expired;
  const expiryList = cookies.map((c) => c.expiry).filter((e) => e > 0).sort((a, b) => a - b);
  const earliestExpirySec = expiryList[0] || 0;
  const domains = [...new Set(cookies.map((c) => c.domain))];

  const coveredPlatforms = Object.entries(PLATFORM_DOMAINS)
    .filter(([, platformDomains]) =>
      platformDomains.some((d) => domains.some((domain) => domain === d || domain.endsWith(d))))
    .map(([platform]) => platform);

  let status = 'ok';
  if (cookies.length === 0) {
    status = 'empty';
  } else if (expired === cookies.length) {
    status = 'expired';
  } else if (expired > 0) {
    status = 'stale';
  }

  return {
    ...report,
    status,
    parsable: true,
    totalCookies: cookies.length,
    activeCookies: active,
    expiredCookies: expired,
    sessionCookies: session,
    earliestExpiry: earliestExpirySec ? earliestExpirySec * 1000 : null,
    expiresInSec: earliestExpirySec ? Math.max(0, Math.round(earliestExpirySec - nowSec)) : null,
    domains,
    coveredPlatforms,
  };
}

/**
 * yt-dlp args for the cookies file: attach it when present, otherwise stay
 * anonymous. Accepts an explicit path for testability.
 */
function cookieArgs(filePath = config.cookiesFile) {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return ['--cookies', filePath];
  } catch {
    return ['--no-cookies'];
  }
}

module.exports = {
  PLATFORM_DOMAINS,
  parseCookies,
  isExpired,
  checkCookieFile,
  cookieArgs,
};
