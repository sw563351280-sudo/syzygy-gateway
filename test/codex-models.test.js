'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { createModelReader } = require('../codex-models');
function fixture(reply, timeoutMs = 1000) {
    const calls = [], children = [];
    const read = createModelReader({ bin: 'codex', cwd: '.', env: () => ({}), timeoutMs,
        spawn() {
            const child = new EventEmitter(); children.push(child);
            child.stdout = new PassThrough(); child.stderr = new PassThrough();
            child.kill = () => { child.killed = true; };
            child.stdin = new Writable({ write(data, _, done) {
                const message = JSON.parse(data); calls.push(message);
                const result = message.method === 'initialize' ? { result: {} } : reply(message);
                if (result) setImmediate(() => child.stdout.write(JSON.stringify({ id: message.id, ...result }) + '\n'));
                done();
            } });
            return child;
        } });
    return { read, calls, children };
}
test('model discovery paginates, filters hidden entries, caches and never starts a turn', async () => {
    const { read, calls, children } = fixture(message => message.method === 'model/list' ? { result: {
        data: message.params.cursor ? [{ model: 'hidden', hidden: true }, { model: 'second', displayName: 'Second' }] :
            [{ model: 'first', supportedReasoningEfforts: [{ reasoningEffort: 'max' }] }],
        nextCursor: message.params.cursor ? null : 'page2'
    } } : null);
    const [a, b] = await Promise.all([read(), read()]);
    assert.deepEqual(a.map(row => row.model), ['first', 'second']);
    assert.deepEqual(a, b);
    assert.equal(a[0].supportedReasoningEfforts[0].reasoningEffort, 'max');
    await read();
    assert.equal(children.length, 1);
    assert.equal(children[0].killed, true);
    assert.ok(calls.every(row => ['initialize', 'initialized', 'model/list'].includes(row.method)));
});
test('failed model discovery is retryable and cleans up the process', async () => {
    const { read, children } = fixture(message => message.method === 'model/list' ? { error: { message: 'unavailable' } } : null);
    await assert.rejects(read(), /unavailable/);
    await assert.rejects(read(), /unavailable/);
    assert.equal(children.length, 2);
    assert.ok(children.every(child => child.killed));
});
