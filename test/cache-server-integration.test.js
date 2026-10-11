'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { prepareCachedRequest, inspectCacheRequest, cacheAdapterStatus } = require('../provider-cache');
const { mergeUsage, readConfig, normalizeUsage } = require('../context-budget');
const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

for (const mode of [undefined, 'summary-v1', 'frozen-v1']) test(`native history retains original messages without paid summaries with browser mode ${mode}`, async () => {
    const begin = source.indexOf('let projectedHistory =');
    const end = source.indexOf('body.messages = bodyMessages;', begin) + 'body.messages = bodyMessages;'.length;
    let previousSystem;
    for (const length of [86, 88]) {
    const messages = Array.from({ length }, (_, i) => ({ _contextId: 'id' + i, _contextRevision: 'revision', role: i % 2 ? 'assistant' : 'user', content: 'text ' + i }));
    const body = { model: 'claude-opus-5-5' };
    await vm.runInNewContext(`(async () => { ${source.slice(begin, end)} })()`, {
        newMessages: messages, incomingMessages: messages, contextProtocol: { version: 1, mode, sessionId: 'same' }, isOpenClawRequest: false,
        usesNativeCache: require('../anthropic-cache').usesNativeCache,
        cacheScope: 'same', lifecycle: { signal: new AbortController().signal },
        frozenContextArchive: require('../rolling-context').createRollingContext({ rawOnly: true, store: { read() { return null; }, write() {} } }),
        resolveApiUrl: () => 'https://api.treegpt.cc/v1/chat/completions', req: { path: '/' }, body,
        systemMsg: { role: 'system', content: 'persona' }, finalUserContent: 'current dynamics', composeContext: require('../context-budget').composeContext,
        rollingContext: { project() { assert.fail('freezing must not summarize'); } },
    });
    assert.equal(body.messages.length, length + 2);
    assert.ok(body.messages.every(m => !('_contextId' in m) && !('_contextRevision' in m)));
    assert.equal(body.messages.at(-1).content, 'current dynamics');
    const wire = require('../provider-cache').prepareProviderRequest('https://api.treegpt.cc/v1/chat/completions', body, { historyEnd: length });
    assert.equal(wire.system.length, 2);
    if (previousSystem) assert.deepEqual(wire.system, previousSystem, 'new turns must not shift frozen original history');
    previousSystem = wire.system;
    }
});

test('actual gateway stabilizes legacy browser history only with authenticated saved-session proof', async () => {
    const begin = source.indexOf('let projectedHistory =');
    const end = source.indexOf('body.messages = bodyMessages;', begin) + 'body.messages = bodyMessages;'.length;
    const saved = Array.from({ length: 60 }, (_, i) => ({ _id: 'id' + i, role: i % 2 ? 'assistant' : 'user', content: 'message ' + i }));
    const cacheHistoryWindow = require('../cache-history-window').createCacheHistoryWindow();
    async function run(stop, authenticated = true) {
        const body = { model: 'claude-opus-5-5', activeChatId: 'same' };
        const messages = saved.slice(stop - 30, stop).map(({ role, content }) => ({ role, content }));
        await vm.runInNewContext(`(async () => { ${source.slice(begin, end)} })()`, {
            newMessages: messages, incomingMessages: messages, contextProtocol: null, isOpenClawRequest: false,
            supportsBlockCache: () => true, resolveApiUrl: () => 'https://api.treegpt.cc/v1/chat/completions',
            req: { path: '/', headers: { authorization: 'test-key' } }, isAuthenticated: () => authenticated,
            webConfigStore: { readShared: async () => { assert.ok(authenticated); return { chatSessions: [{ id: 'same', messages: saved }] }; } },
            cacheHistoryWindow, body, systemMsg: { role: 'system', content: 'rules' }, finalUserContent: 'current dynamic ' + stop,
            composeContext: require('../context-budget').composeContext, console: { log() {} },
        });
        return body.messages;
    }
    const first = await run(40), second = await run(42);
    assert.equal(first.length, 32);
    assert.equal(second.length, 34);
    assert.equal(JSON.stringify(first.slice(0, -1)), JSON.stringify(second.slice(0, 31)));
    assert.equal((await run(44, false)).length, 32);
    assert.equal(second.at(-1).content, 'current dynamic 42');
});

