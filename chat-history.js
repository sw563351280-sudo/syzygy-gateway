'use strict';

const DEFAULT_PAGE_SIZE = 120;
const MAX_PAGE_SIZE = 300;

function boundedInteger(value, fallback, minimum, maximum) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(minimum, Math.min(maximum, parsed));
}

function historyPage(messages = [], before = messages.length, limit = DEFAULT_PAGE_SIZE) {
    const total = Array.isArray(messages) ? messages.length : 0;
    const end = boundedInteger(before, total, 0, total);
    const size = boundedInteger(limit, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
    const start = Math.max(0, end - size);
    return { messages: messages.slice(start, end), start, end, total, hasMore: start > 0 };
}

function messageId(message) {
    const versions = Array.isArray(message?.versions) ? message.versions : [];
    const active = versions[message?.activeVersion || 0] || versions[0] || message || {};
    return String(message?._id || message?.id || active?._id || '');
}

function mergePartialSession(existingSession, incomingSession, window) {
    if (!existingSession || !window || window.partial !== true) return incomingSession;
    const existing = Array.isArray(existingSession.messages) ? existingSession.messages : [];
    const incoming = Array.isArray(incomingSession.messages) ? incomingSession.messages : [];
    const start = Number.parseInt(window.start, 10);
    if (!Number.isFinite(start) || start < 0 || start > existing.length) {
        const error = new Error('聊天历史窗口已变化，请重新同步');
        error.code = 'HISTORY_WINDOW_MISMATCH';
        throw error;
    }
    if (start > 0 && incoming.length) {
        const expected = messageId(existing[start]);
        const received = messageId(incoming[0]);
        if (expected && received && expected !== received) {
            const error = new Error('聊天历史窗口已变化，请重新同步');
            error.code = 'HISTORY_WINDOW_MISMATCH';
            throw error;
        }
    }
    return { ...incomingSession, messages: [...existing.slice(0, start), ...incoming] };
}

module.exports = { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, historyPage, mergePartialSession, messageId };
