'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    calculateSleepProbability,
    extractNextWakeTag,
    freshState,
    invalidateForUserMessage,
    markDelivered,
    normalizePlan,
    normalizeState,
    schedulePlan,
} = require('../adaptive-wake');

test('NEXT_WAKE uses a JSON body and is removed from visible text', () => {
    const parsed = extractNextWakeTag('先抱抱你。\n<NEXT_WAKE>{"after_minutes":30,"urgency":"medium","reason":"想晚点再看看"}</NEXT_WAKE>');
    assert.equal(parsed.cleanText, '先抱抱你。');
    assert.deepEqual(parsed.plan, { after_minutes: 30, urgency: 'medium', reason: '想晚点再看看' });
});

test('legacy and truncated NEXT_WAKE tags are hidden and fall back safely', () => {
    assert.equal(extractNextWakeTag('正文<NEXT_WAKE after="15m"/>').cleanText, '正文');
    assert.equal(extractNextWakeTag('正文<NEXT_WAKE>{"after_minutes":').cleanText, '正文');
});

test('strict trailing wake JSON is hidden even when its wrapper is missing or broken', () => {
    const body = '{"after_minutes":45,"urgency":"low","reason":"稍后再看看"}';
    for (const source of [
        `正文\n${body}`,
        `正文\nNEXT_WAKE>${body}`,
        `正文\n${body}</NEXT_WAKE>`,
        `正文\n<NEXT_WAKE>${body}`,
    ]) {
        const parsed = extractNextWakeTag(source);
        assert.equal(parsed.cleanText, '正文');
        assert.deepEqual(parsed.plan, { after_minutes: 45, urgency: 'low', reason: '稍后再看看' });
    }
});

test('ordinary trailing JSON and protocol examples remain visible', () => {
    const ordinary = '正文\n{"after_minutes":45,"urgency":"low","reason":"说明","extra":true}';
    const fenced = '示例：\n```json\n{"after_minutes":45,"urgency":"low","reason":"说明"}\n```';
    assert.equal(extractNextWakeTag(ordinary).cleanText, ordinary);
    assert.equal(extractNextWakeTag(fenced).cleanText, fenced);
});

test('adaptive plans clamp ordinary wakes to 15 minutes and critical wakes follow backoff', () => {
    const ordinary = normalizePlan({ after_minutes: 5, urgency: 'high' }, { random: () => 0.5 });
    assert.equal(ordinary.after_minutes, 15);
    const criticalFirst = normalizePlan({ after_minutes: 99, urgency: 'critical' }, { unansweredCount: 0, random: () => 0.5 });
    const criticalThird = normalizePlan({ after_minutes: 1, urgency: 'critical' }, { unansweredCount: 2, random: () => 0.5 });
    assert.equal(criticalFirst.after_minutes, 3);
    assert.equal(criticalThird.after_minutes, 30);
});

test('user input invalidates the current generation and resets unanswered count', () => {
    const state = markDelivered(markDelivered(freshState(new Date('2026-08-29T00:00:00Z'))));
    const next = invalidateForUserMessage(state, {
        now: new Date('2026-08-29T01:00:00Z'), sourceUserMessageId: 'msg_new', lastTopic: '新话题'
    });
    assert.equal(next.wake_generation, state.wake_generation + 1);
    assert.equal(next.unanswered_count, 0);
    assert.equal(next.due_at, null);
    assert.equal(next.source_user_message_id, 'msg_new');
});

test('normalizing an idle state keeps due_at empty', () => {
    assert.equal(normalizeState({ due_at: null }).due_at, null);
    assert.equal(normalizeState({ status: 'running' }).status, 'running');
});

test('writing a new plan advances the plan generation and keeps the source turn', () => {
    const initial = invalidateForUserMessage(freshState(), { sourceUserMessageId: 'msg_source' });
    const scheduled = schedulePlan(initial, { after_minutes: 45, urgency: 'medium', reason: '稍后再聊' }, { random: () => 0.5 });
    assert.equal(scheduled.wake_generation, initial.wake_generation + 1);
    assert.equal(scheduled.source_user_message_id, 'msg_source');
    assert.equal(scheduled.status, 'scheduled');
    assert.ok(scheduled.due_at);
});

test('five unanswered ordinary wakes get one cooldown probe and then stop', () => {
    let state = freshState(new Date('2026-08-29T00:00:00Z'));
    for (let i = 0; i < 5; i++) state = markDelivered(state);
    state = schedulePlan(state, { after_minutes: 30, urgency: 'medium' }, { now: new Date('2026-08-29T01:00:00Z'), random: () => 0.5 });
    assert.equal(state.status, 'cooldown_probe');
    assert.equal(state.after_minutes, 180);
    state = markDelivered(state);
    state = schedulePlan(state, { after_minutes: 30, urgency: 'medium' }, { now: new Date('2026-08-29T05:00:00Z'), random: () => 0.5 });
    assert.equal(state.status, 'stopped');
    assert.equal(state.due_at, null);
});

test('sleep probability uses Beijing time', () => {
    const now = new Date('2026-08-28T18:00:00Z'); // Beijing 02:00
    assert.ok(calculateSleepProbability(new Date('2026-08-28T16:00:00Z'), now) > 0.7);
});
