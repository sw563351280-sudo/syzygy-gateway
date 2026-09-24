'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { budgetDynamicParts } = require('../dynamic-budget');

test('keeps essential facts intact and bounds optional retrieval without touching source', () => {
    const state = '【当前账本状态】\n余额123，待办明天完成。';
    const memory = '【长期记忆雷达】\n' + '记忆原文。'.repeat(500);
    const parts = [memory, state];
    const result = budgetDynamicParts(parts, { maxTokens: 300, detailTokens: 200 });
    assert.equal(result.parts.at(-1), state);
    assert.equal(parts[0], memory);
    assert.ok(result.metrics.afterTokens <= 300);
    assert.equal(result.metrics.truncated, 1);
    assert.match(result.parts[0], /资料节选/);
});

test('essential-only overflow is explicit, never cuts tasks or instructions', () => {
    const rule = '【固定规则】\n' + '规则。'.repeat(200);
    const result = budgetDynamicParts([rule, '【历史原文】\n不重要'], { maxTokens: 100 });
    assert.deepEqual(result.parts, [rule]);
    assert.equal(result.metrics.essentialOverBudget, true);
});

test('duplicate optional passages are removed and no prompt text enters metrics', () => {
    const secret = '【长期记忆】\nPRIVATE_SECRET';
    const result = budgetDynamicParts([secret, secret]);
    assert.equal(result.parts.length, 1);
    assert.equal(result.metrics.dropped, 1);
    assert.equal(JSON.stringify(result.metrics).includes('PRIVATE_SECRET'), false);
});
