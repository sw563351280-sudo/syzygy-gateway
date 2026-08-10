'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCrumbs } = require('../crumb-curator');

test('crumb curator only keeps facts grounded in the user quote', () => {
    const source = '小猫已经两天没拉屎了，我有点担心。';
    const crumbs = normalizeCrumbs({ crumbs: [
        { fact: '小猫两天没排便', source_quote: '小猫已经两天没拉屎了', entities: ['小猫'], follow_up: { content: '问问小猫后来有没有拉', follow_up_after_hours: 36 } },
        { fact: '猜测', source_quote: '不存在', entities: ['小猫'] }
    ] }, source);
    assert.equal(crumbs.length, 1); assert.equal(crumbs[0].follow_up.follow_up_after_hours, 36);
});
