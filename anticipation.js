'use strict';

const MIN_FOLLOW_UP_HOURS = 12;
const MAX_FOLLOW_UP_HOURS = 168;
const DEFAULT_FOLLOW_UP_HOURS = 24;
const MAX_ATTEMPTS = 2;
const CARE_START_HOUR = 8;
const CARE_END_HOUR = 23;
const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000;

function chinaParts(value) {
    const shifted = new Date(new Date(value).getTime() + CHINA_OFFSET_MS);
    return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate(), hour: shifted.getUTCHours() };
}
function chinaDate(year, month, day, hour) { return new Date(Date.UTC(year, month - 1, day, hour - 8, 0, 0, 0)); }
function clampFollowUpHours(value) {
    const hours = Number(value);
    return Number.isFinite(hours) ? Math.min(MAX_FOLLOW_UP_HOURS, Math.max(MIN_FOLLOW_UP_HOURS, Math.round(hours))) : DEFAULT_FOLLOW_UP_HOURS;
}
function nextCareWindow(value) {
    const source = new Date(value); const p = chinaParts(source);
    if (p.hour >= CARE_START_HOUR && p.hour < CARE_END_HOUR) return source;
    if (p.hour < CARE_START_HOUR) return chinaDate(p.year, p.month, p.day, 10);
    return chinaDate(p.year, p.month, p.day + 1, 10);
}
function dueFromHours(createdAt, followUpAfterHours) {
    return nextCareWindow(new Date(new Date(createdAt).getTime() + clampFollowUpHours(followUpAfterHours) * 3600000));
}
function parseDue(value, now = new Date()) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw || raw === 'tomorrow') return dueFromHours(now, 24);
    const relative = raw.match(/^(\d{1,3})\s*(h|hour|hours|d|day|days)$/);
    if (relative) return dueFromHours(now, Number(relative[1]) * (relative[2].startsWith('d') ? 24 : 1));
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return nextCareWindow(new Date(raw + 'T10:00:00+08:00'));
    const exact = new Date(raw); return Number.isNaN(exact.getTime()) ? dueFromHours(now, 24) : nextCareWindow(exact);
}
function extractAnticipationTags(text, now = new Date()) {
    const items = [];
    const cleanText = String(text || '').replace(/<ANTICIPATION\s+([^>]*)>([\s\S]*?)<\/ANTICIPATION>/gi, (all, attributes, content) => {
        const attrs = {};
        String(attributes).replace(/([a-z_]+)=["']([^"']+)["']/gi, (_, key, value) => { attrs[key.toLowerCase()] = value.trim(); return ''; });
        const question = String(content || '').trim().slice(0, 160); const entity = String(attrs.entity || '').trim().slice(0, 32);
        if (question.length >= 4 && entity) items.push({ content: question, entity, due_at: parseDue(attrs.due || attrs.after, now).toISOString(), created_from: 'shen_manual' });
        return '';
    }).trim();
    return { cleanText, items: items.slice(0, 2) };
}
function isDue(item, now = new Date()) {
    if (!item || item.status !== 'open' || Number(item.attempts || 0) >= Number(item.max_attempts || MAX_ATTEMPTS)) return false;
    if (item.expires_at && new Date(item.expires_at).getTime() < now.getTime()) return false;
    const p = chinaParts(now);
    return p.hour >= CARE_START_HOUR && p.hour < CARE_END_HOUR && new Date(item.due_at).getTime() <= now.getTime();
}
function makeAnticipation(input, now = new Date()) {
    const due = input.due_at ? nextCareWindow(input.due_at) : dueFromHours(now, input.follow_up_after_hours);
    return { id: input.id || `ant_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, source_crumb_id: input.source_crumb_id || null, content: String(input.content || '').trim().slice(0, 160), entity: String(input.entity || '').trim().slice(0, 32), reason: String(input.reason || '存在自然的后续').slice(0, 80), due_at: due.toISOString(), status: 'open', attempts: 0, max_attempts: MAX_ATTEMPTS, created_from: input.created_from || 'auto', created_at: new Date(now).toISOString(), last_asked_at: null, expires_at: new Date(due.getTime() + 7 * 86400000).toISOString() };
}
module.exports = { clampFollowUpHours, dueFromHours, extractAnticipationTags, isDue, makeAnticipation, nextCareWindow, parseDue };
