'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { prepareCachedRequest, inspectCacheRequest, cacheAdapterStatus } = require('../provider-cache');
const { mergeUsage, readConfig, normalizeUsage } = require('../context-budget');
const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('real main projection sends only original history to summarizer and strips private metadata', async () => {
    const begin = source.indexOf('let projectedHistory =');
    const end = source.indexOf('body.messages = bodyMessages;', begin) + 'body.messages = bodyMessages;'.length;
    const messages = [{ _contextId: 'a', role: 'user', content: 'old' }, { _contextId: 'b', role: 'assistant', content: 'reply' }];
    let observed;
    const body = { model: 'claude-opus-4-6' };
    await vm.runInNewContext(`(async () => { ${source.slice(begin, end)} })()`, {
        newMessages: messages, contextProtocol: { version: 1, sessionId: 'session' }, isOpenClawRequest: false,
        supportsBlockCache: () => true, resolveApiUrl: () => 'https://aihubmix.com/v1', req: { path: '/' },
        rollingContext: { async project(scope, history) { observed = { scope, history }; return history.map(({ role, content }) => ({ role, content })); } },
        body, contextBudget: {}, systemMsg: { role: 'system', content: 'rules' }, finalUserContent: 'dynamic and latest',
        composeContext: require('../context-budget').composeContext,
    });
    assert.equal(observed.history.length, 2);
    assert.equal(observed.history.some(m => m.content.includes('dynamic')), false);
    assert.equal(JSON.stringify(body).includes('_contextId'), false);
    assert.equal(body.messages.at(-1).content, 'dynamic and latest');
});

