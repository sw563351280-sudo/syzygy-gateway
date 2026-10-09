'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { safeEvent } = require('../scripts/cache-diagnostics');

test('diagnostic preserves opaque cached-span state and fingerprint but omits payload text', () => {
    const line = e => ({ __REALTIME_TIMESTAMP: '1791524800000000', MESSAGE: '[ContextBudget] ' + JSON.stringify(e) });
    const output = safeEvent(line({ event: 'request', call: 7, callHost: 'api.treegpt.cc', callModel: 'claude-opus-5-5',
        wire: { strategy: 'tree-history-prefix-v2', cachedSpanState: 'stable', roles: ['system', 'user'],
            stablePrefix: { messages: 38, bytes: 108000, fingerprint: '0123456789abcdef' },
            suffix: { messages: 1, bytes: 500, fingerprint: 'fedcba9876543210' },
            requestOptions: { keys: ['max_tokens', 'stream'], fingerprint: 'private-options' },
            prompt: 'do not expose this' } }));
    assert.equal(output.wire.cachedSpanState, 'stable');
    assert.deepEqual(output.wire.cachedSpan, { messages: 38, bytes: 108000, fingerprint: '0123456789abcdef' });
    assert.equal(output.wire.strategy, 'tree-history-prefix-v2');
    assert.equal(output.wire.requestOptions.keys.join(','), 'max_tokens,stream');
    assert.doesNotMatch(JSON.stringify(output), /private-options|do not expose this/);
});

test('diagnostic omits prompt text, tool definitions, secrets and unrelated logs', () => {
    const line = e => ({ __REALTIME_TIMESTAMP: '1791524800000000', MESSAGE: '[ContextBudget] ' + JSON.stringify(e) });
    const output = safeEvent(line({ event: 'request', host: 'api.treegpt.cc', model: 'claude-opus-5-5', toolCount: 2,
        cacheRequest: { breakpoints: [{ role: 'system', ttl: '1h', content: 'private text' }] },
        toolSchema: { count: 2, description: 'private text' }, body: { apiKey: 'secret' }, token: 'secret' }));
    assert.equal(output.toolCount, 2);
    assert.doesNotMatch(JSON.stringify(output), /secret|private text/);
    assert.equal(safeEvent({ __REALTIME_TIMESTAMP: '1791524800000000', MESSAGE: 'private text secret' }), null);
});
