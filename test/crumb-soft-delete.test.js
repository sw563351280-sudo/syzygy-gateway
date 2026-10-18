'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { softDeleteCrumb, undoCrumbDelete } = require('../crumb-soft-delete');
const { searchCrumbs } = require('../crumb-recall');

test('crumb deletion is soft, hidden from recall by default and undo restores the previous state', () => {
    const now = new Date('2026-10-18T12:00:00Z');
    const items = [{ id: 'dust', fact: '买了草莓', source_quote: '买草莓了', entities: ['草莓'], tags: [], status: 'quiet', created_at: now.toISOString() }];
    const result = softDeleteCrumb(items, 'dust', now);
    assert.equal(result.item.status, 'deleted');
    assert.equal(result.item.deleted_from_status, 'quiet');
    assert.equal(searchCrumbs(items, { keyword: '草莓', now }).returned, 0);
    const restored = undoCrumbDelete(items, 'dust', new Date(now.getTime() + 29999));
    assert.equal(restored.status, 'quiet');
    assert.equal(searchCrumbs(items, { keyword: '草莓', now }).returned, 1);
});

test('undo expires after thirty seconds without hard-deleting the stored row', () => {
    const now = new Date('2026-10-18T12:00:00Z');
    const items = [{ id: 'dust', fact: '一粒星尘', status: 'active' }];
    softDeleteCrumb(items, 'dust', now);
    assert.throws(() => undoCrumbDelete(items, 'dust', new Date(now.getTime() + 30001)), error => error.status === 410);
    assert.equal(items[0].status, 'deleted');
});
