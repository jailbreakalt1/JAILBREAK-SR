const { AppError } = require('../utils/errors');

const ERROR_MESSAGES = {
  UnsupportedPlatformError: "That link isn't from a supported platform.",
  ExtractionTimeoutError: 'That took too long to fetch — try again.',
  ContentRequiresLoginError: "That post isn't public, so I can't grab it.",
  RateLimitedError: 'Getting rate-limited on that platform — try again shortly.',
  FileTooLargeError: "That file's too large to send here.",
  PlatformTemporarilyUnavailable: "That platform's downloader needs an update — flagged for a fix.",
  DownloadFailedError: 'The download failed — try another link.',
  ImageSearchError: 'Could not find images — try another query.',
};

function errorHandler(err, _req, res, _next) {
  if (err instanceof AppError) {
    const message = err.message || ERROR_MESSAGES[err.code] || 'Something went wrong.';
    return res.status(err.statusCode).json({ error: err.code, message, ...(err.debug ? { debug: err.debug } : {}) });
  }

  console.error('[ERROR] unhandled:', err?.stack || err?.message || err);
  res.status(500).json({ error: 'InternalError', message: 'Something went wrong on our side.' });
}

module.exports = errorHandler;