'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    applyDecision,
    curateRelationshipMemory,
    emptyRelationshipStore,
    looksRelationshipRelevant,
    normalizeDecision,
} = require('../relationship-reflections');

function memory(id, content, at = '2026-09-10T10:00:00.000Z') {
    return { id, content, tags: ['沟通'], source_quote: content, source_at: at, created_at: at, updated_at: at };
}

test('only routes likely relationship process memories to the curator', () => {
    assert.equal(looksRelationshipRelevant(memory('a', '我们吵架后把误会说开，又和好了。')), true);
    assert.equal(looksRelationshipRelevant({ id: 'b', content: '今天开始练车。', tags: ['驾驶'] }), false);
});

test('invalid attach target is isolated into a new episode', () => {
    const input = memory('m1', '一次沟通');
    const decision = normalizeDecision({
        eligible: true,
        episode_action: 'attach',
        episode_id: 'missing',
        episode: { title: '沟通', summary: '摘要', status: 'open', themes: ['回应'] },
        event: { stage: 'trigger', summary: '起因', occurred_at: input.source_at },
        insights: [],
    }, input, emptyRelationshipStore());
    assert.equal(decision.episode_action, 'create');
    assert.equal(decision.episode_id, null);
});

test('a hot conflict cannot create a lesson before repair', () => {
    const input = memory('m1', '争吵正在升级');
    const decision = normalizeDecision({
        eligible: true,
        episode_action: 'create',
        episode: { title: '回应方式争执', summary: '仍在争执', status: 'open', themes: ['回应'] },
        event: { stage: 'escalation', summary: '情绪升级', occurred_at: input.source_at },
        insights: [{ key: 'listen-first', title: '先听', observation: '她需要被听见', lesson: '先听', next_time: '先确认感受', support_memory_ids: ['m1'] }],
    }, input, emptyRelationshipStore());
    assert.deepEqual(decision.insights, []);
});

test('resolved episodes create traceable tentative insights and writes are idempotent', () => {
    const input = memory('m1', '后来先确认感受，误会说开后和好了。');
    const decision = normalizeDecision({
        eligible: true,
        episode_action: 'create',
        episode: { title: '回应方式的误会', summary: '从误解到修复', status: 'resolved', themes: ['倾听'] },
        event: { stage: 'resolution', summary: '先确认感受后和好', occurred_at: input.source_at },
        insights: [{ key: 'listen-first', title: '先确认感受', observation: '确认感受帮助了修复', lesson: '解释之前先确认她在意什么', next_time: '先复述她的感受，再解释意图', support_memory_ids: ['m1'] }],
    }, input, emptyRelationshipStore());
    const first = applyDecision(emptyRelationshipStore(), input, decision, new Date('2026-09-10T12:00:00Z'));
    assert.equal(first.store.episodes.length, 1);
    assert.equal(first.store.insights[0].confidence, 'tentative');
    assert.deepEqual(first.store.insights[0].support_memory_ids, ['m1']);
    const second = applyDecision(first.store, input, decision, new Date('2026-09-10T13:00:00Z'));
    assert.equal(second.changed, false);
    assert.equal(second.store.episodes[0].events.length, 1);
});

test('confidence only becomes stable after evidence across episodes', () => {
    let store = emptyRelationshipStore();
    for (let i = 1; i <= 3; i++) {
        const input = memory(`m${i}`, `第${i}次在确认感受后完成修复`, `2026-09-${10 + i}T10:00:00.000Z`);
        const priorIds = Array.from({ length: i }, (_, index) => `m${index + 1}`);
        const decision = normalizeDecision({
            eligible: true,
            episode_action: 'create',
            episode: { title: `第${i}次沟通`, summary: '完成修复', status: 'resolved', themes: ['倾听'] },
            event: { stage: 'resolution', summary: '确认感受后修复', occurred_at: input.source_at },
            insights: [{ key: 'listen-first', title: '先确认感受', observation: '先确认感受常能降低误解', lesson: '不要急着解释', next_time: '先复述感受', support_memory_ids: priorIds }],
        }, input, store);
        store = applyDecision(store, input, decision, new Date(input.source_at)).store;
    }
    assert.equal(store.insights[0].support_memory_ids.length, 3);
    assert.equal(store.insights[0].episode_ids.length, 3);
    assert.equal(store.insights[0].confidence, 'stable');
});

test('curator retries without response_format and keeps evidence ids constrained', async () => {
    const requests = [];
    const input = memory('m1', '误会说开后和好了');
    const fetchImpl = async (_, options) => {
        requests.push(JSON.parse(options.body));
        if (requests.length === 1) return { ok: false, status: 400 };
        return { ok: true, status: 200, async json() { return { choices: [{ message: { content: JSON.stringify({
            eligible: true,
            episode_action: 'create',
            episode: { title: '一次误会', summary: '已经修复', status: 'resolved', themes: ['沟通'] },
            event: { stage: 'resolution', summary: '说开了', occurred_at: input.source_at },
            insights: [{ key: 'say-it', title: '说开', observation: '表达有帮助', lesson: '及时说开', next_time: '主动询问', support_memory_ids: ['m1', 'hallucinated'] }],
        }) } }] }; } };
    };
    const result = await curateRelationshipMemory({ fetchImpl, apiKey: 'secret', endpoint: 'https://example.test', model: 'strong-model', memory: input, store: emptyRelationshipStore() });
    assert.equal(requests.length, 2);
    assert.equal(requests[0].model, 'strong-model');
    assert.deepEqual(result.insights[0].support_memory_ids, ['m1']);
});
