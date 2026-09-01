'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { keepRequestedReadTools } = require('../tool-policy');

function tool(name) {
    return { type: 'function', function: { name } };
}

test('ledger tools are retained for ledger and expense contexts', () => {
    const available = [tool('check_ledger'), tool('query_ledger'), tool('exec')];
    for (const phrase of ['小金库我能看吗', '昨天点的外卖花了多少', '这个月底结余怎么样', '最近是不是乱花钱了']) {
        assert.deepEqual(
            keepRequestedReadTools(available, phrase).map(item => item.function.name),
            ['check_ledger', 'query_ledger'],
            phrase,
        );
    }
});
