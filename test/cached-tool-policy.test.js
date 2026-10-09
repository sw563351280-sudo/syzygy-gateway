'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const { createCachedToolPolicy, appendToolHint, executeAllowedTool } = require('../cached-tool-policy');
const { buildNativeRequest } = require('../anthropic-cache');
const { inspectWireRequest } = require('../provider-cache');
const endpoint = 'https://api.treegpt.cc/v1/chat/completions';
const tools = ['check_ledger', 'edit_file', 'fetch_txt'].map(name => ({ type: 'function', function: { name, description: name, parameters: { type: 'object', properties: {} } } }));
test('topic changes alter only the uncached allowed-tool hint, not any cache prefix', () => {
    const make = selected => {
        const policy = createCachedToolPolicy(tools, selected);
        const current = { role: 'user', content: 'latest question' };
        appendToolHint(current, policy);
        return buildNativeRequest({ model: 'claude-opus-5-5', tools: policy.tools, messages: [
            { role: 'system', content: 'persona' },
            ...Array.from({ length: 80 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'original ' + i })), current,
        ] }, { historyEnd: 80 });
    };
    const ordinary = make([tools[0]]), code = make([tools[0], tools[1]]), xhs = make([tools[0]]);
    assert.deepEqual(ordinary.tools, code.tools);
    assert.deepEqual(inspectWireRequest(endpoint, ordinary).breakpointFingerprints, inspectWireRequest(endpoint, code).breakpointFingerprints);
    assert.deepEqual(inspectWireRequest(endpoint, ordinary).breakpointFingerprints, inspectWireRequest(endpoint, xhs).breakpointFingerprints);
    assert.notEqual(inspectWireRequest(endpoint, ordinary).suffix.fingerprint, inspectWireRequest(endpoint, code).suffix.fingerprint);
});
test('visible catalogue does not grant execution rights and cannot restore disabled tools', async () => {
    const policy = createCachedToolPolicy([tools[0], tools[1]], [tools[0], tools[2]]);
    let executed = 0;
    assert.match(await executeAllowedTool(policy, 'edit_file', () => { executed++; }), /未执行/);
    assert.match(await executeAllowedTool(policy, 'fetch_txt', () => { executed++; }), /未执行/);
    assert.equal(executed, 0);
    assert.equal(await executeAllowedTool(policy, 'check_ledger', () => { executed++; return 'ok'; }), 'ok');
    assert.equal(executed, 1);
    assert.equal(policy.allows('unknown'), false);
    assert.deepEqual(policy.tools.map(t => t.function.name), ['check_ledger', 'edit_file']);
});
test('both real server tool request paths serialize the stable catalogue', () => {
    const source = fs.readFileSync('server.js', 'utf8');
    const policy = createCachedToolPolicy(tools, [tools[0]]);
    for (const web of [false, true]) {
        const start = source.indexOf(web ? 'const toolFetchBody = { ...fetchBody' : 'const toolBody = JSON.parse(JSON.stringify(body))');
        const end = source.indexOf('const isGeminiModel', start);
        const context = { body: { messages: [] }, fetchBody: { messages: [] }, isStreamMode: true,
            cacheToolPolicy: policy, webCacheToolPolicy: policy, filteredTools: [tools[0]] };
        const observed = vm.runInNewContext(`${source.slice(start, end)}; ${web ? 'toolFetchBody' : 'toolBody'}.tools`, context);
        assert.deepEqual(JSON.parse(JSON.stringify(observed)), policy.tools);
    }
});
