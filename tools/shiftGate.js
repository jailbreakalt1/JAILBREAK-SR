'use strict';

const config = require('../config');

function isActive(commandName, isOwner = false) {
    const shift = config.shift;
    if (!shift) return true;

    if (isOwner && shift.allowOwner) return true;

    const now = new Date();
    const hour = Number(new Intl.DateTimeFormat('en-GB', {
        hour: 'numeric',
        hour12: false,
        timeZone: shift.timezone || 'UTC',
    }).format(now));

    const cycle = Number.isInteger(shift.cycleHours) && shift.cycleHours > 0 ? shift.cycleHours : 3;
    const slot = Number.isInteger(shift.slot) ? shift.slot : 0;

    return (hour % cycle) === slot;
}

module.exports = { isActive };