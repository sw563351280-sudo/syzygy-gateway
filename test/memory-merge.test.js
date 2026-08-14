'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeMemoryRevision } = require('../memory-merge');

test('a revision replaces the visible summary and keeps a compact private history', () => {
    const updated = mergeMemoryRevision({ id: 'a', content: '旧结论', tags: ['关系'], source: 'ai_active', arousal: 0.8, heat: 0.8, created_at: '2026-08-10T00:00:00Z' }, { content: '新结论，更完整。', tags: ['关系', '核心共识'], source: 'ai_active', arousal: 0.9, now: '2026-08-11T00:00:00Z' });
    assert.equal(updated.content, '新结论，更完整。');
    assert.deepEqual(updated.tags, ['关系', '核心共识']);
    assert.equal(updated.history[0].snapshot, '旧结论');
    assert.equal(updated.history[1].snapshot, '新结论，更完整。');
    assert.equal(updated.revision_count, 1);
    assert.equal(updated.ttl, 'perm');
    assert.equal(updated.expires_at, null);
});

test('a revision keeps the latest source quote and preserves its origin in history', () => {
    const updated = mergeMemoryRevision({ id: 'a', content: '旧结论', tags: ['关系'], source_quote: '我之前说过的原话', source_at: '2026-08-09T00:00:00Z', source_message_id: 'm-old', created_at: '2026-08-09T00:00:00Z' }, { content: '新结论', tags: ['关系'], source_quote: '我这次亲口说的新原话', source_at: '2026-08-10T00:00:00Z', source_message_id: 'm-new', now: '2026-08-10T00:00:00Z' });
    assert.equal(updated.source_quote, '我这次亲口说的新原话');
    assert.equal(updated.source_message_id, 'm-new');
    assert.equal(updated.history[0].source_quote, '我之前说过的原话');
    assert.equal(updated.history[1].source_quote, '我这次亲口说的新原话');
});
