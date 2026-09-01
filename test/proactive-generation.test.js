'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    MAX_TOKENS,
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

test('proactive generation uses a single 2048 token request', async () => {
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
    assert.equal(bodies[0].max_tokens, MAX_TOKENS);
});

test('a length stop is not retried with the full context', async () => {
    const bodies = [];
    const result = await generateProactiveCompletion({
        fetchImpl: async (_url, options) => {
            bodies.push(JSON.parse(options.body));
            return response({ choices: [{ finish_reason: 'length', message: { content: '说到一半' } }] });
        },
        url: 'https://example.test/chat', apiKey: 'secret', model: 'shen',
        messages: [{ role: 'user', content: '说句话' }],
    });

    assert.equal(result.ok, true);
    assert.equal(result.retried, false);
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].max_tokens, MAX_TOKENS);
    assert.equal(result.data.choices[0].finish_reason, 'length');
});

test('a due proactive wake goes directly to full generation without a light gate', () => {
    const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.doesNotMatch(serverSource, /runProactiveLightGate|唤醒门控|门控SKIP/);
    assert.match(serverSource, /const wakeReason = 'scheduled_wake'/);
    assert.match(serverSource, /自适应唤醒计划已经到点/);
});
