'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { decideMemoryWrite, normalizeDecision } = require('../memory-merge-curator');

const incoming = { content: '吵架模块最终版确定为五条原则。', tags: ['吵架模块', '核心原则'] };
const candidates = [{ id: 'old', content: '旧版吵架模块。', tags: ['吵架模块'], similarity: 0.82 }];

test('only accepts an update target returned by vector retrieval', () => {
    assert.equal(normalizeDecision({ action: 'same', target_id: 'other', content: 'x' }, incoming, candidates).action, 'review');
    assert.equal(normalizeDecision({ action: 'update', target_id: 'old', content: 'x' }, incoming, candidates).target_id, 'old');
});

test('memory merge curator uses Flash-compatible JSON and retries without response_format', async () => {
    const requests = [];
    const fetchImpl = async (_, options) => {
        requests.push(JSON.parse(options.body));
        if (requests.length === 1) return new Response('response_format json_object is not supported', { status: 400 });
        return { ok: true, status: 200, async json() { return { choices: [{ message: { content: '{"action":"update","target_id":"old","content":"吵架模块最终版为五条原则。","tags":["吵架模块","核心原则"],"confidence":0.94}' } }] }; } };
    };
    const result = await decideMemoryWrite({ fetchImpl, apiKey: 'secret', endpoint: 'https://example.test/v1/chat/completions', model: 'gemini-3-flash-preview', incoming, candidates });
    assert.equal(result.action, 'update');
    assert.equal(result.target_id, 'old');
    assert.equal(requests[0].model, 'gemini-3-flash-preview');
    assert.equal(requests[0].max_tokens, 2000);
    assert.equal(requests[1].max_tokens, 2000);
    assert.ok(requests[0].response_format);
    assert.equal(requests[1].response_format, undefined);
    assert.match(requests[0].messages[0].content, /我=沈望、她=江鱼/);
});

test('legacy actions are normalized and uncertain target actions require review', () => {
    assert.equal(normalizeDecision({ action: 'new', confidence: 1 }, incoming, candidates).action, 'create');
    assert.equal(normalizeDecision({ action: 'skip', confidence: 1 }, incoming, candidates).action, 'review');
    assert.equal(normalizeDecision({ action: 'supersede', target_id: null, confidence: 1 }, incoming, candidates).action, 'review');
});

const decision = JSON.stringify({ action: 'update', target_id: 'old', content: incoming.content, confidence: 0.95 });
test('reads complete decisions from content blocks and native relay response formats without another request', async () => {
    for (const data of [
        { choices: [{ message: { content: [{ type: 'text', text: decision }] } }] },
        { choices: [{ message: { content: [{ type: 'text', text: decision.slice(0, 15) }, { type: 'text', text: decision.slice(15) }] } }] },
        { type: 'message', content: [{ type: 'text', text: decision }] },
        { candidates: [{ content: { parts: [{ text: decision }] }, finishReason: 'STOP' }] },
        { output: [{ type: 'message', content: [{ type: 'output_text', text: decision }] }] },
        { choices: [{ message: { content: '{"status":"ok"}\n```json\n' + decision + '\n```' } }] },
    ]) {
        let calls = 0;
        const result = await decideMemoryWrite({ incoming, candidates, apiKey: 'fake', endpoint: 'unused', fetchImpl: async () => { calls++; return Response.json(data); } });
        assert.equal(result.action, 'update'); assert.equal(result.target_id, 'old'); assert.equal(calls, 1);
    }
});

test('empty, invalid, refused and truncated paid responses are non-retryable and disclose no response text', async () => {
    for (const data of [{}, { choices: [{ message: { content: 'private-response-sentinel' } }] },
        { choices: [{ finish_reason: 'length', message: { content: decision } }] },
        { choices: [{ message: { refusal: 'private-response-sentinel', content: decision } }] }]) {
        let calls = 0;
        await assert.rejects(decideMemoryWrite({ incoming, candidates, apiKey: 'fake', endpoint: 'unused', fetchImpl: async () => { calls++; return Response.json(data); } }), error => {
            assert.equal(error.retryable, false); assert.equal(error.code, 'MEMORY_INVALID_DECISION');
            assert.doesNotMatch(error.message, /private-response-sentinel|吵架模块/); return true;
        });
        assert.equal(calls, 1);
    }
});

test('only an explicit unsupported JSON mode gets a format fallback; permanent API errors do not retry', async () => {
    for (const [status, message] of [[400, 'bad model'], [422, 'context too long'], [401, 'invalid key']]) {
        let calls = 0;
        await assert.rejects(decideMemoryWrite({ incoming, candidates, apiKey: 'fake', endpoint: 'unused', fetchImpl: async () => { calls++; return new Response(message, { status }); } }), error => error.retryable === false);
        assert.equal(calls, 1);
    }
    for (const status of [429, 503]) {
        await assert.rejects(decideMemoryWrite({ incoming, candidates, apiKey: 'fake', endpoint: 'unused', fetchImpl: async () => new Response('', { status }) }), error => error.retryable === true);
    }
});
