'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { composeContext, measureMessages, normalizeUsage, estimateCost, readConfig, createBudgetObserver } = require('../context-budget');

const rates = { input: 5, read: 0.5, write: 6.25, output: 25, usdToCny: 7 };
const usage = { input_tokens: 300, cache_read_input_tokens: 8000, cache_creation_input_tokens: 300, output_tokens: 150 };

test('projection preserves roles, images, tool pairs and cache flags without mutating inputs', () => {
    const parts = { systemMessage: { role: 'system', content: 'rules', cache_control: { type: 'ephemeral' } },
        historyMessages: [{ role: 'assistant', content: null, tool_calls: [{ id: 'a' }] }, { role: 'tool', tool_call_id: 'a', content: 'result' }],
        currentMessage: { role: 'user', content: [{ type: 'text', text: 'context\nquestion' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,SECRET' } }] } };
    const before = JSON.stringify(parts);
    const result = composeContext(parts);
    assert.deepEqual(result, [parts.systemMessage, ...parts.historyMessages, parts.currentMessage]);
    result.push({ role: 'assistant', content: 'reply' });
    assert.equal(JSON.stringify(parts), before);
    assert.equal(measureMessages(result).mediaBlocks, 1);
});

test('native and chat usage produce the same cost without double charging cached input or thinking', () => {
    const native = normalizeUsage(usage);
    const chat = normalizeUsage({ prompt_tokens: 8600, completion_tokens: 150,
        prompt_tokens_details: { cached_tokens: 8000, cache_write_tokens: 300 },
        completion_tokens_details: { reasoning_tokens: 100 } });
    assert.deepEqual(chat, native);
    assert.ok(Math.abs(estimateCost(native, rates).cny - 0.077875) < 1e-10);
});

test('missing, invalid or inconsistent accounting is unknown, not free', () => {
    assert.equal(estimateCost(normalizeUsage({ prompt_tokens: 500, completion_tokens: 50 }), rates), null);
    assert.equal(estimateCost(normalizeUsage({ prompt_tokens: 100, completion_tokens: 50,
        cache_read_input_tokens: 200, cache_creation_input_tokens: 0 }), rates), null);
    assert.equal(estimateCost(normalizeUsage(usage), null), null);
    assert.equal(normalizeUsage(null), null);
    assert.equal(normalizeUsage({ input_tokens: NaN }).uncached, null);
});

test('off is default; invalid configuration cannot enable model calls or guess prices', () => {
    assert.equal(readConfig({}).enabled, false);
    assert.deepEqual(readConfig({ CONTEXT_BUDGET_RATES_JSON: 'bad' }).rates, {});
    const observer = createBudgetObserver({ endpoint: 'https://example.test', model: 'test', config: readConfig({}), log() { assert.fail('disabled'); } });
    observer.context({}); observer.response(observer.request({}), usage);
});

test('observer totals every model call, replaces streaming usage, and exposes only numeric diagnostics', () => {
    const events = [];
    const config = { enabled: true, targetCny: 0.08, historyTokens: 1, rates: { 'example.test|opus': rates } };
    const observer = createBudgetObserver({ endpoint: 'https://example.test/v1?key=SECRET', model: 'opus', config, log: e => events.push(e) });
    observer.context({ historyMessages: [{ role: 'user', content: 'SECRET' }] });
    const body = { messages: [{ role: 'user', content: 'SECRET' }], tools: [{ secret: 'SECRET' }] };
    const first = observer.request(body);
    observer.response(first, usage);
    observer.response(first, usage);
    assert.equal(events.at(-1).turn.calls, 1);
    const second = observer.request(body);
    observer.response(second, null);
    assert.equal(events.at(-1).turn.complete, false);
    observer.response(second, usage);
    assert.equal(events.at(-1).turn.complete, true);
    assert.equal(events.at(-1).turn.overTarget, true);
    assert.ok(Math.abs(events.at(-1).turn.knownCny - 0.15575) < 1e-10);
    assert.equal(JSON.stringify(events).includes('SECRET'), false);
    assert.equal(events[0].compactSuggested, true);
});

test('pricing is scoped to exact provider and model; broken logging cannot break chat', () => {
    const config = { enabled: true, targetCny: 0.08, historyTokens: 12000, rates: { 'other.test|opus': rates } };
    const events = [];
    const observer = createBudgetObserver({ endpoint: 'https://example.test', model: 'opus', config, log: e => events.push(e) });
    observer.response(observer.request({ messages: [] }), usage);
    assert.equal(events.at(-1).estimatedCost, null);
    const broken = createBudgetObserver({ endpoint: 'https://example.test', model: 'opus', config, log() { throw Error('log failed'); } });
    assert.doesNotThrow(() => broken.response(broken.request({ messages: [] }), usage));
});
