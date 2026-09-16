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
