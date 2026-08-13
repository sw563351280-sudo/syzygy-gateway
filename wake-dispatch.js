'use strict';

const QUIET_START_HOUR = 2;
const QUIET_END_HOUR = 7;

function getChinaHour(now = new Date()) {
    return Number(new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Shanghai', hour: '2-digit', hourCycle: 'h23'
    }).format(now));
}

function isWakeQuietHours(now = new Date()) {
    const hour = getChinaHour(now);
    return hour >= QUIET_START_HOUR && hour < QUIET_END_HOUR;
}

// This is a host delivery rule, not a change to wake λ(t).
function millisecondsUntilWakeDispatchWindow(now = new Date()) {
    if (!isWakeQuietHours(now)) return null;
    const wallClock = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const targetWallClock = Date.UTC(
        wallClock.getUTCFullYear(), wallClock.getUTCMonth(), wallClock.getUTCDate(),
        QUIET_END_HOUR, 0, 0, 0
    );
    return Math.max(1000, targetWallClock - wallClock.getTime());
}

function parseWakeDecision(raw) {
    const text = String(raw || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    if (!text || /^SILENT\s*[.!。]*$/i.test(text) || /<WAKE_SILENT\s*\/?\s*>/i.test(text)) return { type: 'silent' };
    if (/^WALK_XHS\s*[.!。]*$/i.test(text) || /<WAKE_XHS\s*\/?\s*>/i.test(text)) return { type: 'xhs_walk' };
    const send = text.match(/^SEND\s*:\s*([\s\S]+)$/i);
    const content = send?.[1]?.trim().slice(0, 160);
    return content ? { type: 'send', content } : { type: 'silent' };
}

module.exports = { QUIET_START_HOUR, QUIET_END_HOUR, getChinaHour, isWakeQuietHours, millisecondsUntilWakeDispatchWindow, parseWakeDecision };
