'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractAnticipationTags, isDue, makeAnticipation } = require('../anticipation');

test('manual anticipation tags are hidden and fall into a daytime window', () => {
    const result = extractAnticipationTags('明天问她。<ANTICIPATION due="tomorrow" entity="头疼" context="她今晚说偏头疼" reason="想确认休息后有没有缓解">问问头还疼不疼</ANTICIPATION>', new Date('2026-08-11T20:00:00+08:00'));
    assert.equal(result.cleanText, '明天问她。'); assert.equal(result.items[0].entity, '头疼');
    assert.equal(result.items[0].context, '她今晚说偏头疼');
    assert.equal(result.items[0].reason, '想确认休息后有没有缓解');
    assert.equal(new Date(result.items[0].due_at).getUTCHours(), 12);
});
test('due care items only fire during daytime and before two attempts', () => {
    const item = makeAnticipation({ content: '问问小猫', entity: '小猫', due_at: '2026-08-10T10:00:00+08:00' }, new Date('2026-08-09T10:00:00+08:00'));
    assert.equal(isDue(item, new Date('2026-08-11T10:00:00+08:00')), true);
    assert.equal(isDue(item, new Date('2026-08-11T03:00:00+08:00')), false);
    item.attempts = 2; assert.equal(isDue(item, new Date('2026-08-11T10:00:00+08:00')), false);
});

test('anticipation preserves the reason and source context needed for a later question', () => {
    const item = makeAnticipation({
        content: '问问小猫后来有没有排便', entity: '小猫',
        context: '我记着她说小猫已经两天没拉屎了。',
        source_quote: '小猫已经两天没拉屎了',
        reason: '她当时有点担心，想确认后来是否恢复',
        due_at: '2026-08-10T10:00:00+08:00'
    }, new Date('2026-08-09T10:00:00+08:00'));
    assert.equal(item.context, '我记着她说小猫已经两天没拉屎了。');
    assert.equal(item.source_quote, '小猫已经两天没拉屎了');
    assert.equal(item.reason, '她当时有点担心，想确认后来是否恢复');
});
