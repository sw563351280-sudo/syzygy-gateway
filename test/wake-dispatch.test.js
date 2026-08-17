'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isWakeQuietHours, millisecondsUntilWakeDispatchWindow, parseProactiveMessageParts } = require('../wake-dispatch');

test('wake dispatch pauses only during Beijing 02:00 through 06:59', () => {
    assert.equal(isWakeQuietHours(new Date('2026-08-13T18:30:00.000Z')), true); // 02:30 CST
    assert.equal(isWakeQuietHours(new Date('2026-08-13T23:00:00.000Z')), false); // 07:00 CST
    assert.equal(millisecondsUntilWakeDispatchWindow(new Date('2026-08-13T18:30:00.000Z')), 4.5 * 60 * 60 * 1000);
    assert.equal(millisecondsUntilWakeDispatchWindow(new Date('2026-08-13T23:00:00.000Z')), null);
});

test('proactive replies are direct messages and can split into a small batch', () => {
    assert.deepEqual(parseProactiveMessageParts('我想找你。'), { type: 'messages', parts: ['我想找你。'] });
    assert.deepEqual(parseProactiveMessageParts('第一条\n---\n第二条'), { type: 'messages', parts: ['第一条', '第二条'] });
    assert.deepEqual(parseProactiveMessageParts('SEND: 鱼，嘴别咬了。'), { type: 'messages', parts: ['鱼，嘴别咬了。'] });
    assert.deepEqual(parseProactiveMessageParts('SILENT'), { type: 'legacy_control_token', parts: [] });
    assert.deepEqual(parseProactiveMessageParts('WALK_XHS'), { type: 'legacy_control_token', parts: [] });
    assert.deepEqual(parseProactiveMessageParts('<think>先分析一下</think>'), { type: 'empty', parts: [] });
});
