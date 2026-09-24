'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { stableToolSchema, createToolSchemaTracker } = require('../tool-schema-cache');
const { prepareCachedRequest } = require('../provider-cache');
const { createBudgetObserver } = require('../context-budget');
const tool = name => ({ type: 'function', function: { name, description: 'PRIVATE_DESCRIPTION',
    parameters: { type: 'object', properties: { z: { type: 'string' }, a: { enum: ['z', 'a'] } }, required: ['z', 'a'], additionalProperties: false } } });

test('wire definitions are identical despite relevance ranking and object key order', () => {
    const a = tool('a'), b = tool('b');
    const shuffled = { function: { parameters: { additionalProperties: false, required: ['z', 'a'],
        properties: { a: { enum: ['z', 'a'] }, z: { type: 'string' } }, type: 'object' }, description: 'PRIVATE_DESCRIPTION', name: 'a' }, type: 'function' };
    const original = JSON.stringify([b, a]);
    const body = { model: 'claude-opus-4-6', tools: [b, a], tool_choice: { type: 'function', function: { name: 'b' } },
        messages: [{ role: 'system', content: 'rules' }, { role: 'user', content: 'question' }] };
    const wire = prepareCachedRequest('https://aihubmix.com/v1', body);
    const next = prepareCachedRequest('https://aihubmix.com/v1', { ...body, tools: [shuffled, b] });
    assert.equal(JSON.stringify(wire.tools), JSON.stringify(next.tools));
    assert.equal(JSON.stringify(body.tools), original);
    assert.deepEqual(wire.tool_choice, body.tool_choice);
    assert.deepEqual(wire.tools[0].function.parameters.required, ['z', 'a']);
    assert.deepEqual(wire.tools[0].function.parameters.properties.a.enum, ['z', 'a']);
});

test('deduplicates only exact definitions; does not add tools or freeze changed permissions', () => {
    const read = tool('read'), execute = tool('exec');
    assert.deepEqual(stableToolSchema([read, read]).map(t => t.function.name), ['read']);
    assert.equal(stableToolSchema([read, { ...read, function: { ...read.function, description: 'changed' } }]).length, 2);
    assert.equal(stableToolSchema([read, execute]).length, 2);
    assert.deepEqual(stableToolSchema([read]).map(t => t.function.name), ['read']);
    const body = { model: 'claude-opus-4-6', tools: [execute, read], messages: [] };
    assert.equal(prepareCachedRequest('https://other.test', body), body);
});

test('schema tracker separates conversations/models and reports real changes without exposing schemas', () => {
    const tracker = createToolSchemaTracker();
    const scope = ['aihubmix.com', 'opus', 'PRIVATE_SESSION'];
    const a = tool('a'), b = tool('b');
    assert.equal(tracker.compare(scope, [a]).state, 'first');
    assert.equal(tracker.compare(scope, [a]).state, 'stable');
    const added = tracker.compare(scope, [a, b]);
    assert.equal(added.added, 1);
    const changed = tracker.compare(scope, [{ ...a, function: { ...a.function, description: 'different' } }]);
    assert.equal(changed.removed, 1);
    assert.equal(changed.definitionsChanged, 1);
    assert.equal(tracker.compare(['other-model'], [a]).state, 'first');
    assert.doesNotMatch(JSON.stringify([added, changed]), /PRIVATE|description|parameters/);
});

test('tracker expires and evicts bounded snapshots', () => {
    let now = 0;
    const tracker = createToolSchemaTracker({ limit: 1, ttlMs: 10, now: () => now });
    tracker.compare('a', []);
    now = 11;
    assert.equal(tracker.compare('a', []).state, 'first');
    tracker.compare('b', []);
    assert.equal(tracker.compare('a', []).state, 'first');
});

test('observer compares actual wire schema across turns without logging conversation ID', () => {
    const events = [];
    const options = { endpoint: 'https://aihubmix.com/v1', model: 'claude-opus-4-6', conversationId: 'PRIVATE_SCOPE', log: e => events.push(e) };
    createBudgetObserver(options).request({ tools: [tool('a')], messages: [] });
    createBudgetObserver(options).request({ tools: [tool('a')], messages: [] });
    assert.equal(events.at(-1).toolSchema.state, 'stable');
    assert.equal(events.at(-1).toolSchema.scope, 'conversation');
    assert.doesNotMatch(JSON.stringify(events), /PRIVATE|description|parameters/);
    createBudgetObserver({ ...options, conversationId: null }).request({ tools: [tool('a')], messages: [] });
    assert.equal(events.at(-1).toolSchema.state, 'first');
    assert.equal(events.at(-1).toolSchema.scope, 'turn');
});
