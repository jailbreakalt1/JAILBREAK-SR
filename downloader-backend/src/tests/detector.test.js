'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { detect, PLATFORMS } = require('../core/detector');

test('detect pinterest pin url', () => {
  assert.strictEqual(detect('https://www.pinterest.com/pin/123456/'), PLATFORMS.PINTEREST);
});

test('detect pinterest short url', () => {
  assert.strictEqual(detect('https://pin.it/abc123'), PLATFORMS.PINTEREST);
});

test('detect tiktok video url', () => {
  assert.strictEqual(detect('https://www.tiktok.com/@user/video/1234567890123456789'), PLATFORMS.TIKTOK);
});

test('detect tiktok short url', () => {
  assert.strictEqual(detect('https://vm.tiktok.com/abcDEF/'), PLATFORMS.TIKTOK);
});

test('detect facebook watch url', () => {
  assert.strictEqual(detect('https://www.facebook.com/watch?v=123'), PLATFORMS.FACEBOOK);
});

test('detect facebook short url', () => {
  assert.strictEqual(detect('https://fb.watch/abc/'), PLATFORMS.FACEBOOK);
});

test('detect instagram post url', () => {
  assert.strictEqual(detect('https://www.instagram.com/p/abc123/'), PLATFORMS.INSTAGRAM);
});

test('detect instagram reel url', () => {
  assert.strictEqual(detect('https://www.instagram.com/reel/abc123/'), PLATFORMS.INSTAGRAM);
});

test('unknown platform url', () => {
  assert.strictEqual(detect('https://example.com/foo'), PLATFORMS.UNKNOWN);
});

test('empty string is unknown', () => {
  assert.strictEqual(detect(''), PLATFORMS.UNKNOWN);
});
