'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWebConfigStore } = require('../web-config-store');

function fixture(t, initial = { _version: 0, chatSessions: [] }) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'syzygy-web-config-'));
    const filename = path.join(directory, 'web_config.json');
    fs.writeFileSync(filename, JSON.stringify(initial));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    return { directory, filename, store: createWebConfigStore(filename) };
}

test('unchanged config is parsed once and external replacements invalidate the cache', async t => {
    const { filename, store } = fixture(t, { _version: 3, value: 'first' });
    assert.equal((await store.read()).value, 'first');
    assert.equal((await store.read()).value, 'first');
    assert.deepEqual(store.diagnostics(), {
        diskReads: 1, cacheHits: 1, writes: 0, cached: true, signature: store.diagnostics().signature
    });
    const replacement = filename + '.external';
    fs.writeFileSync(replacement, JSON.stringify({ _version: 4, value: 'changed-size' }));
    fs.renameSync(replacement, filename);
    assert.equal((await store.read()).value, 'changed-size');
    assert.equal(store.diagnostics().diskReads, 2);
});

test('transactions serialize concurrent versions and replace the file atomically', async t => {
    const { directory, filename, store } = fixture(t);
    const versions = await Promise.all(Array.from({ length: 20 }, (_, index) => store.transaction(async current => {
        await new Promise(resolve => setTimeout(resolve, index % 3));
        const next = { ...current, _version: (current?._version || 0) + 1 };
        return { data: next, value: next._version };
    })));
    assert.deepEqual(versions.map(result => result.value), Array.from({ length: 20 }, (_, index) => index + 1));
    assert.equal(JSON.parse(fs.readFileSync(filename, 'utf8'))._version, 20);
    assert.equal(fs.readdirSync(directory).filter(name => name.endsWith('.tmp')).length, 0);
    assert.equal(store.diagnostics().writes, 20);
});

test('rejected transactions do not touch the file', async t => {
    const { filename, store } = fixture(t, { _version: 8, marker: 'keep' });
    const before = fs.readFileSync(filename, 'utf8');
    const shared = await store.readShared();
    const result = await store.transaction(current => { current.marker = 'changed'; return { commit: false, value: current._version }; });
    assert.deepEqual(result, { committed: false, value: 8 });
    assert.equal(fs.readFileSync(filename, 'utf8'), before);
    assert.equal(shared.marker, 'keep');
    assert.equal((await store.readShared()).marker, 'keep');
    assert.equal(store.diagnostics().writes, 0);
});
