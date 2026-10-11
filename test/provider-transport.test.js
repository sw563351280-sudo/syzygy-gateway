'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchCachedProvider, isProtocolRejection } = require('../provider-transport');
const { prepareProviderRequest } = require('../provider-cache');
const { consumeOpenAIStream } = require('../streaming-chat');
const endpoint = 'https://emtf.aipm9527.site/v1/chat/completions';
const request = (stream = false) => ({ model: 'claude-opus-5-5', stream, messages: [
    { role: 'system', content: [{ type: 'text', text: 'fixed', cache_control: { type: 'ephemeral' } }] },
    { role: 'user', content: 'hello' },
] });
const completion = { id: 'o', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '你好' } }], usage: { prompt_tokens: 17, completion_tokens: 2 } };
const nativeMessage = { type: 'message', id: 'n', model: 'claude-opus-5-5', content: [{ type: 'text', text: '你好' }], stop_reason: 'end_turn', usage: { input_tokens: 17, output_tokens: 2 } };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const rejection = () => json({ error: { message: 'OpenAI chat completions is not supported; use Anthropic /v1/messages' } }, 400);
function sse(events, fragment = 11) {
    const bytes = new TextEncoder().encode(events.map(event => 'data: ' + (typeof event === 'string' ? event : JSON.stringify(event)) + '\r\n\r\n').join(''));
    let offset = 0;
    return new Response(new ReadableStream({ pull(controller) {
        if (offset >= bytes.length) return controller.close();
        controller.enqueue(bytes.slice(offset, offset += fragment));
    } }), { headers: { 'content-type': 'text/event-stream' } });
}
const nativeEvents = () => [
    { type: 'ping' },
    { type: 'message_start', message: { id: 'n', model: 'claude-opus-5-5', usage: { input_tokens: 17, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '你好' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
    { type: 'message_stop' },
];

test('OpenAI remains first and a successful response is never retried', async () => {
    let calls = 0;
    const body = request();
    const response = await fetchCachedProvider(endpoint, body, { fetchImpl: async (url, options) => {
        calls++; assert.equal(url, endpoint); assert.deepEqual(JSON.parse(options.body), body); return json(completion);
    } });
    assert.deepEqual(await response.json(), completion);
    assert.deepEqual(JSON.parse(await response.text()), completion);
    assert.equal(calls, 1);
});

test('explicit incompatibility switches once on the same origin, without cache markers; tool rounds reuse the selection', async () => {
    const calls = [], state = {}, signal = new AbortController().signal;
    const headers = { authorization: 'Bearer test-only', 'content-type': 'application/json' };
    const fetchImpl = async (url, options) => {
        calls.push(url); assert.equal(options.signal, signal);
        if (url === endpoint) return rejection();
        assert.equal(url, 'https://emtf.aipm9527.site/v1/messages');
        assert.equal(options.redirect, 'error');
        assert.equal(options.headers.get('x-api-key'), 'test-only');
        assert.equal(options.headers.get('anthropic-version'), '2023-06-01');
        assert.equal(options.headers.has('anthropic-beta'), false);
        const native = JSON.parse(options.body);
        assert.equal(native.system[0].text, 'fixed');
        assert.equal(native.messages[0].content[0].text, 'hello');
        assert.doesNotMatch(options.body, /cache_control|frozen_context|stream_options/);
        return json(nativeMessage);
    };
    const response = await fetchCachedProvider(endpoint, request(), { headers, signal, protocolState: state, fetchImpl });
    assert.equal((await response.json()).choices[0].message.content, '你好');
    await fetchCachedProvider(endpoint, request(), { headers, signal, protocolState: state, fetchImpl });
    assert.deepEqual(calls, [endpoint, 'https://emtf.aipm9527.site/v1/messages', 'https://emtf.aipm9527.site/v1/messages']);
    await fetchCachedProvider(endpoint, request(), { headers, signal, protocolState: {}, fetchImpl });
    assert.equal(calls[3], endpoint, 'a new user request starts with OpenAI');
});

test('TreeGPT native cache payload and AIHubMix transport are untouched, even on protocol errors', async () => {
    for (const host of ['api.treegpt.cc', 'aihubmix.com']) {
        const url = `https://${host}/v1/chat/completions`;
        const body = prepareProviderRequest(url, request(), { historyEnd: 0 });
        let calls = 0;
        const response = await fetchCachedProvider(url, body, { fetchImpl: async (actual, options) => {
            calls++; assert.equal(actual, host.includes('tree') ? `https://${host}/v1/messages` : url);
            assert.deepEqual(JSON.parse(options.body), body); assert.match(options.body, /cache_control/);
            return rejection();
        } });
        assert.equal(response.status, 400); assert.equal(calls, 1);
    }
});

test('HTTP failures unrelated to protocol do not cause a second request', async () => {
    for (const [status, message] of [[401, 'use Anthropic'], [403, 'use Anthropic'], [429, 'use Anthropic'], [500, 'use Anthropic'], [400, 'tools not supported'], [404, 'model not found'], [422, 'context length exceeded']]) {
        let calls = 0;
        const response = await fetchCachedProvider(endpoint, request(), { fetchImpl: async () => { calls++; return json({ error: { message } }, status); } });
        assert.equal(response.status, status); assert.equal(calls, 1); assert.ok((await response.text()).includes(message));
    }
});

test('network failures, timeouts and cancellation never negotiate or retry', async () => {
    for (const error of [new TypeError('network failed'), new DOMException('timeout', 'TimeoutError'), new DOMException('aborted', 'AbortError')]) {
        let calls = 0;
        await assert.rejects(fetchCachedProvider(endpoint, request(), { fetchImpl: async () => { calls++; throw error; } }), error);
        assert.equal(calls, 1);
    }
    const controller = new AbortController(); let calls = 0;
    await assert.rejects(fetchCachedProvider(endpoint, request(), { signal: controller.signal, fetchImpl: async () => { calls++; controller.abort(); return rejection(); } }), /abort/i);
    assert.equal(calls, 1);
});

test('fallback failures stop after two attempts rather than degrading and calling again', async () => {
    let calls = 0;
    await assert.rejects(fetchCachedProvider(endpoint, request(), { fetchImpl: async () => { calls++; return calls === 1 ? rejection() : json({ error: 'bad request' }, 400); } }), /HTTP 400/);
    assert.equal(calls, 2);
});

test('native JSON returned to OpenAI is converted in place for streaming and non-streaming', async () => {
    for (const stream of [false, true]) {
        let calls = 0;
        const response = await fetchCachedProvider(endpoint, request(stream), { fetchImpl: async () => { calls++; return json(nativeMessage); } });
        if (stream) {
            const output = await consumeOpenAIStream(response.body); assert.equal(output.content, '你好'); assert.equal(output.usage.input_tokens, 17);
        } else assert.equal(JSON.parse(await response.text()).choices[0].message.content, '你好');
        assert.equal(calls, 1);
    }
});

test('fragmented native SSE on the OpenAI endpoint is read without a retry', async () => {
    let calls = 0;
    const response = await fetchCachedProvider(endpoint, request(true), { fetchImpl: async () => { calls++; return sse(nativeEvents()); } });
    const output = await consumeOpenAIStream(response.body);
    assert.equal(output.content, '你好'); assert.equal(output.usage.input_tokens, 17); assert.equal(output.usage.output_tokens, 2);
    assert.equal(calls, 1);
});

test('HTTP 200 protocol errors in JSON or initial SSE negotiate once', async () => {
    for (const streaming of [false, true]) {
        let calls = 0;
        const response = await fetchCachedProvider(endpoint, request(streaming), { fetchImpl: async () => {
            calls++;
            if (calls === 2) return streaming ? sse(nativeEvents()) : json(nativeMessage);
            const event = { error: { message: 'Only Anthropic /v1/messages is supported' } };
            return streaming ? sse([event]) : json(event);
        } });
        if (streaming) assert.equal((await consumeOpenAIStream(response.body)).content, '你好');
        else assert.equal((await response.json()).choices[0].message.content, '你好');
        assert.equal(calls, 2);
    }
});

test('empty successes and unknown formats are explicit errors without another paid request', async () => {
    const responses = [
        () => json({ choices: [{ message: { content: '' } }], usage: { prompt_tokens: 20000 } }),
        () => json({ type: 'message', content: [], usage: { input_tokens: 20000 } }),
        () => sse(['[DONE]']),
        () => sse([{ choices: [{ delta: { role: 'assistant' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }, '[DONE]']),
        () => new Response('<html>proxy error</html>'),
    ];
    for (const response of responses) {
        let calls = 0;
        await assert.rejects(async () => {
            const result = await fetchCachedProvider(endpoint, request(true), { fetchImpl: async () => { calls++; return response(); } });
            await consumeOpenAIStream(result.body);
        }, /未自动重发|已停止/);
        assert.equal(calls, 1);
    }
});

test('an error after streaming has started is surfaced without negotiation', async () => {
    let calls = 0;
    const response = await fetchCachedProvider(endpoint, request(true), { fetchImpl: async () => {
        calls++; return sse([{ choices: [{ delta: { content: 'partial' } }] }, { error: { message: 'Only Anthropic is supported' } }]);
    } });
    await assert.rejects(consumeOpenAIStream(response.body), /未自动重发/);
    assert.equal(calls, 1);
});

test('truncated streams and errors carrying usage are not retried', async () => {
    for (const events of [
        [{ choices: [{ delta: { content: 'partial' } }] }],
        [{ error: { message: 'Only Anthropic is supported' }, usage: { input_tokens: 20000 } }],
    ]) {
        let calls = 0;
        await assert.rejects(async () => {
            const response = await fetchCachedProvider(endpoint, request(true), { fetchImpl: async () => { calls++; return sse(events); } });
            await consumeOpenAIStream(response.body);
        }, /未.*重试|未自动重发/);
        assert.equal(calls, 1);
    }
});

test('cancelling an adapted native stream cancels its upstream without another request', async () => {
    let calls = 0, cancelled = false;
    const head = nativeEvents().slice(0, 2).map(event => 'data: ' + JSON.stringify(event) + '\n\n').join('');
    const response = await fetchCachedProvider(endpoint, request(true), { fetchImpl: async () => {
        calls++;
        return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(head)); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } });
    } });
    await response.body.cancel();
    assert.equal(cancelled, true); assert.equal(calls, 1);
});

test('native tool calls and signed thinking survive streaming into the next tool request', async () => {
    const events = [
        { type: 'message_start', message: { id: 'tool', model: 'claude-opus-5-5', usage: { input_tokens: 10 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: 'checking', signature: 'signed' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 't1', name: 'lookup', input: {} } },
        { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"q":"hello"}' } },
        { type: 'content_block_stop', index: 1 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } },
        { type: 'message_stop' },
    ];
    let calls = 0; const state = {};
    const fetchImpl = async (url, options) => {
        calls++;
        if (calls === 1) return rejection();
        if (calls === 2) return sse(events);
        const native = JSON.parse(options.body);
        assert.equal(native.messages[1].content[0].signature, 'signed');
        assert.deepEqual(native.messages[1].content[1].input, { q: 'hello' });
        assert.equal(native.messages[2].content[0].tool_use_id, 't1');
        return sse(nativeEvents());
    };
    const body = request(true);
    body.tools = [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } }];
    const first = await fetchCachedProvider(endpoint, body, { fetchImpl, protocolState: state });
    const output = await consumeOpenAIStream(first.body);
    assert.equal(output.anthropicContent[0].signature, 'signed');
    body.messages.push({ role: 'assistant', content: null, tool_calls: output.toolCalls, _anthropic_content: output.anthropicContent }, { role: 'tool', tool_call_id: 't1', content: 'result' });
    const second = await fetchCachedProvider(endpoint, body, { fetchImpl, protocolState: state });
    assert.equal((await consumeOpenAIStream(second.body)).content, '你好');
    assert.equal(calls, 3);
});

