'use strict';

const config = require('../config');

function isActive(commandName, isOwner = false) {
    const shift = config.shift;
    if (!shift || !shift.enabled) return true;
    const now = new Date();
    const current = now.getHours() * 60 + now.getMinutes();
    const [sh, sm] = String(shift.start || '').split(':').map(Number);
    const [eh, em] = String(shift.end || '').split(':').map(Number);
    if (!Number.isInteger(sh) || !Number.isInteger(sm) || !Number.isInteger(eh) || !Number.isInteger(em)) return true;
    const start = sh * 60 + sm;
    const end = eh * 60 + em;
    if (start === end) return true;
    if (isOwner && shift.allowOwner) return true;
    return start < end ? current >= start && current < end : current >= start || current < end;
}

module.exports = { isActive };