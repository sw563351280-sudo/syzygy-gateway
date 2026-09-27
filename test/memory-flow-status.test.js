const test = require('node:test');
const assert = require('node:assert/strict');
const { observe, snapshot } = require('../memory-flow-status');
const merge = { model: 'flash', endpoint: 'https://example.test/v1?key=secret', apiKey: 'secret', keySource: 'DREAM_API_KEY' };
const relationship = { ...merge, model: 'sonnet' };
const reality = { ...merge, model: 'other-model' };
const read = events => snapshot({ merge, relationship, reality, events });
test('flow exposes each configured model without secrets or memory content', () => {
    const data = read([{ kind: 'long_term', status: 'pending', error: '审查器失败：503', payload: { content: 'PRIVATE_MEMORY' } }, { kind: 'crumb', status: 'pending' }]);
    assert.deepEqual(data.services.map(row => row.model), ['flash', 'sonnet', 'other-model']);
    assert.equal(data.mergeFailures, 1); assert.equal(data.pending, 1);
    assert.equal(data.services[0].observation, null);
    assert.doesNotMatch(JSON.stringify(data), /secret|PRIVATE_MEMORY/);
});
test('observations preserve results and failures, do not imply all records were saved', async () => {
    const value = { unchanged: true };
    assert.equal(await observe('relationship', relationship, async () => value), value);
    assert.equal(read().services[1].observation.status, 'success');
    const failure = new Error('upstream secret failed');
    await assert.rejects(observe('reality', reality, async () => { throw failure; }), error => error === failure);
    assert.equal(read().services[2].observation.status, 'failed');
    assert.doesNotMatch(JSON.stringify(read()), /secret/);
    const changed = snapshot({ merge, relationship: { ...relationship, model: 'new-model' }, reality });
    assert.equal(changed.services[1].observation, null);
});
