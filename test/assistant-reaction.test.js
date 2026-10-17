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
});

test('rejects text, multiple emoji and non-final reaction instructions', () => {
    assert.equal(extractAssistantReaction('正文\n<REACT:好耶>').reaction, null);
    assert.equal(extractAssistantReaction('正文\n<REACT:🐶🐟>').reaction, null);
    assert.equal(extractAssistantReaction('<REACT:🐶>\n后文').reaction, null);
    assert.equal(oneEmoji('A'), null);
});

test('always swallows reaction markup even when disabled or incomplete', () => {
    assert.deepEqual(extractAssistantReaction('正文\n<REACT:🐾>', { enabled: false }), {
        cleanContent: '正文', reaction: null, hadTag: true
    });
    assert.equal(extractAssistantReaction('正文\n<REACT:🐾').cleanContent, '正文');
    assert.equal(extractAssistantReaction('前面\n<REACT:🐶>\n后面').cleanContent, '前面\n后面');
});
