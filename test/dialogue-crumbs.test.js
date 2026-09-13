'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractDialogueCrumbTags } = require('../dialogue-crumbs');

test('dialogue crumb is hidden and only stored when grounded in this user turn', () => {
    const input = '那只小猫今天终于肯吃饭了。<CRUMB>{"fact":"我记着她说小猫今天终于肯吃饭了。","source_quote":"小猫今天终于肯吃饭了","entities":["小猫"],"tags":["进展"]}</CRUMB>';
    const result = extractDialogueCrumbTags(input, '那只小猫今天终于肯吃饭了。');
    assert.equal(result.cleanContent, '那只小猫今天终于肯吃饭了。');
    assert.equal(result.crumbs.length, 1);
    assert.equal(result.crumbs[0].entities[0], '小猫');
});

test('ungrounded or repeated dialogue crumb tags never create more than one crumb', () => {
    const result = extractDialogueCrumbTags(
        '好。<CRUMB>{"fact":"我记着她买了草莓。","source_quote":"不存在","entities":["草莓"]}</CRUMB><CRUMB>{"fact":"我记着她吃饭了。","source_quote":"吃饭了","entities":["晚饭"]}</CRUMB>',
        '她说今天好累。'
    );
    assert.equal(result.cleanContent, '好。');
    assert.equal(result.tagCount, 2);
    assert.deepEqual(result.crumbs, []);
});
