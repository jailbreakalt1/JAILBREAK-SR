'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const config = require('../config');
const { DownloadFailedError } = require('../utils/errors');

async function createRequestDir(requestId) {
  const dirPath = path.join(config.tempRoot, requestId);
  try {
    await fsp.mkdir(dirPath, { recursive: true });
    return dirPath;
  } catch (err) {
    throw new DownloadFailedError(`Failed to create request directory: ${err.message}`, { details: { requestId, dirPath } });
  }
}

async function cleanup(dirPath) {
  try {
    await fsp.rm(dirPath, { recursive: true, force: true });
  } catch {
    // swallow errors
  }
}

async function sweepOld(maxAgeMs = 30 * 60 * 1000) {
  let removed = 0;
  let entries;
  try {
    entries = await fsp.readdir(config.tempRoot, { withFileTypes: true });
  } catch {
    return removed;
  }
  const now = Date.now();
  for (const entry of entries) {
    const entryPath = path.join(config.tempRoot, entry.name);
    let stat;
    try {
      stat = await fsp.stat(entryPath);
    } catch {
      continue;
    }
    if (now - stat.mtimeMs > maxAgeMs) {
      await cleanup(entryPath);
      removed += 1;
    }
  }
  return removed;
}

async function dirSize(dirPath) {
  let total = 0;
  let entries;
  try {
    entries = await fsp.readdir(dirPath, { withFileTypes: true });
  } catch {
    return total;
  }
  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += await dirSize(entryPath);
    } else if (entry.isFile()) {
      const stat = await fsp.stat(entryPath);
      total += stat.size;
    }
  }
  return total;
}

module.exports = { createRequestDir, cleanup, sweepOld, dirSize };
