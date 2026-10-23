'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractAssistantReaction, oneEmoji } = require('../assistant-reaction');

test('accepts one complete emoji on the final standalone line', () => {
    assert.deepEqual(extractAssistantReaction('我知道啦。\n<REACT:🐶>'), {
        cleanContent: '我知道啦。', reaction: '🐶', hadTag: true
    });
    assert.equal(oneEmoji('👨‍👩‍👧‍👦'), '👨‍👩‍👧‍👦');
    assert.equal(oneEmoji('👍🏽'), '👍🏽');
    assert.equal(oneEmoji('🇨🇳'), '🇨🇳');
    assert.equal(oneEmoji('1️⃣'), '1️⃣');
    assert.deepEqual(extractAssistantReaction('我知道啦。\nREACT: 👥'), {
        cleanContent: '我知道啦。', reaction: '👥', hadTag: true
    });
});

test('rejects text, multiple emoji and reaction markup outside the terminal protocol zone', () => {
    assert.equal(extractAssistantReaction('正文\n<REACT:好耶>').reaction, null);
    assert.equal(extractAssistantReaction('正文\n<REACT:🐶🐟>').reaction, null);
    assert.equal(extractAssistantReaction('<REACT:🐶>\n后文').reaction, null);
    assert.equal(extractAssistantReaction('示例：`<REACT:🐶>`').reaction, null);
    assert.equal(oneEmoji('A'), null);
});

test('swallows terminal reaction markup when disabled but preserves incomplete prose', () => {
    assert.deepEqual(extractAssistantReaction('正文\n<REACT:🐾>', { enabled: false }), {
        cleanContent: '正文', reaction: null, hadTag: true
    });
    assert.equal(extractAssistantReaction('正文\n<REACT:🐾').cleanContent, '正文\n<REACT:🐾');
    assert.equal(extractAssistantReaction('前面\n<REACT:🐶>\n后面').cleanContent, '前面\n<REACT:🐶>\n后面');
});

test('accepts reaction before or after other terminal tags and uses the last valid reaction', () => {
    const crumb = '<CRUMB>{"fact":"一件事"}</CRUMB>';
    assert.deepEqual(extractAssistantReaction(`正文\n<REACT:🐶>\n${crumb}`), {
        cleanContent: `正文\n${crumb}`, reaction: '🐶', hadTag: true
    });
    assert.deepEqual(extractAssistantReaction(`正文\n${crumb}\n<REACT:🐟>`), {
        cleanContent: `正文\n${crumb}`, reaction: '🐟', hadTag: true
    });
    assert.equal(extractAssistantReaction('正文\n<REACT:🐶>\n<REACT:文字>\n<REACT:🐟>').reaction, '🐟');
});

test('extracts a reaction glued to prose when another terminal tag follows it', () => {
    const wake = '<NEXT_WAKE>{"after_minutes":30,"urgency":"low","reason":"晚点再看看"}</NEXT_WAKE>';
    assert.deepEqual(extractAssistantReaction(`正文。<REACT:🫂>${wake}`), {
        cleanContent: `正文。${wake}`,
        reaction: '🫂',
        hadTag: true,
    });
});
