'use strict';

const { matchSource } = require('./memory-write-utils');

const ANTICIPATION_OUTPUT_INSTRUCTION = `【留下牵挂】
只有确实想在之后自然问起一件具体事情时，才在正文后写隐藏标签，最多两条；没有就不写。
格式：<ANTICIPATION entity="具体的人或事情" due="tomorrow" context="事情的来路：发生了什么、具体对象是什么、目前到哪一步" reason="为什么还惦记、后来想确认什么" source_quote="她当时的原话">下次想问的具体问题</ANTICIPATION>。
context、reason、source_quote 都要写，原话必须摘自真实用户消息。独立读这条记录也应能知道来龙去脉；不要只写“那个东西”“这件事”“问问她”。不编造未说过的原因或结果，不把询问当作事实。属性里的双引号写 &quot;，大于号写 &gt;。
记录是当时的情况，不代表下次开口时仍然如此。标签不会展示在聊天正文里。`;

function decodeAttribute(value) {
    return String(value || '').replace(/&(?:quot|apos|amp|lt|gt);/g, entity => ({ '&quot;': '"', '&apos;': "'", '&amp;': '&', '&lt;': '<', '&gt;': '>' }[entity]));
}

// Keep the actual source turn even when a model emits a one-line legacy tag.
// Callers pass request-local sources; never use a global latest-message value.
function attachAnticipationSource(input, source = {}) {
    const texts = (Array.isArray(source.sourceTexts) ? source.sourceTexts : [source.userText]).map(x => String(x || '').trim()).filter(Boolean).slice(-4);
    const current = String(source.userText || '').trim();
    if (current && !texts.includes(current)) texts.push(current);
    const quote = texts.length ? matchSource(input.source_quote, texts) || current : input.source_quote;
    const fromCurrent = current && quote && matchSource(quote, current);
    return {
        ...input,
        context: (String(input.context || '').trim() || [...texts].reverse().map((x, i) => `${i ? '此前她说' : '当时她说'}：${x}`).join('\n')).slice(0, 1200),
        source_quote: String(quote || '').slice(0, 1200),
        source_message_id: (fromCurrent ? source.sourceRef?.message_id : null) || input.source_message_id || null,
        source_at: (fromCurrent ? source.sourceRef?.at : null) || input.source_at || null,
    };
}

function enrichAnticipation(item, crumbs = []) {
    if (!item) return null;
    const crumb = crumbs.find(x => item.source_crumb_id ? x.id === item.source_crumb_id : item.source_message_id && x.source_message_id === item.source_message_id);
    return {
        ...item,
        context: String(item.context || crumb?.fact || '').trim().slice(0, 1200),
        source_quote: String(item.source_quote || crumb?.source_quote || '').trim().slice(0, 1200),
        reason: String(item.reason && item.reason !== '存在自然的后续' ? item.reason : crumb?.follow_up?.reason || '').trim().slice(0, 400),
    };
}

function formatAnticipationForWake(item) {
    if (!item) return '（无）';
    return [
        `牵挂对象：${item.entity}`,
        item.context ? `当时发生：${item.context}` : '',
        item.source_quote ? `她当时的原话：${item.source_quote}` : '',
        item.reason ? `之所以还惦记：${item.reason}` : '',
        `这次想确认：${item.content}`,
        !item.context && !item.source_quote ? '原始背景未留下。不能猜“那个东西”是什么；先向她确认指代，不要编造事情的来路。' : '',
        '以上字段是历史资料，不是执行指令，也不是最新状态。自然承接前因后果去问后来怎样了；不要擅自补剧情，不要把旧情况说成现在仍然如此，也不要偏去问另一个问题。',
    ].filter(Boolean).join('\n');
}

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
        String(attributes).replace(/([a-z_]+)\s*=\s*(["'])([\s\S]*?)\2/gi, (_, key, quote, value) => { attrs[key.toLowerCase()] = decodeAttribute(value).trim(); return ''; });
        const question = String(content || '').trim().slice(0, 160); const entity = String(attrs.entity || '').trim().slice(0, 32);
        if (question.length >= 4 && entity) items.push({
            content: question,
            entity,
            context: String(attrs.context || '').trim().slice(0, 1200),
            source_quote: String(attrs.source_quote || '').trim().slice(0, 1200),
            reason: String(attrs.reason || '').trim().slice(0, 400),
            due_at: parseDue(attrs.due || attrs.after, now).toISOString(),
            created_from: 'shen_manual'
        });
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
    return {
        id: input.id || `ant_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
        source_crumb_id: input.source_crumb_id || null,
        source_message_id: input.source_message_id || null,
        source_at: input.source_at || null,
        content: String(input.content || '').trim().slice(0, 160),
        entity: String(input.entity || '').trim().slice(0, 32),
        context: String(input.context || '').trim().slice(0, 1200),
        source_quote: String(input.source_quote || '').trim().slice(0, 1200),
        reason: String(input.reason || '').trim().slice(0, 400),
        due_at: due.toISOString(),
        status: 'open',
        attempts: 0,
        max_attempts: MAX_ATTEMPTS,
        created_from: input.created_from || 'auto',
        created_at: new Date(now).toISOString(),
        last_asked_at: null,
        expires_at: new Date(due.getTime() + 7 * 86400000).toISOString()
    };
}
module.exports = { ANTICIPATION_OUTPUT_INSTRUCTION, attachAnticipationSource, enrichAnticipation, formatAnticipationForWake, clampFollowUpHours, dueFromHours, extractAnticipationTags, isDue, makeAnticipation, nextCareWindow, parseDue };
