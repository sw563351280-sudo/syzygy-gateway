'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractThinkingFromContent } = require('../public/thinking-parser');

test('extracts genuine thinking tags', () => {
    assert.deepEqual(extractThinkingFromContent('<think>内部分析</think>可见正文'), {
        thinking: '内部分析',
        visibleContent: '可见正文',
    });
});

test('does not treat thinking examples inside markdown code as hidden reasoning', () => {
    const inline = '检查 `thinking` 字段或者 `<thinking>` 标签，然后继续正文。';
    assert.deepEqual(extractThinkingFromContent(inline), { thinking: '', visibleContent: inline });
    const fenced = '示例：\n```html\n<thinking>只是示例</thinking>\n```\n后续正文';
    assert.deepEqual(extractThinkingFromContent(fenced), { thinking: '', visibleContent: fenced });
});

test('keeps an unfinished inline-code example visible while streaming', () => {
    const partial = '有没有把 `thinking` 字段或者 `<thinking>';
    assert.deepEqual(extractThinkingFromContent(partial), { thinking: '', visibleContent: partial });
});
