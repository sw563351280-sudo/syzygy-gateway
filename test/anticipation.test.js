'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractAnticipationTags, isDue, makeAnticipation, attachAnticipationSource, enrichAnticipation, formatAnticipationForWake } = require('../anticipation');

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

test('manual tag retains escaped quotes, apostrophes and a complete antecedent', () => {
    const result = extractAnticipationTags(`<ANTICIPATION entity="书" due="tomorrow" context="她想找一本英文小说，不确定哪一版" reason="想知道后来选了哪一版" source_quote="我想买 &quot;Alice's Adventures&quot;">后来选了哪一版？</ANTICIPATION>`);
    assert.equal(result.items[0].source_quote, `我想买 "Alice's Adventures"`);
    const item = makeAnticipation(attachAnticipationSource(result.items[0], { userText: `我想买 "Alice's Adventures"`, sourceRef: { message_id: 'human-turn', at: '2026-10-09T02:00:00Z' } }));
    assert.equal(item.source_message_id, 'human-turn');
    assert.match(formatAnticipationForWake(item), /不确定哪一版/);
    assert.match(formatAnticipationForWake(item), /Alice's Adventures/);
});

test('one-line legacy tag carries request-local antecedents through storage and wake', () => {
    const tag = extractAnticipationTags('<ANTICIPATION entity="书" due="tomorrow">今天没去买那个东西吧</ANTICIPATION>').items[0];
    const sources = { userText: '明天再去看看。', sourceTexts: ['想买的是昨天提到的那本小说，不是笔记本。', '明天再去看看。'], sourceRef: { message_id: 'source', at: '2026-10-09T02:00:00Z' } };
    const stored = JSON.parse(JSON.stringify(makeAnticipation(attachAnticipationSource(tag, sources))));
    assert.match(stored.context, /不是笔记本/);
    assert.equal(stored.source_quote, '明天再去看看。');
    assert.match(formatAnticipationForWake(stored), /那本小说/);
    const other = attachAnticipationSource(tag, { userText: '我下午要去取快递。' });
    assert.doesNotMatch(other.context, /小说/);
});

test('fabricated source quote is replaced by actual turn evidence', () => {
    const item = attachAnticipationSource({ content: '问问书', entity: '书', source_quote: '她已经买好了' }, { userText: '我还没买，先看看。' });
    assert.equal(item.source_quote, '我还没买，先看看。');
    assert.doesNotMatch(item.context, /已经买好了/);
});

test('earlier-turn quotes are not falsely attributed to the latest message id', () => {
    const item = attachAnticipationSource({ source_quote: '我还没买那本书。' }, { userText: '今天先休息。', sourceTexts: ['我还没买那本书。', '今天先休息。'], sourceRef: { message_id: 'latest', at: '2026-10-09T02:00:00Z' } });
    assert.equal(item.source_quote, '我还没买那本书。');
    assert.equal(item.source_message_id, null);
    assert.equal(item.source_at, null);
});

test('linked old records recover their own crumb, never a nearby unrelated one', () => {
    const crumbs = [{ id: 'other', fact: '无关的旧事' }, { id: 'source', fact: '她还在找昨天说的小说。', source_quote: '还没买', follow_up: { reason: '想知道后来有没有找到' } }];
    const item = enrichAnticipation({ entity: '书', content: '后来找到了吗', source_crumb_id: 'source', reason: '存在自然的后续' }, crumbs);
    assert.equal(item.context, '她还在找昨天说的小说。');
    assert.equal(item.reason, '想知道后来有没有找到');
    assert.match(formatAnticipationForWake(item), /她当时的原话：还没买/);
    assert.equal(enrichAnticipation({ entity: '书' }, crumbs).context, '');
    assert.match(formatAnticipationForWake({ entity: '书', content: '那个东西呢' }), /不能猜/);
});

test('context and evidence beyond the old 240-character cap survive a round trip', () => {
    const context = '当时她提到了选版本的过程。'.repeat(30) + '最后决定等明天再去店里看看。';
    const stored = makeAnticipation({ entity: '书', content: '后来找到合适的版本了吗', context, source_quote: context });
    assert.equal(stored.context, context);
    assert.equal(stored.source_quote, context);
});
