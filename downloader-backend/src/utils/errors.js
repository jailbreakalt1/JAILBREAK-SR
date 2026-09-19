'use strict';

class AppError extends Error {
  constructor(message, { code = 'AppError', statusCode = 500, details = {} } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

class UnsupportedPlatformError extends AppError {
  constructor(message, options) {
    super(message, { ...options, code: 'UnsupportedPlatformError', statusCode: 422 });
  }
}

class ExtractionTimeoutError extends AppError {
  constructor(message, options) {
    super(message, { ...options, code: 'ExtractionTimeoutError', statusCode: 504 });
  }
}

class ContentRequiresLoginError extends AppError {
  constructor(message, options) {
    super(message, { ...options, code: 'ContentRequiresLoginError', statusCode: 403 });
  }
}

class RateLimitedError extends AppError {
  constructor(message, options) {
    super(message, { ...options, code: 'RateLimitedError', statusCode: 429 });
  }
}

class FileTooLargeError extends AppError {
  constructor(message, options) {
    super(message, { ...options, code: 'FileTooLargeError', statusCode: 413 });
  }
}

class PlatformTemporarilyUnavailable extends AppError {
  constructor(message, options) {
    super(message, { ...options, code: 'PlatformTemporarilyUnavailable', statusCode: 503 });
  }
}

class DownloadFailedError extends AppError {
  constructor(message, options) {
    super(message, { ...options, code: 'DownloadFailedError', statusCode: 500 });
  }
}

class ImageSearchError extends AppError {
  constructor(message, options) {
    super(message, { ...options, code: 'ImageSearchError', statusCode: 502 });
  }
}

module.exports = {
  AppError,
  UnsupportedPlatformError,
  ExtractionTimeoutError,
  ContentRequiresLoginError,
  RateLimitedError,
  FileTooLargeError,
  PlatformTemporarilyUnavailable,
  DownloadFailedError,
  ImageSearchError,
};
