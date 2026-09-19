'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  AppError,
  UnsupportedPlatformError,
  ExtractionTimeoutError,
  ContentRequiresLoginError,
  RateLimitedError,
  FileTooLargeError,
  PlatformTemporarilyUnavailable,
  DownloadFailedError,
} = require('../utils/errors');

const cases = [
  [UnsupportedPlatformError, 422],
  [ExtractionTimeoutError, 504],
  [ContentRequiresLoginError, 403],
  [RateLimitedError, 429],
  [FileTooLargeError, 413],
  [PlatformTemporarilyUnavailable, 503],
  [DownloadFailedError, 500],
];

for (const [ErrorClass, statusCode] of cases) {
  test(`${ErrorClass.name} has correct name, code, statusCode`, () => {
    const err = new ErrorClass('boom');
    assert.ok(err instanceof AppError);
    assert.ok(err instanceof Error);
    assert.strictEqual(err.name, ErrorClass.name);
    assert.strictEqual(err.code, ErrorClass.name);
    assert.strictEqual(err.statusCode, statusCode);
    assert.strictEqual(err.message, 'boom');
    assert.deepStrictEqual(err.details, {});
  });
}

test('AppError defaults', () => {
  const err = new AppError('bad');
  assert.strictEqual(err.name, 'AppError');
  assert.strictEqual(err.code, 'AppError');
  assert.strictEqual(err.statusCode, 500);
  assert.deepStrictEqual(err.details, {});
});

test('AppError details pass-through', () => {
  const err = new AppError('bad', { code: 'Custom', statusCode: 400, details: { a: 1 } });
  assert.strictEqual(err.code, 'Custom');
  assert.strictEqual(err.statusCode, 400);
  assert.deepStrictEqual(err.details, { a: 1 });
});
