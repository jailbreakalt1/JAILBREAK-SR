'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');

let db;

function today() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.TZ || 'Africa/Harare',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function database() {
  if (db) return db;
  fs.mkdirSync(path.dirname(config.quotaDbPath), { recursive: true });
  db = new DatabaseSync(config.quotaDbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS quota_usage (
      user_id TEXT NOT NULL,
      quota_date TEXT NOT NULL,
      command TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, quota_date, command)
    );
  `);
  return db;
}

function normalizeUser(value) {
  return String(value || '').replace(/@[^@]+$/, '').replace(/\D/g, '');
}

function normalizeCommand(value) {
  return String(value || 'general').trim().toLowerCase().slice(0, 64) || 'general';
}

function state(userId, command) {
  const user = normalizeUser(userId);
  const cmd = normalizeCommand(command);
  if (!user) throw new Error('user is required');
  const row = database().prepare(
    'SELECT used FROM quota_usage WHERE user_id = ? AND quota_date = ? AND command = ?',
  ).get(user, today(), cmd);
  const used = Number(row?.used || 0);
  return { user, command: cmd, date: today(), used, total: config.quotaLimit, remaining: Math.max(0, config.quotaLimit - used), allowed: used < config.quotaLimit };
}

function get(userId, command) {
  return state(userId, command);
}

function consume(userId, command) {
  const d = database();
  const current = state(userId, command);
  if (!current.allowed) return current;
  d.prepare(`
    INSERT INTO quota_usage (user_id, quota_date, command, used)
    VALUES (?, ?, ?, 1)
    ON CONFLICT(user_id, quota_date, command)
    DO UPDATE SET used = used + 1
  `).run(current.user, current.date, current.command);
  return state(userId, command);
}

module.exports = { get, consume };
