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

function parseProactiveMessageParts(raw, maxParts = 4) {
    const text = String(raw || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    if (!text) return { type: 'empty', parts: [] };
    if (/^(?:SILENT|PASS|SKIP|WALK_XHS)\s*[.!。]*$/i.test(text) || /<WAKE_(?:SILENT|XHS)\s*\/?\s*>/i.test(text)) {
        return { type: 'legacy_control_token', parts: [] };
    }
    const migrated = text.match(/^SEND\s*:\s*([\s\S]+)$/i)?.[1]?.trim() || text;
    const split = migrated.split(/\r?\n\s*---\s*\r?\n/).map(part => part.trim()).filter(Boolean);
    if (!split.length) return { type: 'empty', parts: [] };
    const limit = Math.max(1, Number(maxParts) || 4);
    const parts = split.length <= limit
        ? split
        : [...split.slice(0, limit - 1), split.slice(limit - 1).join('\n\n')];
    return { type: 'messages', parts };
}

module.exports = { QUIET_START_HOUR, QUIET_END_HOUR, getChinaHour, isWakeQuietHours, millisecondsUntilWakeDispatchWindow, parseProactiveMessageParts };
