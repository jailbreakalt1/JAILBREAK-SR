const moment = require('moment-timezone');
const config = require('../config');

const DEFAULT_TIMEZONE = 'Africa/Harare';

const normalizeTimezone = (value) => (typeof value === 'string' ? value.trim() : '');

const resolveTimezone = (value = config.timezone) => {
  const normalized = normalizeTimezone(value);
  if (normalized && moment.tz.zone(normalized)) {
    return normalized;
  }
  return DEFAULT_TIMEZONE;
};

const nowInConfiguredTimezone = () => moment().tz(resolveTimezone());

const getTimezoneLabel = () => {
  const now = nowInConfiguredTimezone();
  return `${resolveTimezone()} (${now.format('z') || 'local'})`;
};

module.exports = {
  DEFAULT_TIMEZONE,
  resolveTimezone,
  nowInConfiguredTimezone,
  getTimezoneLabel
};
