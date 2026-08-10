'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeMemoryRevision, selectMemoryMergeCandidate } = require('../memory-merge');

test('selects an automatic memory revision for the same continuing topic', () => {
    const memories = [{ id: 'a', source: 'ai_active', content: '江鱼和沈望讨论 prompt 修改：把吵架模块压缩成说真话的核心原则。', tags: ['prompt修改', '吵架模块'], created_at: '2026-08-10T00:00:00Z' }];
    const hit = selectMemoryMergeCandidate('江鱼与沈望继续修改 prompt，确认吵架模块只保留说真话这一条原则。', ['prompt修改', '吵架模块', '核心共识'], memories);
    assert.equal(hit.memory.id, 'a');
});

test('keeps manual and unrelated memories out of automatic merging', () => {
    const memories = [{ id: 'manual', source: 'manual', content: '江鱼希望冲突时听到真话。', tags: ['关系'] }, { id: 'other', source: 'ai_active', content: '江鱼周五开始放高温假。', tags: ['高温假'] }];
    assert.equal(selectMemoryMergeCandidate('江鱼和沈望继续修改 prompt 的吵架模块。', ['prompt修改', '吵架模块'], memories), null);
});

test('does not treat generic people tags as a shared topic', () => {
    const memories = [{ id: 'a', source: 'ai_active', content: '江鱼和沈望确定下周旅行路线。', tags: ['江鱼', '沈望'] }];
    assert.equal(selectMemoryMergeCandidate('江鱼和沈望讨论新的模型价格。', ['江鱼', '沈望'], memories), null);
});

test('a revision replaces the visible summary and keeps a compact private history', () => {
    const updated = mergeMemoryRevision({ id: 'a', content: '旧结论', tags: ['关系'], source: 'ai_active', arousal: 0.8, heat: 0.8, created_at: '2026-08-10T00:00:00Z' }, { content: '新结论，更完整。', tags: ['关系', '核心共识'], source: 'ai_active', arousal: 0.9, now: '2026-08-11T00:00:00Z' });
    assert.equal(updated.content, '新结论，更完整。');
    assert.deepEqual(updated.tags, ['关系', '核心共识']);
    assert.equal(updated.previous_versions[0].content, '旧结论');
    assert.equal(updated.revision_count, 1);
});
