'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { canonical } = require('./memory-write-utils');

const ACTIVE_STATUSES = new Set(['received', 'processing', 'pending', 'needs_review']);
const MAX_AUTO_ATTEMPTS = 10;
const MINUTE_MS = 60 * 1000;
const RETRY_DELAYS_MS = [5, 15, 30, 60, 120, 240, 480, 720, 1440].map(minutes => minutes * MINUTE_MS);
function invalidReviewResult(event) {
    return event?.kind === 'long_term' && /memory merge curator returned no valid decision/.test(String(event.error || ''));
}

function autoRetryExhausted(event, maxAttempts = MAX_AUTO_ATTEMPTS) {
    return event?.kind === 'long_term' && Number(event?.attempts || 0) >= maxAttempts;
}

function nextAutoRetryAt(event, now = new Date()) {
    const attempts = Math.max(1, Number(event?.attempts || 1));
    const delay = RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)];
    return new Date(now.getTime() + delay).toISOString();
}

function autoRetryDue(event, now = new Date()) {
    if (invalidReviewResult(event)) return false;
    if (autoRetryExhausted(event)) return false;
    if (!event?.next_retry_at) return true;
    const due = new Date(event.next_retry_at).getTime();
    return !Number.isFinite(due) || due <= now.getTime();
}

function eventKey(kind, payload = {}) {
    const messageId = String(payload.source_message_id || '').trim();
    const slot = Number.isInteger(payload.tag_index) ? payload.tag_index : 0;
    if (messageId) return `${kind}:message:${messageId}:${slot}`;

    if (kind === 'crumb') {
        const at = String(payload.source_at || payload.happened_at || payload.created_at || new Date().toISOString());
        const day = at.slice(0, 10);
        return `${kind}:fallback:${day}:${canonical(payload.source_quote)}:${canonical(payload.fact)}`;
    }
    const at = String(payload.source_at || payload.created_at || new Date().toISOString());
    return `${kind}:fallback:${at.slice(0, 10)}:${canonical(payload.content)}`;
}

function readMemoryEvents(file) {
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch (_) { return []; }
    const byId = new Map();
    for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
            const event = JSON.parse(line);
            if (event?.id) byId.set(event.id, event);
        } catch (_) {
            // An interrupted append may leave one incomplete trailing line.
            // Earlier snapshots remain valid and are still recoverable.
        }
    }
    // Recover previously queued format failures without another model call or
    // deleting/recreating the durable event. Manual retry clears its error.
    return [...byId.values()].map(event => invalidReviewResult(event) && ['pending', 'received', 'processing'].includes(event.status)
        ? { ...event, status: 'needs_review', next_retry_at: null } : event);
}

function appendEventSnapshot(file, event) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(event)}\n`, 'utf8');
    return event;
}

function receiveMemoryEvent(file, kind, payload = {}, now = new Date()) {
    const key = eventKey(kind, payload);
    const existing = readMemoryEvents(file).find(item => item.key === key);
    if (existing) return { event: existing, created: false };
    const at = now.toISOString();
    const event = {
        id: `mev_${now.getTime().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
        key,
        kind,
        status: 'received',
        attempts: 0,
        payload,
        created_at: at,
        updated_at: at,
        error: null,
        decision: null,
        candidates: [],
        result_id: null,
    };
    appendEventSnapshot(file, event);
    return { event, created: true };
}

function updateMemoryEvent(file, event, patch = {}, now = new Date()) {
    const updated = { ...event, ...patch, updated_at: now.toISOString() };
    appendEventSnapshot(file, updated);
    return updated;
}

function publicMemoryEvent(event) {
    const payload = event.payload || {};
    return {
        id: event.id,
        kind: event.kind,
        status: event.status,
        attempts: event.attempts || 0,
        content: event.kind === 'crumb' ? payload.fact : payload.content,
        source_quote: payload.source_quote || '',
        source_at: payload.source_at || event.created_at,
        tags: payload.tags || [],
        created_at: event.created_at,
        updated_at: event.updated_at,
        error: event.error || null,
        next_retry_at: event.next_retry_at || null,
        decision: event.decision || null,
        candidates: event.candidates || [],
        result_id: event.result_id || null,
    };
}

function activeMemoryEvents(events) {
    return (events || []).filter(event => ACTIVE_STATUSES.has(event.status));
}

module.exports = {
    ACTIVE_STATUSES,
    MAX_AUTO_ATTEMPTS,
    activeMemoryEvents,
    autoRetryDue,
    autoRetryExhausted,
    appendEventSnapshot,
    eventKey,
    nextAutoRetryAt,
    publicMemoryEvent,
    readMemoryEvents,
    receiveMemoryEvent,
    updateMemoryEvent,
};
