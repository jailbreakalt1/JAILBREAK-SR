'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  parseCookies,
  isExpired,
  checkCookieFile,
  cookieArgs,
} = require('../core/cookieHealth');

const SAMPLE = [
  '# Netscape HTTP Cookie File',
  '#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t2500000000\tSID\tabc123',
  '.youtube.com\tTRUE\t/\tTRUE\t2500000000\tVISITOR_INFO1_LIVE\txyz',
  '.tiktok.com\tTRUE\t/\tFALSE\t0\tsessionid\tzzz',
  '.instagram.com\tTRUE\t/\tFALSE\t2500000000\tsessionid\tinsta123',
  '.facebook.com\tTRUE\t/\tFALSE\t1600000000\tc_user\tfb123',
  'not a cookie line',
].join('\n');

test('parseCookies parses netscape format and skips junk', () => {
  const cookies = parseCookies(SAMPLE);
  assert.strictEqual(cookies.length, 5);
  assert.ok(cookies.some((c) => c.domain === '.youtube.com' && c.name === 'VISITOR_INFO1_LIVE'));
  assert.ok(cookies.some((c) => c.name === 'SID' && c.expiry === 2500000000));
  assert.ok(cookies.some((c) => c.name === 'sessionid' && c.expiry === 0));
});

test('isExpired respects session cookies and future expiry', () => {
  const now = Date.now() / 1000;
  assert.strictEqual(isExpired({ expiry: 0 }, now), false);
  assert.strictEqual(isExpired({ expiry: now + 5000 }, now), false);
  assert.strictEqual(isExpired({ expiry: now - 1 }, now), true);
});

test('checkCookieFile reports missing when no file', () => {
  const report = checkCookieFile('/nonexistent/cookies.txt');
  assert.strictEqual(report.present, false);
  assert.strictEqual(report.status, 'missing');
});

test('checkCookieFile flags expired file', () => {
  const file = path.join(os.tmpdir(), `cookiehealth-expired-${Date.now()}.txt`);
  fs.writeFileSync(file, SAMPLE); // includes .facebook.com c_user with past expiry
  try {
    const report = checkCookieFile(file);
    assert.strictEqual(report.present, true);
    assert.ok(report.status === 'expired' || report.status === 'stale');
    assert.ok(report.expiredCookies >= 1);
    assert.ok(report.coveredPlatforms.includes('facebook'));
  } finally {
    fs.unlinkSync(file);
  }
});

test('checkCookieFile reports ok and platforms when cookies alive', () => {
  const future = Math.floor(Date.now() / 1000) + 999999;
  const file = path.join(os.tmpdir(), `cookiehealth-ok-${Date.now()}.txt`);
  const content = [
    '.youtube.com\tTRUE\t/\tTRUE\t' + future + '\tSID\tabc',
    '.tiktok.com\tTRUE\t/\tTRUE\t' + future + '\tsessionid\tzzz',
    '.instagram.com\tTRUE\t/\tTRUE\t' + future + '\tsessionid\ti1',
  ].join('\n');
  fs.writeFileSync(file, content);
  try {
    const report = checkCookieFile(file);
    assert.strictEqual(report.status, 'ok');
    assert.strictEqual(report.totalCookies, 3);
    assert.strictEqual(report.activeCookies, 3);
    assert.strictEqual(report.expiredCookies, 0);
    assert.deepStrictEqual(report.coveredPlatforms.sort(), ['instagram', 'tiktok', 'youtube'].sort());
    assert.ok(report.expiresInSec > 0);
  } finally {
    fs.unlinkSync(file);
  }
});

test('cookieArgs uses --no-cookies when file missing', () => {
  assert.deepStrictEqual(cookieArgs('/nonexistent/cookies.txt'), ['--no-cookies']);
});

test('cookieArgs attaches --cookies when file exists', () => {
  const file = path.join(os.tmpdir(), `cookiehealth-args-${Date.now()}.txt`);
  fs.writeFileSync(file, '.youtube.com\tTRUE\t/\tTRUE\t0\tn\tv\n');
  try {
    assert.deepStrictEqual(cookieArgs(file), ['--cookies', file]);
  } finally {
    fs.unlinkSync(file);
  }
});
