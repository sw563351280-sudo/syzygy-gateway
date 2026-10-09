'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildNativeRequest, freezeHistory, fetchCachedProvider, convertStream } = require('../anthropic-cache');
const { prepareProviderRequest, inspectCacheRequest, inspectWireRequest, cacheAdapterStatus } = require('../provider-cache');
const { consumeOpenAIStream } = require('../streaming-chat');
const { normalizeUsage } = require('../context-budget');
const endpoint = 'https://api.treegpt.cc/v1/chat/completions';
test('Opus 5.5 native generation settings remove incompatible legacy sampling and manual thinking', () => {
    const original = { model: 'claude-opus-5-5', temperature: 0.9, top_p: 0.8, top_k: 10, thinking: { type: 'enabled', budget_tokens: 1024 }, max_tokens: 4096,
        messages: [{ role: 'user', content: 'hello' }] };
    const body = buildNativeRequest(original);
    assert.deepEqual(body.thinking, { type: 'adaptive' });
    assert.equal(body.temperature, undefined); assert.equal(body.top_p, undefined); assert.equal(body.top_k, undefined);
    assert.equal(body.max_tokens, 4096); assert.equal(original.temperature, 0.9);
});
test('Opus 5.5 forced tool intent becomes an uncached instruction with supported auto selection', () => {
    const body = buildNativeRequest({ model: 'claude-opus-5-5', tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } }],
        tool_choice: { type: 'function', function: { name: 'lookup' } }, messages: [{ role: 'user', content: 'find' }] });
    assert.deepEqual(body.tool_choice, { type: 'auto' });
    assert.match(body.messages.at(-1).content.at(-1).text, /lookup/);
    assert.equal(body.messages.at(-1).content.at(-1).cache_control, undefined);
});
test('raw freezing archive resumes a verified browser trim beyond 200 messages without paid summaries', async () => {
    const { createRollingContext } = require('../rolling-context');
    const { seed, nextDigest } = require('../public/context-continuity');
    const saved = new Map();
    const archive = () => createRollingContext({ rawOnly: true, threshold: 1,
        store: { read: key => saved.get(key), write: (key, value) => saved.set(key, structuredClone(value)) },
        summarize: () => assert.fail('no paid summary') });
    const all = Array.from({ length: 206 }, (_, i) => ({ _contextId: 'id' + i, _contextRevision: 'a'.repeat(64), role: i % 2 ? 'assistant' : 'user', content: 'line ' + i }));
    await archive().project('scope', all.slice(0, 200));
    let hash = seed;
    for (let i = 0; i < 6; i++) hash = nextDigest(hash, all[i]._contextId, all[i]._contextRevision);
    const proof = { version: 1, count: 6, hash, firstId: 'id6' };
    const resumed = await archive().project('scope', all.slice(6), null, proof);
    assert.equal(resumed.length, 206); assert.equal(resumed[0].content, 'line 0');
    assert.equal((await archive().project('scope', all.slice(6))).length, 200, 'no proof means do not restore deleted messages');
});
const history = turns => Array.from({ length: turns * 2 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `original ${i}\nUnicode 原文 </frozen_context>` }));
function request(turns, dynamic = 'time A') {
    const past = history(turns);
    return prepareProviderRequest(endpoint, { model: 'claude-opus-5-5', stream: true, tools: [
        { type: 'function', function: { name: 'read', description: 'read only', parameters: { type: 'object', properties: {} } } },
    ], messages: [{ role: 'system', content: 'persona' }, ...past, { role: 'user', content: dynamic }] }, { historyEnd: past.length, scope: 'chat' });
}
test('reference layout uses native system/frozen/history breakpoints and no dynamic cache marker', () => {
    const first = request(8), next = request(9, 'time B');
    assert.equal(first.system.length, 2);
    assert.deepEqual(first.system, next.system);
    assert.deepEqual(first.tools, next.tools);
    assert.deepEqual(first.metadata, next.metadata);
    assert.equal(first.messages.length, 5);
    assert.equal(next.messages.length, 7);
    assert.equal(first.messages[2].content[0].cache_control.ttl, '1h');
    assert.equal(first.messages.at(-1).content[0].cache_control, undefined);
    assert.equal(first.tools[0].cache_control, undefined);
    assert.equal(first.stream_options, undefined);
    assert.equal(inspectCacheRequest(first, endpoint).breakpoints.length, 3);
    assert.equal(inspectCacheRequest(first, endpoint).strategy, 'anthropic-frozen-v1');
    assert.ok(cacheAdapterStatus().treeNativeCheckPassed);
    assert.doesNotMatch(JSON.stringify(inspectWireRequest(endpoint, first)), /persona|original|time A|read only/);
});
test('frozen source is lossless, stable for eight turns and invalidates on edit/delete without a stale copy', () => {
    const first = freezeHistory(history(8));
    assert.deepEqual(JSON.parse(first.frozen.split('<frozen_context>\n')[1].split('\n</frozen_context>')[0]), history(8).slice(0, 12));
    for (let turns = 9; turns < 16; turns++) assert.equal(freezeHistory(history(turns)).frozen, first.frozen);
    assert.notEqual(freezeHistory(history(16)).frozen, first.frozen);
    const edited = history(9); edited[0].content = 'edited';
    assert.notEqual(freezeHistory(edited).frozen, first.frozen);
    assert.ok(!freezeHistory(edited.slice(2)).frozen.includes('edited'));
    assert.deepEqual(freezeHistory(history(9)), freezeHistory(history(9)), 'refresh/restart deterministic');
});
test('images and tool chains stay in messages rather than being flattened into frozen text', () => {
    const past = history(9); past[2].content = [{ type: 'image_url', image_url: { url: 'data:image/png;base64,YQ==' } }];
    const body = buildNativeRequest({ model: 'claude-opus-5-5', messages: [{ role: 'system', content: 'rules' }, ...past, { role: 'user', content: 'now' }] }, { historyEnd: past.length });
    assert.ok(body.messages.some(m => m.content.some(b => b.type === 'image' && b.source.data === 'YQ==')));
    const pair = [{ role: 'assistant', content: null, tool_calls: [{ id: 't', function: { name: 'lookup', arguments: '{"q":"test"}' } }] }, { role: 'tool', tool_call_id: 't', content: 'result' }];
    const converted = buildNativeRequest({ model: 'claude-opus-5-5', messages: pair });
    assert.deepEqual(converted.messages[0].content[0], { type: 'tool_use', id: 't', name: 'lookup', input: { q: 'test' } });
    assert.equal(converted.messages[1].content[0].tool_use_id, 't');
});
test('transport calls only native endpoint once, preserves cancellation and does not retry errors', async () => {
    const body = request(8); body.stream = false;
    const signal = new AbortController().signal;
    let calls = 0;
    const response = await fetchCachedProvider(endpoint, body, { headers: { Authorization: 'Bearer fake', 'Content-Type': 'application/json' }, signal,
        fetchImpl: async (url, options) => {
            calls++; assert.equal(url, 'https://api.treegpt.cc/v1/messages');
            assert.equal(options.signal, signal); assert.equal(options.redirect, 'error');
            assert.equal(options.headers.get('anthropic-version'), '2023-06-01');
            assert.equal(options.headers.get('anthropic-beta'), 'extended-cache-ttl-2025-04-11');
            assert.equal(options.headers.get('authorization'), 'Bearer fake');
            assert.deepEqual(JSON.parse(options.body), body);
            return new Response('provider error', { status: 400 });
        } });
    assert.equal(response.status, 400); assert.equal(calls, 1);
});
function nativeStream(events, fragment = 7) {
    const bytes = new TextEncoder().encode(events.map(e => 'event: ' + e.type + '\r\ndata: ' + JSON.stringify(e) + '\r\n\r\n').join(''));
    let pos = 0;
    return new ReadableStream({ pull(c) { if (pos >= bytes.length) return c.close(); c.enqueue(bytes.slice(pos, pos += fragment)); } });
}
test('native fragmented SSE retains signed thinking, parallel tools and 1h usage through next tool round', async () => {
    const events = [
        { type: 'message_start', message: { id: 'm', model: 'claude-opus-5-5', usage: { input_tokens: 12, output_tokens: 0, cache_read_input_tokens: 2000, cache_creation_input_tokens: 100, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 100 } } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '思考' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'signed' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'a', name: 'lookup', input: {} } },
        { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"q":' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"你"}' } },
        { type: 'content_block_stop', index: 1 },
        { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'b', name: 'second', input: {} } },
        { type: 'content_block_stop', index: 2 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 30 } },
        { type: 'message_stop' },
    ];
    const parsed = await consumeOpenAIStream(convertStream(nativeStream(events)));
    assert.equal(parsed.reasoning, '思考'); assert.equal(parsed.finishReason, 'tool_calls');
    assert.deepEqual(parsed.toolCalls.map(t => [t.id, t.function.arguments]), [['a', '{"q":"你"}'], ['b', '{}']]);
    assert.deepEqual(normalizeUsage(parsed.usage), { total: 2112, uncached: 12, read: 2000, write: 100, output: 30 });
    const followup = buildNativeRequest({ model: 'claude-opus-5-5', messages: [
        { role: 'assistant', _anthropic_content: parsed.anthropicContent },
        { role: 'tool', tool_call_id: 'a', content: 'one' }, { role: 'tool', tool_call_id: 'b', content: 'two' },
    ] });
    assert.equal(followup.messages[0].content[0].signature, 'signed');
    assert.equal(followup.messages[1].content.length, 2);
    assert.equal(followup.messages[0].content.filter(b => b.type === 'tool_use').length, 2);
});
test('native text streams and non-stream replies expose content and cache counters; truncated streams fail', async () => {
    const events = [{ type: 'message_start', message: { id: 'm', model: 'claude-opus-5-5', usage: { input_tokens: 1 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello你好' } },
        { type: 'content_block_stop', index: 0 }, { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } }, { type: 'message_stop' }];
    assert.equal((await consumeOpenAIStream(convertStream(nativeStream(events)))).content, 'hello你好');
    await assert.rejects(consumeOpenAIStream(convertStream(nativeStream(events.slice(0, -1)))), /Truncated/);
    await assert.rejects(consumeOpenAIStream(convertStream(nativeStream([{ type: 'error' }]))), /stream error/);
    const reply = await fetchCachedProvider(endpoint, { ...request(1), stream: false }, { fetchImpl: async () => Response.json({
        id: 'm', model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'answer' }],
        usage: { input_tokens: 10, output_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 100 },
    }) });
    const json = await reply.json(); assert.equal(json.choices[0].message.content, 'answer');
    assert.equal(normalizeUsage(json.usage).read, 100);
});
