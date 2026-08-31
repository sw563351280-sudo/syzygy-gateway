'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    INITIAL_MAX_TOKENS,
    RETRY_MAX_TOKENS,
    generateProactiveCompletion,
} = require('../proactive-generation');

function response(data, ok = true) {
    return {
        ok,
        status: ok ? 200 : 500,
        async json() { return data; },
        async text() { return JSON.stringify(data); },
    };
}

test('proactive generation normally uses a 1024 token ceiling', async () => {
    const bodies = [];
    const result = await generateProactiveCompletion({
        fetchImpl: async (_url, options) => {
            bodies.push(JSON.parse(options.body));
            return response({ choices: [{ finish_reason: 'stop', message: { content: '想你。' } }] });
        },
        url: 'https://example.test/chat', apiKey: 'secret', model: 'shen',
        messages: [{ role: 'user', content: '说句话' }],
    });

    assert.equal(result.ok, true);
    assert.equal(result.retried, false);
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].max_tokens, INITIAL_MAX_TOKENS);
});

test('a length stop retries once from scratch with 2048 tokens and a brevity constraint', async () => {
    const bodies = [];
    const results = [
        { choices: [{ finish_reason: 'length', message: { content: '说到一半' } }] },
        { choices: [{ finish_reason: 'stop', message: { content: '完整的一句话。' } }] },
    ];
    const result = await generateProactiveCompletion({
        fetchImpl: async (_url, options) => {
            bodies.push(JSON.parse(options.body));
            return response(results.shift());
        },
        url: 'https://example.test/chat', apiKey: 'secret', model: 'shen',
        messages: [{ role: 'user', content: '说句话' }],
    });

    assert.equal(result.ok, true);
    assert.equal(result.retried, true);
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].max_tokens, INITIAL_MAX_TOKENS);
    assert.equal(bodies[1].max_tokens, RETRY_MAX_TOKENS);
    assert.match(bodies[1].messages.at(-1).content, /从头重新生成/);
    assert.match(bodies[1].messages.at(-1).content, /1至3句/);
});

test('proactive generation never retries more than once', async () => {
    let calls = 0;
    const result = await generateProactiveCompletion({
        fetchImpl: async () => {
            calls++;
            return response({ choices: [{ finish_reason: 'length', message: { content: '仍然截断' } }] });
        },
        url: 'https://example.test/chat', apiKey: 'secret', model: 'shen',
        messages: [{ role: 'user', content: '说句话' }],
    });

    assert.equal(calls, 2);
    assert.equal(result.data.choices[0].finish_reason, 'length');
});

test('a due proactive wake goes directly to full generation without a light gate', () => {
    const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.doesNotMatch(serverSource, /runProactiveLightGate|唤醒门控|门控SKIP/);
    assert.match(serverSource, /const wakeReason = 'scheduled_wake'/);
    assert.match(serverSource, /自适应唤醒计划已经到点/);
});
