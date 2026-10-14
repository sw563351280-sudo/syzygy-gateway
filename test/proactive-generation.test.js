'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
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

test('proactive request body includes the current Beijing clock in its synthetic user message', async () => {
    const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const timestampStart = serverSource.indexOf('function getBeijingTime()');
    const timestampEnd = serverSource.indexOf('// 🧾', timestampStart);
    const wakeStart = serverSource.indexOf('async function generateProactiveMessage');
    const messagesStart = serverSource.indexOf('    const msgs = [', wakeStart);
    const messagesEnd = serverSource.indexOf('\n\n    console.log', messagesStart);
    assert.ok(timestampStart >= 0 && timestampEnd > timestampStart);
    assert.ok(messagesStart >= 0 && messagesEnd > messagesStart);

    const fixedNow = '2026-10-13T23:00:00.000Z'; // 2026-10-14 07:00:00 in Beijing
    class FixedDate extends Date {
        constructor(...args) { super(...(args.length ? args : [fixedNow])); }
        static now() { return new Date(fixedNow).getTime(); }
    }
    const messages = vm.runInNewContext(`(() => {
        ${serverSource.slice(timestampStart, timestampEnd)}
        ${serverSource.slice(messagesStart, messagesEnd)}
        return msgs;
    })()`, {
        Date: FixedDate,
        wakeSharedSystem: { systemMessage: { role: 'system', content: 'rules' } },
        recentMsgs: [{ role: 'assistant', content: 'history' }],
    });

    let requestBody;
    await generateProactiveCompletion({
        fetchImpl: async (_url, options) => {
            requestBody = JSON.parse(options.body);
            return response({ choices: [{ finish_reason: 'stop', message: { content: '早安。' } }] });
        },
        url: 'https://example.test/chat', apiKey: 'secret', model: 'shen', messages,
    });

    assert.equal(requestBody.messages.at(-1).role, 'user');
    assert.match(requestBody.messages.at(-1).content, /^\[系统时间：2026\/10\/14 07:00:00\]\n\n【当前主动开口】/);
});
