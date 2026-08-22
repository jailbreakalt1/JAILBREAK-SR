'use strict';

const moment = require('moment-timezone');
const config = require('../config');

function minutes(value) {
    const [h, m] = String(value || '').split(':').map(Number);
    if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
    return h * 60 + m;
}

function isActive(commandName, isOwner = false) {
    const shift = config.shift;
    if (!shift.enabled || (isOwner && shift.allowOwner)) return true;
    const start = minutes(shift.start);
    const end = minutes(shift.end);
    if (start === null || end === null || start === end) return true;
    const now = moment().tz(shift.timezone);
    const current = now.hour() * 60 + now.minute();
    return start < end ? current >= start && current < end : current >= start || current < end;
}

module.exports = { isActive };
