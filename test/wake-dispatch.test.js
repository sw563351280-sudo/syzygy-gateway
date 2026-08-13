'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isWakeQuietHours, millisecondsUntilWakeDispatchWindow, parseWakeDecision } = require('../wake-dispatch');

test('wake dispatch pauses only during Beijing 02:00 through 06:59', () => {
    assert.equal(isWakeQuietHours(new Date('2026-08-13T18:30:00.000Z')), true); // 02:30 CST
    assert.equal(isWakeQuietHours(new Date('2026-08-13T23:00:00.000Z')), false); // 07:00 CST
    assert.equal(millisecondsUntilWakeDispatchWindow(new Date('2026-08-13T18:30:00.000Z')), 4.5 * 60 * 60 * 1000);
    assert.equal(millisecondsUntilWakeDispatchWindow(new Date('2026-08-13T23:00:00.000Z')), null);
});

test('wake replies accept only explicit silent, send, or XHS decisions', () => {
    assert.deepEqual(parseWakeDecision('SILENT'), { type: 'silent' });
    assert.deepEqual(parseWakeDecision('SEND: 鱼，嘴别咬了。'), { type: 'send', content: '鱼，嘴别咬了。' });
    assert.deepEqual(parseWakeDecision('WALK_XHS'), { type: 'xhs_walk' });
    assert.deepEqual(parseWakeDecision('我想找你。'), { type: 'silent' });
});
