'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareCachedRequest, inspectCacheRequest, inspectWireRequest, cacheStrategy, cacheAdapterStatus } = require('../provider-cache');
const endpoint = 'https://aihubmix.com/v1/chat/completions';
const treeEndpoint = 'https://api.treegpt.cc/v1/chat/completions';
const cacheFree = value => JSON.parse(JSON.stringify(value, (key, item) => key === 'cache_control' ? undefined : item));
const cacheFreeContent = value => typeof value?.content === 'string' ? value.content : value?.content?.map(block => block.text || '').join('');
const fixture = () => ({ model: 'claude-opus-4-6-think', stream: true, max_tokens: 4096,
    thinking: { type: 'enabled', budget_tokens: 2048 }, stream_options: { other: true },
    messages: [ { role: 'system', content: 'rules', cache_control: { type: 'ephemeral' } },
        { role: 'user', content: 'past question' }, { role: 'assistant', content: 'past answer' },
        { role: 'user', content: 'changing runtime and question', cache_control: { type: 'ephemeral' } } ],
    tools: [{ type: 'function', function: { name: 'read', parameters: { type: 'object' } } }] });

test('TreeGPT Opus 5.5 defaults to one stable history-prefix breakpoint', () => {
    const body = { ...fixture(), model: 'claude-opus-5-5' };
    const wire = prepareCachedRequest(treeEndpoint, body, { historyEnd: 2 });
    assert.notEqual(wire, body);
    assert.deepEqual(inspectCacheRequest(wire, treeEndpoint), { strategy: 'tree-history-prefix-v2', breakpoints: [
        { message: 2, block: 0, role: 'assistant', placement: 'content', ttl: '1h' }
    ], includeUsage: true });
    assert.equal(wire.messages[0].cache_control, undefined);
    assert.equal(wire.messages[3].cache_control, undefined);
    assert.equal(cacheAdapterStatus().treeLocalCheckPassed, true);
    for (const badEndpoint of ['http://api.treegpt.cc/v1', 'https://api.treegpt.cc.other.test/v1']) {
        assert.equal(prepareCachedRequest(badEndpoint, body), body);
    }
});

test('TreeGPT can explicitly roll back to one system/tools breakpoint while AIHubMix retains two', () => {
    const tree = prepareCachedRequest(treeEndpoint, { ...fixture(), model: 'claude-opus-5-5' }, { historyEnd: 2, treeSystemOnly: true });
    assert.equal(cacheStrategy(treeEndpoint, 'claude-opus-5-5', { treeSystemOnly: true }), 'tree-system-tools-v1');
    assert.deepEqual(inspectCacheRequest(tree, treeEndpoint, { treeSystemOnly: true }).breakpoints, [
        { message: 0, block: 0, role: 'system', placement: 'content', ttl: '1h' }
    ]);
    const wire = prepareCachedRequest(endpoint, fixture(), { historyEnd: 2 });
    assert.deepEqual(inspectCacheRequest(wire), { breakpoints: [
        { message: 0, block: 0, role: 'system', placement: 'content', ttl: '1h' },
        { message: 2, block: 0, role: 'assistant', placement: 'content', ttl: '1h' }
    ], includeUsage: true });
});

test('wire payload canonicalizes tools, preserves settings and never changes conversation', () => {
    const body = fixture(), original = JSON.stringify(body);
    const wire = prepareCachedRequest(endpoint, body, { historyEnd: 2 });
    assert.equal(JSON.stringify(body), original);
    assert.equal(wire.messages.some(m => m.cache_control), false);
    assert.deepEqual(wire.thinking, body.thinking);
    assert.equal(wire.max_tokens, body.max_tokens);
    assert.deepEqual(wire.tools, body.tools);
    assert.equal(wire.stream_options.other, true);
});

test('TreeGPT cached prefix grows only with append-only history and excludes dynamic suffix', () => {
    const body = { ...fixture(), model: 'claude-opus-5-5' };
    const first = prepareCachedRequest(treeEndpoint, body, { historyEnd: 2 });
    const next = { ...fixture(), model: 'claude-opus-5-5' };
    next.messages[3].content = 'different time, RAG and user question';
    next.messages.splice(3, 0, { role: 'assistant', content: 'new reply' }, { role: 'user', content: 'next historical turn' });
    const second = prepareCachedRequest(treeEndpoint, next, { historyEnd: 4 });
    const firstWire = inspectWireRequest(treeEndpoint, first);
    const secondWire = inspectWireRequest(treeEndpoint, second);
    assert.deepEqual(first.messages.slice(0, 3).map(cacheFreeContent), second.messages.slice(0, 3).map(cacheFreeContent));
    assert.equal(inspectCacheRequest(second, treeEndpoint).breakpoints[0].message, 4);
    assert.equal(firstWire.stablePrefix.messages, 3);
    assert.equal(secondWire.stablePrefix.messages, 5);
    assert.notEqual(firstWire.stablePrefix.fingerprint, secondWire.stablePrefix.fingerprint);
    assert.equal(inspectCacheRequest(second, treeEndpoint).breakpoints.length, 1);
});

