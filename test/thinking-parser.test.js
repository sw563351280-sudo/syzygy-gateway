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

test('extracts a fenced ```thinking block and keeps only trailing text', () => {
    assert.deepEqual(extractThinkingFromContent('```thinking\n内部分析\n```\n行，你修。'), {
        thinking: '内部分析',
        visibleContent: '行，你修。',
    });
});

test('extracts ```reasoning and ```think fences too', () => {
    assert.deepEqual(extractThinkingFromContent('```reasoning\n一段推理\n```\n正文'), {
        thinking: '一段推理',
        visibleContent: '正文',
    });
    assert.deepEqual(extractThinkingFromContent('```think\n思考\n```\n答'), {
        thinking: '思考',
        visibleContent: '答',
    });
});

test('hides an unclosed ```thinking fence while streaming', () => {
    assert.deepEqual(extractThinkingFromContent('```thinking\n内部分析还没闭合'), {
        thinking: '内部分析还没闭合',
        visibleContent: '',
    });
});

test('hides a partial ```think fence marker while streaming', () => {
    assert.deepEqual(extractThinkingFromContent('```think'), { thinking: '', visibleContent: '' });
});

test('does not treat a plain code fence as thinking', () => {
    const code = '```js\nconst x = 1;\n```\n后续';
    assert.deepEqual(extractThinkingFromContent(code), { thinking: '', visibleContent: code });
});
