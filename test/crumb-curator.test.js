'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCrumbMessages, normalizeCrumbs, shouldConsiderCrumbs, extractCrumbs } = require('../crumb-curator');

test('crumb prompt writes as Shen in first person while preserving the source quote', () => {
    const prompt = buildCrumbMessages('小猫已经两天没拉屎了。')[0].content;
    assert.match(prompt, /沈望第一人称/);
    assert.match(prompt, /source_quote.*逐字/);
});

test('crumb curator only keeps facts grounded in the user quote', () => {
    const source = '小猫已经两天没拉屎了，我有点担心。';
    const crumbs = normalizeCrumbs({ crumbs: [
        { fact: '小猫两天没排便', source_quote: '小猫已经两天没拉屎了', entities: ['小猫'], follow_up: { content: '问问小猫后来有没有拉', follow_up_after_hours: 36 } },
        { fact: '猜测', source_quote: '不存在', entities: ['小猫'] }
    ] }, source);
    assert.equal(crumbs.length, 1); assert.equal(crumbs[0].follow_up.follow_up_after_hours, 36);
});

test('crumb curator keeps one detail per message and skips product chatter before calling Flash', async () => {
    const source = '妈妈说明天要带小猫去复诊，我有点担心。';
    const crumbs = normalizeCrumbs({ crumbs: [
        { fact: '妈妈明天带小猫复诊', source_quote: '妈妈说明天要带小猫去复诊', entities: ['妈妈', '小猫'], tags: ['复诊'] },
        { fact: '我有点担心', source_quote: '我有点担心', entities: ['江鱼'], tags: ['情绪'] }
    ] }, source);
    assert.equal(crumbs.length, 1);
    assert.equal(shouldConsiderCrumbs('我在改 Codex 的前端界面'), false);
    assert.equal(shouldConsiderCrumbs('嗯嗯'), false);

    let called = false;
    const result = await extractCrumbs({
        fetchImpl: async () => { called = true; throw new Error('should not call'); },
        apiKey: 'secret',
        userText: '我在改 Codex 的前端界面'
    });
    assert.deepEqual(result, []);
    assert.equal(called, false);
});
