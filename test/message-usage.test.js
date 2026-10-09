'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMessageUsage } = require('../message-usage');
const { normalize, tracker, html } = require('../public/message-usage');
test('multiple call snapshots sum once, and absent usage stays unknown', () => {
    const accept = createMessageUsage(() => 100);
    accept({ event: 'request', call: 1 });
    const usage = { total: 1000, read: 900, write: 50, output: 20 };
    accept({ event: 'usage', call: 1, usage });
    assert.equal(accept({ event: 'usage', call: 1, usage }).total, 1000);
    accept({ event: 'request', call: 2 });
    assert.equal(accept({ event: 'usage', call: 2 }).total, null);
    const result = accept({ event: 'usage', call: 2, usage });
    assert.equal(result.total, 2000);
    assert.equal(result.read, 1800);
    assert.equal(result.output, 40);
});
test('native input excludes cache while OpenAI input includes it', () => {
    assert.deepEqual(normalize({ input_tokens: 10, cache_read_input_tokens: 80, cache_creation_input_tokens: 10, output_tokens: 3 }),
        { total: 100, read: 80, write: 10, output: 3 });
    assert.equal(normalize({ prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 80 } }).total, 100);
    assert.equal(normalize({ prompt_tokens: 100 }).write, null);
});
test('server aggregate wins over final-call usage and survives serialization', () => {
    let time = 0; const t = tracker(() => time);
    t.accept({ usage: { prompt_tokens: 100 } });
    t.accept({ syzygy_usage: { total: 1000, read: 900, write: 50, output: 20 } });
    t.accept({ usage: { prompt_tokens: 100 } });
    time = 2000;
    const saved = JSON.parse(JSON.stringify(t.finish()));
    assert.equal(saved.total, 1000);
    assert.match(html(saved), /90.0%/);
    assert.match(html(saved), /10.0 tokens\/s/);
    assert.match(html(saved), /2.0s/);
    assert.doesNotMatch(html(saved), /费用|\$/);
    assert.equal(html(null), '');
    assert.match(html({ total: 100 }), /命中 —/);
});
