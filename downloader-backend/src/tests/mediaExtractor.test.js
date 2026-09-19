'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const {
  buildArgs,
  AUDIO_STRATEGIES,
  VIDEO_STRATEGIES,
  YOUTUBE_STABILITY_ARGS,
  tiktokArgs,
} = require('../core/mediaExtractor');
const {
  mapFailure,
  mediaTypeFor,
  parseTitleFromFile,
  isHttpUrl,
  EXT_MEDIA_TYPE,
} = require('../utils/ytdlpHelpers');
const { FileTooLargeError, ExtractionTimeoutError } = require('../utils/errors');

test('audio strategies prefer bestaudio first', () => {
  assert.deepStrictEqual(AUDIO_STRATEGIES, ['bestaudio/best', 'best']);
});

test('video strategies: width pass first (portrait), height pass second (landscape), best last', () => {
  assert.deepStrictEqual(VIDEO_STRATEGIES, [
    'bestvideo[width<=720]+bestaudio/best[width<=720]/best',
    'bestvideo[height<=720]+bestaudio/best[height<=720]/best',
    'best',
  ]);
});

test('buildArgs includes stability args (PO-token client + tiktok api path)', () => {
  const args = buildArgs({
    url: 'https://youtube.com/watch?v=abc',
    dir: '/tmp/dl',
    formatSelector: 'bestaudio/best',
    kind: 'audio',
  });
  const extractorArgsIdx = args.indexOf('--extractor-args');
  const youtubeFlag = args[extractorArgsIdx + 1];
  const tiktokFlag = args[extractorArgsIdx + 3];
  assert.ok(extractorArgsIdx >= 0);
  assert.strictEqual(youtubeFlag, 'youtube:player_client=android');
  assert.ok(tiktokFlag.startsWith('tiktok:app_info=;tiktok:api_hostname='));
  assert.ok(tiktokFlag.includes('tiktok:api_hostname='));
});

test('tiktokArgs uses fresh random device (app_info) and rotates hosts', () => {
  const first = tiktokArgs(0);
  const second = tiktokArgs(1);
  assert.notStrictEqual(first, second);
  assert.ok(first.startsWith('tiktok:app_info=;tiktok:api_hostname='));
  assert.ok(first.includes('api19-normal-useast5.us.tiktok.com'));
  assert.ok(second.includes('api16-normal-c-useast1a.tiktokv.com'));
});

test('isTiktokUrl detects tiktok links', () => {
  const { isTiktokUrl } = require('../core/mediaExtractor');
  assert.strictEqual(isTiktokUrl('https://www.tiktok.com/@x/video/1'), true);
  assert.strictEqual(isTiktokUrl('https://vm.tiktok.com/abc'), true);
  assert.strictEqual(isTiktokUrl('https://youtube.com/watch?v=x'), false);
});

test('buildArgs passes format selector and size cap', () => {
  const args = buildArgs({
    url: 'https://x.test/a',
    dir: '/tmp/dl',
    formatSelector: 'best',
    kind: 'audio',
  });
  assert.ok(args.includes('-f'));
  assert.ok(args.includes('best'));
  assert.ok(args.includes('--max-filesize'));
  assert.ok(args.includes('--geo-bypass'));
  assert.ok(args.includes('--extractor-args'));
});

test('buildArgs adds merge-output-format mp4 only for video', () => {
  const video = buildArgs({ url: 'u', dir: '/tmp', formatSelector: 'best', kind: 'video' });
  const audio = buildArgs({ url: 'u', dir: '/tmp', formatSelector: 'best', kind: 'audio' });
  assert.ok(video.includes('--merge-output-format'));
  assert.ok(video.includes('mp4'));
  assert.ok(!audio.includes('--merge-output-format'));
});

test('mapFailure maps max-filesize to FileTooLargeError', () => {
  const err = mapFailure({ stderr: 'ERROR: file is larger than max-filesize', stdout: '', exitCode: 1 });
  assert.ok(err instanceof FileTooLargeError);
  assert.strictEqual(err.statusCode, 413);
});

test('mapFailure maps timeout to ExtractionTimeoutError', () => {
  const err = mapFailure({ stderr: 'timed out', stdout: '', exitCode: 1 });
  assert.ok(err instanceof ExtractionTimeoutError);
  assert.strictEqual(err.statusCode, 504);
});

test('mediaTypeFor classifies extensions', () => {
  assert.strictEqual(mediaTypeFor('mp4'), 'video');
  assert.strictEqual(mediaTypeFor('mp3'), 'audio');
  assert.strictEqual(mediaTypeFor('jpg'), 'image');
  assert.strictEqual(mediaTypeFor('xyz'), null);
  assert.deepStrictEqual(EXT_MEDIA_TYPE.audio, ['mp3', 'm4a', 'ogg', 'wav', 'aac', 'opus']);
});

test('parseTitleFromFile strips the [id] suffix', () => {
  assert.strictEqual(parseTitleFromFile('/tmp/dl/My Song [abc123].m4a'), 'My Song');
  assert.strictEqual(parseTitleFromFile('/tmp/dl/just-a-name.mp3'), 'just-a-name');
});

test('isHttpUrl validates http(s) links', () => {
  assert.strictEqual(isHttpUrl('https://youtube.com/watch?v=x'), true);
  assert.strictEqual(isHttpUrl('http://a.b/c'), true);
  assert.strictEqual(isHttpUrl('   https://x.y/z  '), true);
  assert.strictEqual(isHttpUrl(''), false);
  assert.strictEqual(isHttpUrl('not a url'), false);
  assert.strictEqual(isHttpUrl(null), false);
});
