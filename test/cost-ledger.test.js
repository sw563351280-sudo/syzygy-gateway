'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createCostLedger } = require('../cost-ledger');
const { createBudgetObserver } = require('../context-budget');
const { createSummarizer } = require('../rolling-context');
const { formatCacheStatus } = require('../public/context-cache-status');
const config = { enabled: true, targetCny: 0.08, historyTokens: 12000, rates: {
    'chat.test|opus': { input: 5, read: .5, write: 6.25, output: 25, usdToCny: 7 },
    'summary.test|small': { billing: 'flat', input: 1, output: 2, usdToCny: 7 },
} };
const usage = { prompt_tokens: 1000, completion_tokens: 100, cache_read_input_tokens: 500, cache_creation_input_tokens: 0 };
function temp(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'syzygy-cost-test-'));
    t.after(() => { assert.equal(path.dirname(directory), path.resolve(os.tmpdir())); fs.rmSync(directory, { recursive: true, force: true }); });
    return path.join(directory, 'costs.json');
}

test('summary and streaming chat are counted once with independent rates; ledger survives restart', async t => {
    const filename = temp(t), ledger = createCostLedger({ filename });
    const observer = createBudgetObserver({ endpoint: 'https://chat.test/v1?secret=KEY', model: 'opus', config, log: event => ledger.record(event) });
    const summarize = createSummarizer({ endpoint: 'https://summary.test/v1', model: 'small', apiKey: 'KEY', fetchImpl: async () => ({ ok: true,
        json: async () => ({ choices: [{ finish_reason: 'length', message: { content: 'rejected summary' } }], usage: { prompt_tokens: 2000, completion_tokens: 100 } }) }) });
    await summarize({ previousSummary: 'PRIVATE', messages: [], observer });
    const call = observer.request({ messages: [{ role: 'user', content: 'PRIVATE' }] });
    observer.response(call, usage); observer.response(call, usage);
    assert.equal(ledger.snapshot().recent.turns, 0);
    observer.finish(); observer.finish();
    const snapshot = ledger.snapshot();
    assert.equal(snapshot.latest.turn.calls, 2);
    assert.equal(snapshot.latest.turn.summary.calls, 1);
    assert.ok(Math.abs(snapshot.latest.turn.knownCny - (0.00525 + 0.0022) * 7) < 1e-10);
    assert.equal(snapshot.recent.completeTurns, 1);
    assert.equal(createCostLedger({ filename }).snapshot().recent.averageCompleteCny, snapshot.recent.averageCompleteCny);
    assert.doesNotMatch(fs.readFileSync(filename, 'utf8'), /PRIVATE|KEY|rejected summary/);
});

test('failed summary is unknown, not free; incomplete turns excluded from average', async t => {
    const ledger = createCostLedger({ filename: temp(t) });
    const observer = createBudgetObserver({ endpoint: 'https://chat.test', model: 'opus', config, log: e => ledger.record(e) });
    const summarize = createSummarizer({ endpoint: 'https://summary.test', model: 'small', apiKey: 'x', fetchImpl: async () => { throw Error('timeout'); } });
    await assert.rejects(summarize({ previousSummary: '', messages: [], observer }));
    observer.response(observer.request({ messages: [] }), usage);
    observer.finish();
    const snapshot = ledger.snapshot();
    assert.equal(snapshot.latest.turn.summary.unknownCalls, 1);
    assert.equal(snapshot.recent.completeTurns, 0);
    assert.equal(snapshot.recent.averageCompleteCny, null);
    const text = formatCacheStatus({ costLedger: snapshot });
    assert.match(text, /已知小计/);
    assert.match(text, /不能当作整轮总价/);
});

test('unconfigured summary prices stay unknown even when token counts exist', () => {
    const events = [];
    const observer = createBudgetObserver({ endpoint: 'https://chat.test', model: 'opus', config, log: e => events.push(e) });
    const call = observer.request({ messages: [] }, { kind: 'summary', endpoint: 'https://unknown.test', model: 'small' });
    observer.response(call, { prompt_tokens: 1000, completion_tokens: 50 });
    observer.finish();
    assert.equal(events.at(-2).unknownReason, 'price_unconfigured');
    assert.equal(events.at(-1).turn.knownCny, null);
    assert.equal(events.at(-1).turn.complete, false);
});

test('unfinished records after restart and interrupted replies never count as completed samples', t => {
    const filename = temp(t), ledger = createCostLedger({ filename });
    const observer = createBudgetObserver({ endpoint: 'https://chat.test', model: 'opus', config, log: e => ledger.record(e) });
    observer.response(observer.request({ messages: [] }), usage);
    const restored = createCostLedger({ filename }).snapshot();
    assert.equal(restored.latest.turn.outcome, 'interrupted');
    assert.equal(restored.recent.incompleteTurns, 1);
    assert.equal(restored.recent.completeTurns, 0);
});

test('corrupt ledger is preserved and explicitly flagged', t => {
    const filename = temp(t);
    fs.writeFileSync(filename, 'broken');
    const ledger = createCostLedger({ filename });
    const observer = createBudgetObserver({ endpoint: 'https://chat.test', model: 'opus', config, log: e => ledger.record(e) });
    observer.response(observer.request({ messages: [] }), usage); observer.finish();
    assert.equal(ledger.snapshot().storageError, true);
    assert.equal(fs.readFileSync(filename, 'utf8'), 'broken');
});
