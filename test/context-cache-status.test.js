'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { formatCacheStatus } = require('../public/context-cache-status');
test('readiness cannot be mistaken for a paid provider cache hit', () => {
    assert.match(formatCacheStatus({ enabled: true, cacheAdapter: { localCheckPassed: true } }), /不代表实际命中/);
    assert.match(formatCacheStatus({}), /尚未确认/);
    const base = { enabled: true, cacheAdapter: { localCheckPassed: true } };
    assert.match(formatCacheStatus({ ...base, latestCache: { state: 'unknown', usage: { read: null, write: null } } }), /读取 未知 \/ 写入 未知/);
    assert.match(formatCacheStatus({ ...base, latestCache: { state: 'no_cache', usage: { read: 0, write: 0 } } }), /本次未读写缓存/);
    assert.match(formatCacheStatus({ ...base, latestCache: { state: 'hit', usage: { read: 8000, write: 0 } } }), /已命中/);
});
