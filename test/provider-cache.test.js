'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareCachedRequest, inspectCacheRequest, cacheAdapterStatus } = require('../provider-cache');
const endpoint = 'https://aihubmix.com/v1/chat/completions';
const fixture = () => ({ model: 'claude-opus-4-6-think', stream: true, max_tokens: 4096,
    thinking: { type: 'enabled', budget_tokens: 2048 }, stream_options: { other: true },
    messages: [ { role: 'system', content: 'rules', cache_control: { type: 'ephemeral' } },
        { role: 'user', content: 'past question' }, { role: 'assistant', content: 'past answer' },
        { role: 'user', content: 'changing runtime and question', cache_control: { type: 'ephemeral' } } ],
    tools: [{ type: 'function', function: { name: 'read', parameters: { type: 'object' } } }] });

test('TreeGPT Opus 5.5 caches stable system and history with explicit one-hour TTL', () => {
    const body = { ...fixture(), model: 'claude-opus-5-5' };
    const wire = prepareCachedRequest('https://api.treegpt.cc/v1/chat/completions', body, { historyEnd: 2 });
    assert.notEqual(wire, body);
    assert.deepEqual(inspectCacheRequest(wire), { breakpoints: [
        { message: 0, block: 0, role: 'system', placement: 'content', ttl: '1h' },
        { message: 2, block: 0, role: 'assistant', placement: 'content', ttl: '1h' }
    ], includeUsage: true });
    assert.equal(wire.messages[3].cache_control, undefined);
    assert.equal(cacheAdapterStatus().treeLocalCheckPassed, true);
    for (const endpoint of ['http://api.treegpt.cc/v1', 'https://api.treegpt.cc.other.test/v1']) {
        assert.equal(prepareCachedRequest(endpoint, body), body);
    }
});

test('wire payload uses two content breakpoints, preserves settings and never changes conversation', () => {
    const body = fixture(), original = JSON.stringify(body);
    const wire = prepareCachedRequest(endpoint, body, { historyEnd: 2 });
    assert.equal(JSON.stringify(body), original);
    assert.deepEqual(inspectCacheRequest(wire), { breakpoints: [
        { message: 0, block: 0, role: 'system', placement: 'content', ttl: '1h' },
        { message: 2, block: 0, role: 'assistant', placement: 'content', ttl: '1h' }
    ], includeUsage: true });
    assert.equal(wire.messages.some(m => m.cache_control), false);
    assert.deepEqual(wire.thinking, body.thinking);
    assert.equal(wire.max_tokens, body.max_tokens);
    assert.deepEqual(wire.tools, body.tools);
    assert.equal(wire.stream_options.other, true);
});

test('changing runtime and appended tool rounds leave cached prefix identical', () => {
    const first = prepareCachedRequest(endpoint, fixture(), { historyEnd: 2 });
    const next = fixture();
    next.messages[3].content = 'different time, RAG and user question';
    next.messages.push({ role: 'assistant', content: null, tool_calls: [{ id: 'a' }] },
        { role: 'tool', tool_call_id: 'a', content: 'new result' });
    const second = prepareCachedRequest(endpoint, next, { historyEnd: 2 });
    assert.equal(JSON.stringify(first.messages.slice(0, 3)), JSON.stringify(second.messages.slice(0, 3)));
    assert.deepEqual(inspectCacheRequest(second), inspectCacheRequest(first));
    assert.deepEqual(second.messages.slice(4), next.messages.slice(4));
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
