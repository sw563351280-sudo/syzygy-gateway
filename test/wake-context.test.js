'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { filterConversationHistoryToReference, selectRecentWakeHistory } = require('../wake-context');

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

test('main reference filters historical workroom rows out of the global Zep session', () => {
    const main = [message('user', '小屋里的话', 5), message('assistant', '小屋里的回答', 6)];
    const zep = [
        message('user', '工作区原话', 3), message('assistant', '工作区回应', 4),
        ...main,
    ];
    const filtered = filterConversationHistoryToReference(zep, main);
    assert.deepEqual(filtered.map(item => item.content), ['小屋里的话', '小屋里的回答']);
});

test('main reference supplies local timestamps so timestamp-less Zep rows deduplicate', () => {
    const main = [message('user', '小屋里的话', 5), message('assistant', '小屋里的回答', 6)];
    const zep = main.map(({ role, content }) => ({ role, content }));
    const filtered = filterConversationHistoryToReference(zep, main);
    const selected = selectRecentWakeHistory(filtered, main, 30);
    assert.equal(filtered[0].created_at, main[0].created_at);
    assert.deepEqual(selected.messages.map(item => item.content), ['小屋里的话', '小屋里的回答']);
});

test('a thirty-message window preserves every selected message in full', () => {
    const long = '长'.repeat(5000);
    const main = Array.from({ length: 35 }, (_, index) => message(index % 2 ? 'assistant' : 'user', index === 34 ? long : `m-${index}`, index));
    const selected = selectRecentWakeHistory([], main, 30);
    assert.equal(selected.messages.length, 30);
    assert.equal(selected.messages[0].content, 'm-5');
    assert.equal(selected.messages.at(-1).content, long);
});