test('real main projection sends only original history to summarizer and strips private metadata', async () => {
    const begin = source.indexOf('let projectedHistory =');
    const end = source.indexOf('body.messages = bodyMessages;', begin) + 'body.messages = bodyMessages;'.length;
    const messages = [{ _contextId: 'a', _contextRevision: 'private', role: 'user', content: 'old' }, { _contextId: 'b', role: 'assistant', content: 'reply' }];
    const prefix = { version: 1, count: 2, hash: 'test', firstId: 'a' };
    let observed;
    const body = { model: 'claude-opus-4-6' };
    await vm.runInNewContext(`(async () => { ${source.slice(begin, end)} })()`, {
        newMessages: messages, incomingMessages: messages, contextProtocol: { version: 1, sessionId: 'session', prefix }, isOpenClawRequest: false,
        supportsBlockCache: () => true, resolveApiUrl: () => 'https://aihubmix.com/v1', req: { path: '/' },
        usesNativeCache: require('../anthropic-cache').usesNativeCache,
        rollingContext: { async project(scope, history, observer, proof) { observed = { scope, history, proof }; return history.map(({ role, content }) => ({ role, content })); } },
        body, lifecycle: { signal: new AbortController().signal }, contextBudget: {}, systemMsg: { role: 'system', content: 'rules' }, finalUserContent: 'dynamic and latest',
        composeContext: require('../context-budget').composeContext,
    });
    assert.equal(observed.history.length, 2);
    assert.equal(observed.history.some(m => m.content.includes('dynamic')), false);
    assert.equal(JSON.stringify(body).includes('_contextId'), false);
    assert.equal(JSON.stringify(body).includes('_contextRevision'), false);
    assert.equal(observed.proof, prefix);
    assert.equal(body.messages.at(-1).content, 'dynamic and latest');
});

test('non-AIHubMix final history caps merged history and preserves current question', async () => {
    const begin = source.indexOf('let projectedHistory =');
    const end = source.indexOf('body.messages = bodyMessages;', begin) + 'body.messages = bodyMessages;'.length;
    const all = Array.from({ length: 50 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'message ' + i }));
    for (const n of [0, 12, 30, 50]) {
        const messages = all.slice(0, n), body = { model: '[反重力] claude-opus-4-6-thinking' };
        const systemMsg = { role: 'system', content: 'rules' };
        await vm.runInNewContext(`(async () => { ${source.slice(begin, end)} })()`, {
            newMessages: messages, incomingMessages: all.slice(0, 31), contextProtocol: undefined, isOpenClawRequest: false,
            supportsBlockCache: () => false, resolveApiUrl: () => 'https://other.test/v1', req: { path: '/' }, body, systemMsg, finalUserContent: 'current question',
            composeContext: require('../context-budget').composeContext,
            rollingContext: { project() { assert.fail('other providers must not summarize'); } },
        });
        // Under the original 30-message limit the payload is byte-for-byte the
        // pre-cache assembly: system + history + current user, without a summary.
        assert.equal(JSON.stringify(body.messages), JSON.stringify([systemMsg, ...messages.slice(-30), { role: 'user', content: 'current question' }]));
        assert.equal(body.messages.length, Math.min(n, 30) + 2);
    }
});

