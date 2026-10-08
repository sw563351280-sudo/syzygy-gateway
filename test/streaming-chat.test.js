'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { consumeOpenAIStream } = require('../streaming-chat');

function sseStream(events) {
    const body = events.map(event => event === '[DONE]'
        ? 'data: [DONE]\n\n'
        : `data: ${JSON.stringify(event)}\n\n`).join('');
    return new Response(body).body;
}

test('upstream DONE finishes and closes a provider body that never sends EOF', async () => {
    let cancelled = false;
    const body = new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"完成"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));
    }, cancel() { cancelled = true; } });
    const result = await consumeOpenAIStream(body);
    assert.equal(result.content, '完成');
    assert.equal(cancelled, true);
    assert.equal(body.locked, false);
});

test('fragmented UTF8 and final usage without newline retain earlier cache detail', async () => {
    const text = 'data:' + JSON.stringify({ choices: [{ delta: { content: '你好' } }],
        usage: { prompt_tokens: 9000, prompt_tokens_details: { cached_tokens: 8000, cache_creation_tokens: 500 } } }) + '\r\n\r\n'
        + 'data: ' + JSON.stringify({ choices: [], usage: { completion_tokens: 100, prompt_tokens_details: { cached_tokens: 8000 } } });
    const bytes = new TextEncoder().encode(text);
    const stream = new ReadableStream({ start(controller) {
        for (let i = 0; i < bytes.length; i += 2) controller.enqueue(bytes.slice(i, i + 2));
        controller.close();
    } });
    const result = await consumeOpenAIStream(stream);
    assert.equal(result.content, '你好');
    assert.equal(result.usage.prompt_tokens_details.cache_creation_tokens, 500);
    assert.equal(result.usage.completion_tokens, 100);
});

test('stream parser preserves content and usage', async () => {
    const seen = [];
    const result = await consumeOpenAIStream(sseStream([
        { id: 'chat-1', model: 'test-model', choices: [{ delta: { reasoning_content: '想' }, finish_reason: null }] },
        { id: 'chat-1', model: 'test-model', choices: [{ delta: { content: '你' }, finish_reason: null }] },
        { id: 'chat-1', model: 'test-model', choices: [{ delta: { content: '好' }, finish_reason: 'stop' }], usage: { total_tokens: 12 } },
        '[DONE]',
    ]), (_chunk, delta) => seen.push(delta));

    assert.equal(result.content, '你好');
    assert.equal(result.reasoning, '想');
    assert.equal(result.finishReason, 'stop');
    assert.equal(result.usage.total_tokens, 12);
    assert.equal(seen.length, 3);
});

test('stream parser assembles fragmented tool calls by index', async () => {
    const result = await consumeOpenAIStream(sseStream([
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'read_private_', arguments: '' } }] }, finish_reason: null }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'journal', arguments: '{"count":' } }] }, finish_reason: null }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '3}' } }] }, finish_reason: 'tool_calls' }] },
        '[DONE]',
    ]));

    assert.deepEqual(result.toolCalls, [{
        id: 'call_1',
        type: 'function',
        function: { name: 'read_private_journal', arguments: '{"count":3}' },
    }]);
    assert.equal(result.finishReason, 'tool_calls');
});
