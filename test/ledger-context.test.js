'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { hasLedgerContextIntent, renderLedgerRealtimeContext } = require('../ledger-context');

test('detects direct and natural ledger contexts', () => {
    for (const text of ['查一下小金库', '这个月支出多少', '昨天点了外卖', 'call check_ledger']) {
        assert.equal(hasLedgerContextIntent(text), true, text);
    }
    assert.equal(hasLedgerContextIntent('抱抱我'), false);
});

test('renders a complete server-side ledger snapshot', () => {
    const text = renderLedgerRealtimeContext({
        month: '2026-09',
        income_cents: 200000,
        expense_cents: 74200,
        balance_cents: 125800,
        savings_rate: 63,
        count: 1,
        category_breakdown: [{ name: '餐饮', amount_cents: 74200 }],
        recent: [{ date: '2026-09-01', kind: 'expense', category: '餐饮', name: '晚餐', amount_cents: 74200 }],
    });
    assert.match(text, /共同账本实时数据/);
    assert.match(text, /收入：¥2,000\.00/);
    assert.match(text, /支出：¥742\.00/);
    assert.match(text, /晚餐/);
});
