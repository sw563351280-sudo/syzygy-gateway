const test = require('node:test');
const assert = require('node:assert/strict');
const { configuration, publicConfiguration, diagnose } = require('../memory-curator-diagnostics');
const config = { endpoint: 'https://user:pass@example.test/v1/chat/completions?key=secret123', apiKey: 'secret123', model: 'test-model', keySource: 'DREAM_API_KEY' };
test('configuration matches memory classification fallback and hides secrets', () => {
    assert.equal(configuration({ DREAM_API_KEY: 'dream', ROUTER_API_KEY: 'router' }).apiKey, 'dream');
    assert.equal(configuration({}).model, 'gemini-3-flash-preview');
    const value = publicConfiguration(config);
    assert.equal(value.endpoint, 'https://example.test/v1/chat/completions');
    assert.doesNotMatch(JSON.stringify(value), /secret123|user:pass/);
});
test('503 diagnostics keep sanitized detail and request ID without memory writes', async () => {
    const result = await diagnose(config, async (_url, options) => {
        const body = JSON.parse(options.body);
        assert.equal(options.redirect, 'manual');
        assert.match(body.messages[1].content, /连接诊断/);
        return { ok: false, status: 503, headers: { get: key => key === 'x-request-id' ? 'req-123' : null },
            text: async () => JSON.stringify({ error: { message: 'no channel key=secret123 Authorization: Bearer secret123' } }) };
    });
    assert.equal(result.ok, false);
    assert.equal(result.attempts[0].status, 503);
    assert.equal(result.attempts[0].requestId, 'req-123');
    assert.match(result.attempts[0].detail, /no channel/);
    assert.doesNotMatch(JSON.stringify(result), /secret123/);
});
test('missing credentials do not send requests; network errors are sanitized', async () => {
    const result = await diagnose({ ...config, apiKey: '' }, () => { throw new Error('should not run'); });
    assert.match(result.error, /未配置/);
    const failed = await diagnose(config, async () => { throw new Error('failed https://user:pass@example.test/?key=secret123'); });
    assert.doesNotMatch(JSON.stringify(failed), /secret123|user:pass/);
});
test('success validates synthetic classification and does not return model response content', async () => {
    const result = await diagnose(config, async () => ({ ok: true, status: 200, headers: { get: () => null },
        json: async () => ({ choices: [{ message: { content: '{"action":"create","content":"synthetic reply","confidence":1}' } }] }) }));
    assert.equal(result.ok, true);
    assert.doesNotMatch(JSON.stringify(result), /synthetic reply/);
});