test('saving frontend state cannot invoke legacy paid summary generation', () => {
    const start = source.indexOf("app.post('/api/sync-config'");
    const end = source.indexOf("app.get('/api/user-state'", start);
    assert.doesNotMatch(source.slice(start, end), /updateRollingSummaries\s*\(/);
    assert.match(source, /delete body\.contextProtocol/);
});

test('fixed output rules move intact into cached system only for AIHubMix', () => {
    const start = source.indexOf('const moodSnapshotInst =', source.indexOf('const isClaudeModel ='));
    const end = source.indexOf("if (dynamicBlocks.endsWith", start);
    assert.ok(start >= 0 && end > start);
    function run(enabled) {
        const state = { systemMsg: { content: 'system' }, dynamicBlocks: '',
            liveCtx: 'LIVE', memCtx: 'MEMORY', txCtx: 'TRANSCRIPT', wakeDecisionsCtx: 'WAKE',
            supportsBlockCache: () => enabled, resolveApiUrl: () => '', req: { path: '/' }, body: { model: 'test' },
            cutAtSentence: (s, n) => s.slice(0, n) };
        vm.runInNewContext(source.slice(start, end), state);
        return state;
    }
    const old = run(false), updated = run(true);
    const fixed = updated.systemMsg.content.slice('system\n\n'.length);
    assert.equal(fixed + '\n\n' + updated.dynamicBlocks, old.dynamicBlocks);
    assert.equal(updated.dynamicBlocks, 'LIVE\n\nMEMORY\n\nTRANSCRIPT\n\nWAKE');
    assert.equal(old.systemMsg.content, 'system');
});

// Run the actual integration fragments without starting server background jobs.
for (const [start, end] of [
    ['const toolWireBody =', 'if (!toolResponse.ok)'],
    ['const finalWireBody =', 'if (!response.ok)'],
    ['const webToolWireBody =', 'if (!toolRes.ok)'],
    ['const webFinalWireBody =', 'if (!aiRes.ok)'],
]) test(`real server serializes prepared cache payload: ${start}`, async () => {
    const messages = [{ role: 'system', content: 'rules' }, { role: 'assistant', content: 'history' }, { role: 'user', content: 'runtime' }];
    const body = { model: 'claude-opus-4-6-think', stream: true, messages };
    const parts = { currentMessage: messages[2] };
    const observed = [], sent = [];
    const observer = { request(value) { observed.push(JSON.stringify(value)); return 1; } };
    const context = { prepareCachedRequest, body, toolBody: body, toolFetchBody: body, fetchBody: body,
        bodyMessages: messages, apiMessages: messages, contextParts: parts, webContextParts: parts,
        contextBudget: observer, webContextBudget: observer, apiUrl: 'https://aihubmix.com/v1/chat/completions',
        baseUrl: 'https://aihubmix.com/v1', apiHeaders: {}, apiKey: 'test',
        fetch: async (_url, options) => { sent.push(options.body); return {}; } };
    const offset = source.indexOf(start);
    assert.ok(offset >= 0);
    await vm.runInNewContext(`(async () => { ${source.slice(offset, source.indexOf(end, offset))} })()`, context);
    assert.deepEqual(sent, observed);
    assert.equal(sent.length, 1);
    assert.equal(inspectCacheRequest(JSON.parse(sent[0])).breakpoints.length, 2);
    assert.equal(typeof messages[0].content, 'string');
});

test('main forwarding stream records final usage without trailing newline', async () => {
    const events = [
        { choices: [{ delta: { content: '你好' } }], usage: { prompt_tokens: 9000, prompt_tokens_details: { cached_tokens: 8000, cache_creation_tokens: 500 } } },
        { choices: [], usage: { completion_tokens: 100, prompt_tokens_details: { cached_tokens: 8000 } } },
    ];
    const bytes = new TextEncoder().encode(events.map(e => 'data:' + JSON.stringify(e)).join('\r\n\r\n'));
    const stream = new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 2) c.enqueue(bytes.slice(i, i + 2)); c.close(); } });
    const usages = [], output = [];
    const offset = source.indexOf('const reader = response.body.getReader();');
    const end = source.indexOf('let streamFinalized = false;', offset);
    assert.ok(offset >= 0 && end > offset);
    await vm.runInNewContext(`(async () => { ${source.slice(offset, end)} })()`, {
        response: { body: stream }, TextDecoder, mergeUsage, body: { model: 'claude-opus-4-6-think' },
        contextBudget: { response(_id, usage) { usages.push(usage); } }, finalBudgetCall: 1,
        res: { write(text) { output.push(text); }, end() {} },
        buildSSEChunk: text => text, console,
    });
    assert.equal(output.join('').includes('你好'), true);
    assert.deepEqual(normalizeUsage(usages.at(-1)), { total: 9000, uncached: 500, read: 8000, write: 500, output: 100 });
});

test('status endpoint is authenticated and performs no upstream request', () => {
    let handler;
    const offset = source.indexOf("app.get('/api/context-budget/status'");
    const end = source.indexOf("app.get('/api/traces'", offset);
    vm.runInNewContext(source.slice(offset, end), {
        app: { get(_url, fn) { handler = fn; } }, process: { env: { MEMORY_PASSWORD: 'test' } },
        readContextBudgetConfig: () => readConfig({}), cacheAdapterStatus, rollingContextCapabilities: () => ({ version: 1, rollingSummary: true }), costLedger: { snapshot: () => ({}) },
        _budgetConsoleRing: [{ t: 'now', m: '[ContextBudget] ' + JSON.stringify({ event: 'usage', host: 'aihubmix.com',
            model: 'claude-opus-4-6-think', cacheState: 'written', usage: { read: 0, write: 8000 } }) }],
        fetch() { assert.fail('no upstream access'); },
    });
    let code = 200, result;
    const res = { status(n) { code = n; return this; }, json(value) { result = value; }, set() {} };
    handler({ query: {} }, res);
    assert.equal(code, 401);
    handler({ query: { pwd: 'test' } }, res);
    assert.equal(result.cacheAdapter.localCheckPassed, true);
    assert.equal(result.latestCache.state, 'written');
    assert.equal(JSON.stringify(result).includes('MEMORY_PASSWORD'), false);
});