test('route rejection detection is specific, and non-Claude models do not negotiate', async () => {
    assert.equal(isProtocolRejection(404, '404 page not found'), true);
    assert.equal(isProtocolRejection(400, 'Only Anthropic is supported'), true);
    assert.equal(isProtocolRejection(400, 'model not found: use Anthropic'), false);
    let calls = 0;
    const result = await fetchCachedProvider(endpoint, { ...request(), model: 'gpt-test' }, { fetchImpl: async () => { calls++; return rejection(); } });
    assert.equal(result.status, 400); assert.equal(calls, 1);
});

// Exercise the four real server call sites without starting background services.
for (const [start, end, resultName] of [
    ['const toolWireBody =', 'if (!toolResponse.ok)', 'toolResponse'],
    ['const finalWireBody =', 'if (!response.ok)', 'response'],
    ['const webToolWireBody =', 'if (!toolRes.ok)', 'toolRes'],
    ['const webFinalWireBody =', 'if (!aiRes.ok)', 'aiRes'],
]) test(`real gateway negotiates and keeps per-request state: ${resultName}`, async () => {
    const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'server.js'), 'utf8');
    assert.match(source, /fetchCachedProvider\s*}\s*=\s*require\('\.\/provider-transport'\)/);
    const body = request(), parts = { currentMessage: body.messages.at(-1) };
    let calls = 0;
    const fakeFetch = async url => { calls++; return url === endpoint ? rejection() : json(nativeMessage); };
    const observer = { request() { return 1; } };
    const context = { prepareCachedRequest: prepareProviderRequest, body, toolBody: body, toolFetchBody: body, fetchBody: body,
        cacheScope: 'test', fetchCachedProvider: (url, request, options) => fetchCachedProvider(url, request, { ...options, fetchImpl: fakeFetch }),
        lifecycle: { signal: new AbortController().signal }, bodyMessages: body.messages, apiMessages: body.messages,
        contextParts: parts, webContextParts: parts, contextBudget: observer, webContextBudget: observer,
        apiUrl: endpoint, baseUrl: 'https://emtf.aipm9527.site/v1', apiHeaders: {}, apiKey: 'test-only' };
    const offset = source.indexOf(start);
    const fragment = `(async () => { ${source.slice(offset, source.indexOf(end, offset))} return ${resultName}; })()`;
    for (let round = 0; round < 2; round++) {
        const response = await require('node:vm').runInNewContext(fragment, context);
        assert.equal(JSON.parse(await response.text()).choices[0].message.content, '你好');
    }
    assert.equal(calls, 3, 'OpenAI rejection, native success, next round directly native');
});