test('saving frontend state cannot invoke legacy paid summary generation', () => {
    const start = source.indexOf("app.post('/api/sync-config'");
    const end = source.indexOf("app.get('/api/user-state'", start);
    assert.doesNotMatch(source.slice(start, end), /updateRollingSummaries\s*\(/);
    assert.match(source, /delete body\.contextProtocol/);
});

test('TreeGPT browser history survives server projection across turns without a paid summary', async () => {
    const { cachedChatHistory } = require('../public/cache-history');
    const { supportsBlockCache } = require('../provider-cache');
    const { composeContext } = require('../context-budget');
    const begin = source.indexOf('let projectedHistory =');
    const end = source.indexOf('body.messages = bodyMessages;', begin) + 'body.messages = bodyMessages;'.length;
    const all = Array.from({ length: 112 }, (_, i) => ({ _id: String(i), role: i % 2 ? 'assistant' : 'user', content: 'message ' + i }));
    const map = new Map(), storage = { getItem: k => map.get(k), setItem: (k, v) => map.set(k, v) };
    const endpoint = 'https://api.treegpt.cc/v1/chat/completions';
    let previous;
    for (const count of [100, 102, 104, 106, 108, 110]) {
        const selected = cachedChatHistory(all.slice(0, count), 'session', '/via/tree/v1/chat/completions', 'claude-opus-5-5', storage);
        const body = { model: 'claude-opus-5-5' };
        await vm.runInNewContext(`(async () => { ${source.slice(begin, end)} })()`, {
            newMessages: selected.map(({ role, content }) => ({ role, content })), incomingMessages: selected,
            contextProtocol: undefined, isOpenClawRequest: false, supportsBlockCache,
            resolveApiUrl: () => endpoint, req: { path: '/via/tree/v1/chat/completions' },
            body, systemMsg: { role: 'system', content: 'fixed rules' }, finalUserContent: 'dynamic ' + count,
            composeContext, rollingContext: { project() { assert.fail('fallback must not summarize'); } },
        });
        assert.equal(body.messages[1].content, 'message ' + (count < 110 ? 70 : 80));
        assert.ok(body.messages.length <= 40);
        const wire = prepareCachedRequest(endpoint, body, { historyEnd: body.messages.length - 2 });
        const clean = list => JSON.stringify(list.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : m.content.map(b => b.text).join('') })));
        if (previous && count < 110) assert.equal(clean(wire.messages.slice(0, previous.length)), clean(previous));
        previous = wire.messages.slice(0, -1);
    }
});

test('fixed output rules keep their original placement even if dynamic reads fail', async () => {
    const start = source.indexOf("let dynamicBlocks = ''", source.indexOf('const isClaudeModel ='));
    const end = source.indexOf('// 构建 volatile context', start);
    assert.ok(start >= 0 && end > start);
    async function run(enabled, failAt = null) {
        const state = { systemMsg: { content: 'system' },
            buildLiveStatePrompt: async () => { if (failAt === 'live') throw new Error('unavailable'); return 'LIVE'; },
            scanMemoryRadar: async () => { if (failAt === 'memory') throw new Error('unavailable'); return 'MEMORY'; },
            shouldScanTranscript: () => true,
            scanTranscriptRadar: async () => { if (failAt === 'transcript') throw new Error('unavailable'); return 'TRANSCRIPT'; },
            loadRecentWakeDecisions: () => [], formatWakeDecisionsForContext: () => 'WAKE',
            _ctxDiag: {}, currentUserMsgText: 'question', console: { log() {} },
            supportsBlockCache: () => enabled, resolveApiUrl: () => '', req: { path: '/' }, body: { model: 'test' },
            cutAtSentence: (s, n) => s.slice(0, n) };
        return vm.runInNewContext(`(async () => { ${source.slice(start, end)} return { system: systemMsg.content, dynamicBlocks }; })()`, state);
    }
    const old = await run(false), updated = await run(true);
    const fixed = updated.system.slice('system\n\n'.length);
    assert.equal(fixed + '\n\n' + updated.dynamicBlocks, old.dynamicBlocks);
    assert.equal(updated.dynamicBlocks, 'LIVE\n\nMEMORY\n\nTRANSCRIPT\n\nWAKE');
    assert.equal(old.system, 'system');
    for (const failAt of ['live', 'memory', 'transcript']) {
        assert.equal((await run(true, failAt)).system, updated.system);
        assert.equal((await run(false, failAt)).dynamicBlocks, fixed);
    }
});

test('realtime ledger injection preserves cached tool definitions on both chat paths', () => {
    const { supportsBlockCache } = require('../provider-cache');
    const { keepRequestedReadTools } = require('../tool-policy');
    const tools = ['check_phone', 'check_ledger', 'query_ledger', 'music_current_session'].map(name => ({ type: 'function', function: { name } }));
    for (const web of [false, true]) {
        const begin = source.indexOf(web
            ? 'if (ledgerRealtimeContext && !supportsBlockCache(baseUrl, webModelName))'
            : 'if (ledgerRealtimeContext && !supportsBlockCache(apiUrl, body.model))');
        const end = source.indexOf(web ? 'if (webXhsShareUrl)' : 'const cacheToolPolicy', begin);
        assert.ok(begin >= 0 && end > begin);
        const select = (endpoint, ledger, available = tools) => {
            const state = { filteredTools: available, ledgerRealtimeContext: ledger, apiUrl: endpoint, baseUrl: endpoint,
                body: { model: 'claude-opus-5-5' }, webModelName: 'claude-opus-5-5', supportsBlockCache,
                keepRequestedReadTools, text: '这次花了好多钱', console: { log() {} } };
            vm.runInNewContext(source.slice(begin, end), state);
            return state.filteredTools;
        };
        const endpoint = 'https://api.treegpt.cc/v1/chat/completions';
        assert.deepEqual(select(endpoint, 'live ledger'), select(endpoint, ''));
        assert.equal(select('https://other.test/v1', 'live ledger').some(t => /ledger/.test(t.function.name)), false);
        const disabled = tools.filter(t => t.function.name !== 'query_ledger');
        assert.deepEqual(select(endpoint, 'live ledger', disabled), disabled, 'disabled tools are never restored');
    }
});

