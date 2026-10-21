'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runCrumbEmbeddingBackfill } = require('../crumb-embedding-backfill');

test('crumb embedding backfill batches only missing rows and atomically preserves the existing cache', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crumb-vectors-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const crumbsFile = path.join(dir, 'crumbs.json'); const cacheFile = path.join(dir, 'crumb-cache.json');
    const seedCacheFile = path.join(dir, 'shared-cache.json');
    fs.writeFileSync(crumbsFile, JSON.stringify([
        { id: 'old', fact: '已有向量' }, { id: 'new-a', fact: '买了草莓', entities: ['草莓'] }, { id: 'new-b', fact: '看了一场电影', tags: ['电影'] }
    ]));
    fs.writeFileSync(cacheFile, JSON.stringify({}));
    fs.writeFileSync(seedCacheFile, JSON.stringify({ old: [1, 0], unrelated: [0.2, 0.8] }));
    const calls = [];
    const fetchImpl = async (_url, options) => {
        const request = JSON.parse(options.body); calls.push(request.input);
        return { ok: true, json: async () => ({ data: request.input.map((_, index) => ({ index, embedding: index ? [0, 1] : [0.6, 0.8] })) }) };
    };
    const result = await runCrumbEmbeddingBackfill({ crumbsFile, cacheFile, seedCacheFile, apiKey: 'test', fetchImpl, batchSize: 8, logger: { log() {}, warn() {} } });
    const saved = JSON.parse(fs.readFileSync(cacheFile));
    assert.equal(result.status, 'completed');
    assert.equal(result.remaining, 0);
    assert.deepEqual(calls.map(batch => batch.length), [2]);
    assert.deepEqual(saved.old, [1, 0]);
    assert.equal(saved.unrelated, undefined);
    assert.deepEqual(saved['new-a'], [0.6, 0.8]);
    assert.deepEqual(saved['new-b'], [0, 1]);
    assert.equal(fs.existsSync(`${cacheFile}.crumb-backfill.jsonl`), false);
});
