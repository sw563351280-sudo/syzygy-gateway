'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatProactiveMessagesForContext, selectRecentWakeHistory } = require('../wake-context');

function message(role, content, minute) {
    return { role, content, created_at: `2026-08-18T01:${String(minute).padStart(2, '0')}:00.000Z` };
}

test('wake history sorts a newest-first Zep response and keeps the newest messages', () => {
    const newestFirst = [
        message('assistant', 'a4', 8), message('user', 'u4', 7),
        message('assistant', 'a3', 6), message('user', 'u3', 5),
        message('assistant', 'a2', 4), message('user', 'u2', 3),
        message('assistant', 'a1', 2), message('user', 'u1', 1),
    ];
    const selected = selectRecentWakeHistory(newestFirst, [], 6);
    assert.deepEqual(selected.messages.map(item => item.content), ['u2', 'a2', 'u3', 'a3', 'u4', 'a4']);
    assert.equal(selected.usedFallback, false);
});

test('wake history fills an incomplete Zep result from web config without duplicating a turn', () => {
    const zep = [message('user', '刚才的话题', 5), message('assistant', '刚才的回答', 6)];
    const local = [
        message('user', '前一轮', 3), message('assistant', '前一轮回答', 4),
        message('user', '刚才的话题', 5), message('assistant', '刚才的回答', 6),
    ];
    const selected = selectRecentWakeHistory(zep, local, 6);
    assert.deepEqual(selected.messages.map(item => item.content), ['前一轮', '前一轮回答', '刚才的话题', '刚才的回答']);
    assert.equal(selected.usedFallback, true);
});

test('wake history keeps a newer local turn even when Zep already returned enough older messages', () => {
    const zep = [1, 2, 3, 4, 5, 6].map(minute => message(minute % 2 ? 'user' : 'assistant', `zep-${minute}`, minute));
    const local = [message('user', '网页端刚说的话', 7), message('assistant', '网页端刚回的话', 8)];
    const selected = selectRecentWakeHistory(zep, local, 6);
    assert.deepEqual(selected.messages.map(item => item.content), ['zep-3', 'zep-4', 'zep-5', 'zep-6', '网页端刚说的话', '网页端刚回的话']);
    assert.equal(selected.usedFallback, true);
});

test('wake history preserves proactive provenance when the same message also exists in Zep', () => {
    const zep = [message('assistant', '早安，鱼。', 8)];
    const local = [{ ...message('assistant', '早安，鱼。', 8), model: 'proactive' }];
    const selected = selectRecentWakeHistory(zep, local, 6);
    assert.equal(selected.messages.length, 1);
    assert.equal(selected.messages[0].model, 'proactive');
});

test('normal chat context explicitly includes persisted proactive message bodies', () => {
    const messages = [
        message('assistant', '普通回复', 7),
        { ...message('assistant', '我早上主动说的话', 8), model: 'proactive' },
    ];
    const context = formatProactiveMessagesForContext(messages, 3);
    assert.match(context, /你最近主动发给江鱼的消息原文/);
    assert.match(context, /我早上主动说的话/);
    assert.doesNotMatch(context, /普通回复/);
});