// Run the actual integration fragments without starting server background jobs.
for (const [start, end] of [
    ['const toolWireBody =', 'if (!toolResponse.ok)'],
    ['const finalWireBody =', 'if (!response.ok)'],
    ['const webToolWireBody =', 'if (!toolRes.ok)'],
    ['const webFinalWireBody =', 'if (!aiRes.ok)'],
]) for (const [endpoint, model] of [
    ['https://aihubmix.com/v1/chat/completions', 'claude-opus-4-6-think'],
    ['https://api.treegpt.cc/v1/chat/completions', 'claude-opus-5-5'],
]) test(`real server serializes prepared cache payload: ${start} ${endpoint}`, async () => {
    const messages = [{ role: 'system', content: 'rules' }, { role: 'assistant', content: 'history' }, { role: 'user', content: 'runtime' }];
    const body = { model, stream: true, messages };
    const parts = { currentMessage: messages[2] };
    const observed = [], sent = [];
    const observer = { request(value) { observed.push(JSON.stringify(value)); return 1; } };
    const fakeFetch = async (_url, options) => { sent.push(options.body); return { ok: false }; };
    const context = { prepareCachedRequest: require('../provider-cache').prepareProviderRequest, body, toolBody: body, toolFetchBody: body, fetchBody: body,
        cacheScope: 'test', fetchCachedProvider: (url, request, options) => require('../provider-transport').fetchCachedProvider(url, request, { ...options, fetchImpl: fakeFetch }),
        lifecycle: { signal: new AbortController().signal },
        bodyMessages: messages, apiMessages: messages, contextParts: parts, webContextParts: parts,
        contextBudget: observer, webContextBudget: observer, apiUrl: endpoint,
        baseUrl: endpoint, apiHeaders: {}, apiKey: 'test',
        fetch: fakeFetch };
    const offset = source.indexOf(start);
    assert.ok(offset >= 0);
    await vm.runInNewContext(`(async () => { ${source.slice(offset, source.indexOf(end, offset))} })()`, context);
    assert.deepEqual(sent, observed);
    assert.equal(sent.length, 1);
    const cacheInspection = inspectCacheRequest(JSON.parse(sent[0]), endpoint);
    const expectedBreakpoints = endpoint.includes('api.treegpt.cc') ? 1 : 2;
    assert.equal(cacheInspection.breakpoints.length, expectedBreakpoints);
    assert.ok(cacheInspection.breakpoints.every(b => b.ttl === '1h'));
    if (expectedBreakpoints === 1) {
        assert.equal(cacheInspection.strategy, 'anthropic-frozen-v1');
        assert.equal(cacheInspection.breakpoints[0].placement, 'system');
    }
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
        _budgetConsoleRing: [{ t: 'request', m: '[ContextBudget] ' + JSON.stringify({ event: 'request', kind: 'chat', host: 'api.treegpt.cc',
            model: 'claude-opus-5-5', cacheRequest: { breakpoints: [{ placement: 'content', role: 'system', ttl: '1h' }] } }) },
            { t: 'now', m: '[ContextBudget] ' + JSON.stringify({ event: 'usage', host: 'aihubmix.com',
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
    assert.equal(result.latestCacheRequest.host, 'api.treegpt.cc');
    assert.equal(result.latestCacheRequest.breakpoints[0].ttl, '1h');
    assert.equal(JSON.stringify(result).includes('MEMORY_PASSWORD'), false);
});
