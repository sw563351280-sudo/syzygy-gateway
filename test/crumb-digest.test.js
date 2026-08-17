'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDigestMessages, createCrumbDigest, normalizeDigest } = require('../crumb-digest');

test('digest prompt keeps Shen as the narrator', () => {
    const prompt = buildDigestMessages('2026-08-12', [{ fact: '我记着你去办了银行卡。' }])[0].content;
    assert.match(prompt, /沈望第一人称/);
    assert.match(prompt, /我=沈望、你=江鱼/);
});

test('digest keeps a summary but accepts no long-term upgrade', () => {
    const result = normalizeDigest({ summary: '去办了银行卡，晚些时候聊了妹妹。', themes: ['出门', '妹妹'], memory_candidates: [] }, 3);
    assert.equal(result.source_count, 3);
    assert.equal(result.memory_candidates.length, 0);
});

test('digest allows at most one well-formed long-term candidate', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ summary: '妹妹术后恢复良好。', themes: ['妹妹'], memory_candidates: [{ content: '妹妹在日本完成手术后恢复良好。', tags: ['妹妹', '手术'], reason: '重要事件已有结果' }, { content: '第二条', tags: ['忽略'] }] }) } }] }) });
    const result = await createCrumbDigest({ fetchImpl, apiKey: 'secret', endpoint: 'https://example.test', model: 'flash', date: '2026-08-11', crumbs: [{ fact: '妹妹术后恢复良好' }] });
    assert.equal(result.memory_candidates.length, 1);
    assert.equal(result.memory_candidates[0].tags[0], '妹妹');
});
