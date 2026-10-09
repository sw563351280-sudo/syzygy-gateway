const test = require('node:test');
const assert = require('node:assert/strict');
const { safeEvent } = require('../scripts/cache-diagnostics');
test('diagnostic omits prompt text, tool definitions, secrets and unrelated logs', () => {
    const line = e => ({ __REALTIME_TIMESTAMP: '1791524800000000', MESSAGE: '[ContextBudget] ' + JSON.stringify(e) });
    const output = safeEvent(line({ event: 'request', host: 'api.treegpt.cc', model: 'claude-opus-5-5', toolCount: 2,
        cacheRequest: { breakpoints: [{ role: 'system', ttl: '1h', content: 'private text' }] },
        toolSchema: { count: 2, description: 'private text' }, body: { apiKey: 'secret' }, token: 'secret' }));
    assert.equal(output.toolCount, 2);
    assert.doesNotMatch(JSON.stringify(output), /secret|private text/);
    assert.equal(safeEvent({ __REALTIME_TIMESTAMP: '1791524800000000', MESSAGE: 'private text secret' }), null);
});
