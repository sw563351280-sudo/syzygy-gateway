'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    applyDecision,
    buildMessages,
    curateRealityMemory,
    emptyRealityStore,
    normalizeDecision,
} = require('../reality-events');

function memory(id, content, at = '2026-09-10T10:00:00.000Z') {
    return { id, content, tags: [], source_quote: content, source_at: at, created_at: at, updated_at: at };
}

function decisionFor(input, overrides = {}) {
    return normalizeDecision({
        eligible: true,
        event_action: 'create',
        event_id: null,
        event: { title: '学习开车', kind: 'learning', summary: '从零开始学习驾驶', status: 'active', subjects: ['练车'] },
        milestone: { stage: 'beginning', summary: input.content, occurred_at: input.source_at },
        ...overrides,
    }, input, overrides.candidates || []);
}

test('non-event memories are marked processed without creating a timeline', () => {
    const input = memory('m0', '今天忽然有点烦。');
    const decision = normalizeDecision({ eligible: false, reason: '一次性情绪' }, input, []);
    const result = applyDecision(emptyRealityStore(), input, decision, new Date('2026-09-10T12:00:00Z'));
    assert.equal(result.changed, true);
    assert.equal(result.store.events.length, 0);
    assert.equal(result.store.processed.m0.eligible, false);
});

test('creates a reality event and keeps repeated writes idempotent', () => {
    const input = memory('m1', '今天第一次去练车。');
    const decision = decisionFor(input);
    const first = applyDecision(emptyRealityStore(), input, decision, new Date('2026-09-10T12:00:00Z'));
    assert.equal(first.store.events.length, 1);
    assert.equal(first.store.events[0].milestones.length, 1);
    const second = applyDecision(first.store, input, decision, new Date('2026-09-10T13:00:00Z'));
    assert.equal(second.changed, false);
    assert.equal(second.store.events[0].milestones.length, 1);
});

test('attaches later progress and sorts milestones by event time', () => {
    const later = memory('m2', '已经能独立完成倒车入库。', '2026-09-12T10:00:00.000Z');
    let store = applyDecision(emptyRealityStore(), later, decisionFor(later), new Date('2026-09-12T12:00:00Z')).store;
    const event = store.events[0];
    const earlier = memory('m1', '第一天认识车辆控制。', '2026-09-11T10:00:00.000Z');
    const attached = normalizeDecision({
        eligible: true,
        event_action: 'attach',
        event_id: event.id,
        event: { title: '学习开车', kind: 'learning', summary: '练车逐渐有了进展', status: 'active', subjects: ['练车'] },
        milestone: { stage: 'beginning', summary: earlier.content, occurred_at: earlier.source_at },
    }, earlier, [event]);
    store = applyDecision(store, earlier, attached, new Date('2026-09-13T12:00:00Z')).store;
    assert.deepEqual(store.events[0].milestones.map(item => item.memory_id), ['m1', 'm2']);
    assert.equal(store.events[0].started_at, earlier.source_at);
});

test('invalid attach target is converted to a separate event', () => {
    const input = memory('job2', '今天入职了第二家公司。');
    const decision = normalizeDecision({
        eligible: true,
        event_action: 'attach',
        event_id: 'old-job',
        event: { title: '第二段工作', kind: 'work', summary: '开始新的工作', status: 'active', subjects: ['工作'] },
        milestone: { stage: 'beginning', summary: input.content, occurred_at: input.source_at },
    }, input, []);
    assert.equal(decision.event_action, 'create');
    assert.equal(decision.event_id, null);
});

test('organizer prompt distinguishes later jobs from earlier completed jobs', () => {
    const built = buildMessages(memory('job2', '今天入职第二家公司。'), emptyRealityStore());
    assert.match(built.messages[0].content, /第二份工作必须 create/);
    assert.match(built.messages[0].content, /妹妹这只猫/);
});

test('curator retries without response_format and normalizes its decision', async () => {
    const requests = [];
    const input = memory('cat1', '妹妹今天做完了绝育手术。');
    const fetchImpl = async (_, options) => {
        requests.push(JSON.parse(options.body));
        if (requests.length === 1) return { ok: false, status: 400 };
        return { ok: true, status: 200, async json() { return { choices: [{ message: { content: JSON.stringify({
            eligible: true,
            event_action: 'create',
            event: { title: '妹妹的生活', kind: 'pet', summary: '妹妹完成绝育手术', status: 'active', subjects: ['妹妹'] },
            milestone: { stage: 'milestone', summary: '完成绝育手术', occurred_at: input.source_at },
        }) } }] }; } };
    };
    const result = await curateRealityMemory({ fetchImpl, apiKey: 'secret', endpoint: 'https://example.test', model: 'strong-model', memory: input, store: emptyRealityStore() });
    assert.equal(requests.length, 2);
    assert.equal(requests[0].model, 'strong-model');
    assert.equal(result.event.kind, 'pet');
});