test('redacted wire diagnostics fingerprint the final payload without prompt or schema text', () => {
    const body = prepareCachedRequest(treeEndpoint, { ...fixture(), model: 'claude-opus-5-5' }, { historyEnd: 2 });
    const diagnostic = inspectWireRequest(treeEndpoint, body);
    assert.equal(diagnostic.host, 'api.treegpt.cc');
    assert.equal(diagnostic.strategy, 'tree-history-prefix-v2');
    assert.equal(diagnostic.toolCount, 1);
    assert.deepEqual(diagnostic.roles, ['system', 'user', 'assistant', 'user']);
    assert.equal(diagnostic.stablePrefix.messages, 3);
    assert.ok(/^[a-f0-9]{16}$/.test(diagnostic.stablePrefix.fingerprint));
    assert.ok(/^[a-f0-9]{16}$/.test(diagnostic.toolSchemaFingerprint));
    assert.doesNotMatch(JSON.stringify(diagnostic), /rules|past question|changing runtime|parameters|read/);
});

test('native diagnostic hashes stop at each content block instead of including merged dynamic text', () => {
    const body = { model: 'claude-opus-5-5', system: [
        { type: 'text', text: 'persona', cache_control: { type: 'ephemeral', ttl: '1h' } },
        { type: 'text', text: 'frozen', cache_control: { type: 'ephemeral', ttl: '1h' } },
    ], messages: [{ role: 'user', content: [
        { type: 'text', text: 'past', cache_control: { type: 'ephemeral', ttl: '1h' } },
        { type: 'text', text: 'dynamic A' },
    ] }] };
    const first = inspectWireRequest(treeEndpoint, body);
    body.messages[0].content[1].text = 'dynamic B';
    const second = inspectWireRequest(treeEndpoint, body);
    assert.equal(first.stablePrefix.fingerprint, second.stablePrefix.fingerprint);
    assert.deepEqual(first.breakpointFingerprints, second.breakpointFingerprints);
    assert.notEqual(first.suffix.fingerprint, second.suffix.fingerprint);
    body.system[1].text = 'updated frozen';
    const third = inspectWireRequest(treeEndpoint, body);
    assert.equal(first.breakpointFingerprints[0].fingerprint, third.breakpointFingerprints[0].fingerprint);
    assert.notEqual(first.breakpointFingerprints[1].fingerprint, third.breakpointFingerprints[1].fingerprint);
});

test('multimodal blocks and tool pairs are preserved; empty history is skipped', () => {
    const body = fixture();
    body.messages[2].content = [{ type: 'text', text: 'answer' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } }];
    const wire = prepareCachedRequest(endpoint, body, { historyEnd: 2 });
    assert.deepEqual(wire.messages[2].content[1], body.messages[2].content[1]);
    body.messages = [body.messages[0], body.messages[3]];
    assert.equal(inspectCacheRequest(prepareCachedRequest(endpoint, body, { historyEnd: 0 })).breakpoints.length, 1);
    body.messages.splice(1, 0, { role: 'assistant', content: null, tool_calls: [{ id: 'a' }] },
        { role: 'tool', tool_call_id: 'a', content: 'result' });
    assert.equal(inspectCacheRequest(prepareCachedRequest(endpoint, body, { historyEnd: 2 })).breakpoints.length, 1);
});

test('other relays and non-Claude payloads are unchanged; self-check never calls network', () => {
    const body = fixture();
    assert.equal(prepareCachedRequest('https://other.test/v1', body), body);
    assert.equal(prepareCachedRequest(endpoint, body, { enabled: false }), body);
    const other = { ...body, model: 'deepseek-chat' };
    assert.equal(prepareCachedRequest(endpoint, other), other);
    const originalFetch = global.fetch;
    global.fetch = () => { assert.fail('self-check must be free'); };
    try { assert.equal(cacheAdapterStatus().localCheckPassed, true); } finally { global.fetch = originalFetch; }
    assert.equal(cacheAdapterStatus().upstreamVerified, false);
    assert.equal(cacheAdapterStatus().ttl, '1h');
});
