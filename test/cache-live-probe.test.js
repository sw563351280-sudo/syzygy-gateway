'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runProbe, selectKey } = require('../scripts/cache-live-probe');
const adapter = require('../provider-cache');
const budget = require('../context-budget');

test('paid probe caps requests, changes only suffix, then exactly repeats; logs no secrets', async () => {
    const bodies = [], logs = [];
    await runProbe({ key: 'test-secret', adapter, budget, nonce: 'fixed', emit: v => logs.push(v), fetchImpl: async (url, options) => {
        bodies.push(JSON.parse(options.body));
        assert.equal(url, 'https://api.treegpt.cc/v1/chat/completions');
        assert.equal(options.redirect, 'error');
        return new Response('data: ' + JSON.stringify({ usage: { prompt_tokens: 1504, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 1500 } } }) + '\n\ndata: [DONE]\n', { headers: { 'content-type': 'text/event-stream' } });
    } });
    assert.equal(bodies.length, 3);
    assert.deepEqual(bodies[0].messages.slice(0, -1), bodies[1].messages.slice(0, -1));
    assert.notDeepEqual(bodies[0].messages.at(-1), bodies[1].messages.at(-1));
    assert.deepEqual(bodies[1], bodies[2]);
    assert.ok(!logs.join('').includes('test-secret'));
    assert.ok(!logs.join('').includes('amber river'));
});
test('probe stops after a changed-suffix hit', async () => {
    let calls = 0;
    await runProbe({ key: 'fake', adapter, budget, emit: () => {}, fetchImpl: async () => {
        calls++;
        return Response.json({ usage: { prompt_tokens: 1504, completion_tokens: 1, prompt_tokens_details: { cached_tokens: calls === 2 ? 1500 : 0, cache_write_tokens: calls === 2 ? 0 : 1500 } } });
    } });
    assert.equal(calls, 2);
});
test('probe does not retry HTTP failure or unexpected token volume', async () => {
    for (const response of [new Response('', { status: 429 }), Response.json({ usage: { prompt_tokens: 4000, completion_tokens: 1 } })]) {
        let calls = 0;
        await runProbe({ key: 'fake', adapter, budget, emit: () => {}, fetchImpl: async () => { calls++; return response; } });
        assert.equal(calls, 1);
    }
});
test('credential selection uses active TreeGPT supplier and rejects ambiguity', () => {
    const suppliers = [{ url: '/via/tree/v1', key: 'one' }, { url: 'https://api.treegpt.cc/v1', key: 'two' }];
    assert.equal(selectKey({ suppliers, activeSupIndex: 1 }), 'two');
    assert.throws(() => selectKey({ suppliers, activeSupIndex: 9 }));
});
