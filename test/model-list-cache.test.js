'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createModelListCache, fetchModelList } = require('../model-list-cache');

test('model list cache reuses a fresh successful result', async () => {
    let loads = 0;
    const cache = createModelListCache({ freshMs: 1000 });
    const loader = async () => ({ data: [{ id: 'model-a' }], load: ++loads });
    assert.equal((await cache.get('supplier', loader)).cache, 'miss');
    const second = await cache.get('supplier', loader);
    assert.equal(second.cache, 'fresh');
    assert.equal(second.data.load, 1);
    assert.equal(loads, 1);
});

test('stale model list returns immediately and refreshes once in background', async () => {
    let clock = 0;
    let loads = 0;
    let release;
    const cache = createModelListCache({ freshMs: 10, maxAgeMs: 1000, now: () => clock });
    await cache.get('supplier', async () => ({ data: [{ id: 'old' }], load: ++loads }));
    clock = 20;
    const loader = () => new Promise(resolve => { loads++; release = resolve; });
    const [first, second] = await Promise.all([cache.get('supplier', loader), cache.get('supplier', loader)]);
    assert.equal(first.cache, 'stale');
    assert.equal(second.cache, 'stale');
    assert.equal(first.data.load, 1);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(loads, 2, 'concurrent stale reads share one refresh');
    release({ data: [{ id: 'new' }], load: 2 });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal((await cache.get('supplier', loader)).data.load, 2);
});

test('failed background refresh keeps the last successful list', async () => {
    let clock = 0;
    const errors = [];
    const cache = createModelListCache({ freshMs: 10, maxAgeMs: 1000, now: () => clock, onRefreshError: error => errors.push(error.message) });
    await cache.get('supplier', async () => ({ data: [{ id: 'kept' }] }));
    clock = 20;
    const stale = await cache.get('supplier', async () => { throw new Error('offline'); });
    assert.equal(stale.data.data[0].id, 'kept');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(errors, ['offline']);
    assert.equal((await cache.get('supplier', async () => ({ data: [] }))).data.data[0].id, 'kept');
});

test('expired entries wait for a new successful result', async () => {
    let clock = 0;
    const cache = createModelListCache({ freshMs: 10, maxAgeMs: 20, now: () => clock });
    await cache.get('supplier', async () => ({ data: [{ id: 'old' }] }));
    clock = 30;
    await assert.rejects(cache.get('supplier', async () => { throw new Error('timeout'); }), /timeout/);
    assert.deepEqual(cache.diagnostics(), { entries: 0, inFlight: 0 });
});

test('model supplier loading enforces its own timeout', async () => {
    const neverCompletes = (_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
    await assert.rejects(fetchModelList(neverCompletes, {
        targetUrl: 'https://supplier.invalid/v1/models',
        apiKey: 'secret',
        timeoutMs: 10,
    }), error => error.name === 'TimeoutError');
});

test('only successful non-empty model lists are cacheable results', async () => {
    const response = body => async () => ({ ok: true, status: 200, json: async () => body });
    await assert.rejects(fetchModelList(response({ data: [] }), {
        targetUrl: 'https://supplier.invalid/v1/models', apiKey: 'secret', timeoutMs: 100,
    }), /未返回模型列表/);
    const loaded = await fetchModelList(response({ data: [{ id: 'model-a' }] }), {
        targetUrl: 'https://supplier.invalid/v1/models', apiKey: 'secret', timeoutMs: 100,
    });
    assert.equal(loaded.data[0].id, 'model-a');
});
