'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRollingContext, fileStore, createSummarizer } = require('../rolling-context');
const raw = (n = 8) => Array.from({ length: n }, (_, i) => ({ _contextId: 'id-' + i,
    role: i % 2 ? 'assistant' : 'user', content: `${i}:` + '资料原文。'.repeat(20) }));
const plain = messages => messages.map(({ role, content }) => ({ role, content }));
function fixture(options = {}) {
    let state;
    const batches = [], events = [];
    const store = { read() { return state ? structuredClone(state) : null; }, write(_k, v) { state = structuredClone(v); } };
    const context = createRollingContext({ store, threshold: 400, tailTokens: 100, summaryTokens: 100,
        log: e => events.push(e), summarize: async b => { batches.push(b); return { content: '累计摘要', finishReason: 'stop' }; }, ...options });
    return { context, store, batches, events, state: () => state };
}

test('compact commits exact coverage and keeps all raw revisions; append reuses summary', async () => {
    const f = fixture();
    const result = await f.context.project('a', raw());
    assert.equal(f.state().covered.length, 6);
    assert.equal(Object.keys(f.state().revisions).length, 8);
    assert.equal(result.length, 4);
    assert.deepEqual(result.slice(2), plain(raw().slice(6)));
    assert.deepEqual(f.batches[0].messages, plain(raw().slice(0, 6)));
    assert.equal(f.batches[0].previousSummary, '');
    const next = await f.context.project('a', raw(9));
    assert.equal(f.batches.length, 1);
    assert.deepEqual(next.slice(0, 4), result);
    assert.equal(JSON.stringify(result).includes('_contextId'), false);
});

test('next compact combines old summary and ONLY uncovered batch', async () => {
    const f = fixture();
    await f.context.project('a', raw());
    await f.context.project('a', raw(12));
    assert.equal(f.batches[1].previousSummary, '累计摘要');
    assert.deepEqual(f.batches[1].messages, plain(raw(12).slice(6, 10)));
    assert.equal(f.state().covered.length, 10);
});

for (const finishReason of ['length', 'MAX_TOKENS', 'incomplete', undefined]) {
    test(`incomplete ${finishReason} cannot hide raw or advance coverage; retry cools down`, async () => {
        let calls = 0;
        const f = fixture({ summarize: async () => { calls++; return { content: '残缺摘要', finishReason }; } });
        const input = raw();
        assert.deepEqual(await f.context.project('a', input), plain(input));
        assert.deepEqual(f.state().covered, []);
        await f.context.project('a', raw(10));
        assert.equal(calls, 1);
    });
}

test('request failures and invalid IDs never discard context', async () => {
    const f = fixture({ summarize: async () => { throw Error('network'); } });
    assert.deepEqual(await f.context.project('a', raw()), plain(raw()));
    const duplicate = raw(); duplicate[1]._contextId = duplicate[0]._contextId;
    assert.deepEqual(await f.context.project('a', duplicate), plain(duplicate));
});

test('corrupt coverage without usable summary fails open without calling a model', async () => {
    const f = fixture({ store: { read: () => ({ version: 1, revisions: {}, covered: ['bad'], summary: '' }) },
        summarize: () => assert.fail('must not spend with invalid state') });
    assert.deepEqual(await f.context.project('a', raw()), plain(raw()));
});

test('editing/deleting covered messages invalidates summary, preserves old revisions and does not resurrect deleted text', async () => {
    const f = fixture();
    await f.context.project('a', raw());
    const edit = raw(); edit[0].content = '已纠正';
    await f.context.project('a', edit);
    assert.equal(f.batches[1].previousSummary, '');
    assert.equal(f.batches[1].messages[0].content, '已纠正');
    assert.equal(Object.keys(f.state().revisions).length, 9);
    const subset = edit.slice(4);
    const result = await f.context.project('a', subset);
    assert.equal(result.some(m => m.content === '已纠正'), false);
    assert.equal(f.events.some(e => e.state === 'invalidated'), true);
    await f.context.project('a', []);
    assert.equal(f.state().summary, '');
    assert.equal(Object.keys(f.state().revisions).length, 9);
});

test('failed replacement summary retains old summary and ALL uncovered raw', async () => {
    let calls = 0;
    const f = fixture({ summarize: async () => ({ content: ++calls === 1 ? '前情' : '坏', finishReason: calls === 1 ? 'stop' : 'length' }) });
    await f.context.project('a', raw());
    const result = await f.context.project('a', raw(12));
    assert.equal(f.state().summary, '前情');
    assert.equal(f.state().covered.length, 6);
    assert.deepEqual(result.slice(2), plain(raw(12).slice(6)));
});

test('failed commit returns full raw; storage failure prevents model call', async () => {
    let writes = 0, calls = 0;
    const f = fixture({ store: { read: () => null, write() { if (++writes === 3) throw Error('disk full'); } },
        summarize: async () => { calls++; return { content: '摘要', finishReason: 'stop' }; } });
    assert.deepEqual(await f.context.project('a', raw()), plain(raw()));
    assert.equal(calls, 1);
    const blocked = fixture({ store: { read() { throw Error('corrupt'); } }, summarize() { assert.fail('must archive before spending'); } });
    assert.deepEqual(await blocked.context.project('a', raw()), plain(raw()));
});

test('concurrent same-session requests serialize and do not double summarize append', async () => {
    let release;
    const gate = new Promise(r => { release = r; });
    let calls = 0;
    const f = fixture({ summarize: async () => { calls++; await gate; return { content: '摘要', finishReason: 'stop' }; } });
    const first = f.context.project('a', raw());
    const second = f.context.project('a', raw(9));
    release();
    const [a, b] = await Promise.all([first, second]);
    assert.equal(calls, 1);
    assert.deepEqual(b.slice(0, a.length), a);
});

test('file store survives restart with raw and coverage together', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'syzygy-context-test-'));
    try {
        const store = fileStore(directory);
        await fixture({ store }).context.project(['session', 'model'], raw());
        const restarted = fixture({ store });
        const result = await restarted.context.project(['session', 'model'], raw(9));
        assert.equal(restarted.batches.length, 0);
        assert.equal(result.length, 5);
        const files = fs.readdirSync(directory);
        assert.equal(files.length, 1);
        assert.equal(Object.keys(JSON.parse(fs.readFileSync(path.join(directory, files[0]))).revisions).length, 9);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('summary request is hidden, bounded, tool-free and preserves finish reason', async () => {
    let request;
    const summarizer = createSummarizer({ endpoint: 'https://example.test', model: 'test', apiKey: 'test',
        fetchImpl: async (_url, init) => { request = JSON.parse(init.body); return { ok: true,
            json: async () => ({ choices: [{ finish_reason: 'length', message: { content: 'partial' } }] }) }; } });
    const result = await summarizer({ previousSummary: 'old', messages: plain(raw(2)) });
    assert.equal(request.tools, undefined);
    assert.equal(request.max_tokens, 1400);
    assert.equal(result.finishReason, 'length');
    assert.equal(JSON.parse(request.messages[1].content).previousSummary, 'old');
});

test('timeout aborts single request with no automatic retries', async () => {
    let calls = 0;
    const summarize = createSummarizer({ endpoint: 'https://example.test', model: 'test', apiKey: 'test', timeoutMs: 5,
        fetchImpl: async (_url, { signal }) => { calls++; return new Promise((_r, reject) => signal.addEventListener('abort', () => reject(Error('abort')))); } });
    await assert.rejects(summarize({ previousSummary: '', messages: [] }));
    assert.equal(calls, 1);
});
