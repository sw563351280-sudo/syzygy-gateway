'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareCachedRequest, inspectCacheRequest, inspectWireRequest, cacheStrategy, cacheAdapterStatus } = require('../provider-cache');
const endpoint = 'https://aihubmix.com/v1/chat/completions';
const treeEndpoint = 'https://api.treegpt.cc/v1/chat/completions';
const fixture = () => ({ model: 'claude-opus-4-6-think', stream: true, max_tokens: 4096,
    thinking: { type: 'enabled', budget_tokens: 2048 }, stream_options: { other: true },
    messages: [ { role: 'system', content: 'rules', cache_control: { type: 'ephemeral' } },
        { role: 'user', content: 'past question' }, { role: 'assistant', content: 'past answer' },
        { role: 'user', content: 'changing runtime and question', cache_control: { type: 'ephemeral' } } ],
    tools: [{ type: 'function', function: { name: 'read', parameters: { type: 'object' } } }] });

test('TreeGPT Opus 5.5 defaults to one stable system/tools breakpoint', () => {
    const body = { ...fixture(), model: 'claude-opus-5-5' };
    const wire = prepareCachedRequest(treeEndpoint, body, { historyEnd: 2 });
    assert.notEqual(wire, body);
    assert.deepEqual(inspectCacheRequest(wire, treeEndpoint), { strategy: 'tree-system-tools-v1', breakpoints: [
        { message: 0, block: 0, role: 'system', placement: 'content', ttl: '1h' }
    ], includeUsage: true });
    assert.equal(wire.messages[3].cache_control, undefined);
    assert.equal(cacheAdapterStatus().treeLocalCheckPassed, true);
    for (const badEndpoint of ['http://api.treegpt.cc/v1', 'https://api.treegpt.cc.other.test/v1']) {
        assert.equal(prepareCachedRequest(badEndpoint, body), body);
    }
});

test('TreeGPT history breakpoint is opt-in experimental while AIHubMix retains two breakpoints', () => {
    const tree = prepareCachedRequest(treeEndpoint, { ...fixture(), model: 'claude-opus-5-5' }, { historyEnd: 2, historyBreakpoint: true });
    assert.equal(cacheStrategy(treeEndpoint, 'claude-opus-5-5', { historyBreakpoint: true }), 'tree-history-experiment-v1');
    assert.equal(inspectCacheRequest(tree, treeEndpoint, { historyBreakpoint: true }).strategy, 'tree-history-experiment-v1');
    assert.equal(inspectCacheRequest(tree, treeEndpoint, { historyBreakpoint: true }).breakpoints.length, 2);
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

test('TreeGPT stable prefix remains identical when history or dynamic suffix changes', () => {
    const body = { ...fixture(), model: 'claude-opus-5-5' };
    const first = prepareCachedRequest(treeEndpoint, body, { historyEnd: 2 });
    const next = { ...fixture(), model: 'claude-opus-5-5' };
    next.messages[1].content = 'rotated historical question';
    next.messages[3].content = 'different time, RAG and user question';
    const second = prepareCachedRequest(treeEndpoint, next, { historyEnd: 2 });
    assert.deepEqual(first.messages[0], second.messages[0]);
    assert.notDeepEqual(first.messages.slice(1), second.messages.slice(1));
    assert.equal(inspectCacheRequest(second, treeEndpoint).breakpoints.length, 1);
});

test('redacted wire diagnostics fingerprint the final payload without prompt or schema text', () => {
    const body = prepareCachedRequest(treeEndpoint, { ...fixture(), model: 'claude-opus-5-5' }, { historyEnd: 2 });
    const diagnostic = inspectWireRequest(treeEndpoint, body);
    assert.equal(diagnostic.host, 'api.treegpt.cc');
    assert.equal(diagnostic.strategy, 'tree-system-tools-v1');
    assert.equal(diagnostic.toolCount, 1);
    assert.deepEqual(diagnostic.roles, ['system', 'user', 'assistant', 'user']);
    assert.equal(diagnostic.stablePrefix.messages, 1);
    assert.ok(/^[a-f0-9]{16}$/.test(diagnostic.stablePrefix.fingerprint));
    assert.ok(/^[a-f0-9]{16}$/.test(diagnostic.toolSchemaFingerprint));
    assert.doesNotMatch(JSON.stringify(diagnostic), /rules|past question|changing runtime|parameters|read/);
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
