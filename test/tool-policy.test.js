'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { hasProjectFileIntent, requestedBuiltinToolNames, keepRequestedReadTools } = require('../tool-policy');

function tool(name, mcp) {
    return { type: 'function', function: { name }, ...(mcp ? { _mcp: 'filesystem' } : {}) };
}

test('VPS and transcript requests expose the tools they need', () => {
    assert.equal(hasProjectFileIntent('去 VPS 查一下原始对话记录的文件'), true);
    const names = requestedBuiltinToolNames('去 VPS 查一下原始对话记录的文件');
    assert.equal(names.has('exec'), true);
    assert.equal(names.has('search_transcript'), true);
});

test('read-only policy keeps requested builtins and filesystem tools', () => {
    const available = [
        tool('fetch_txt'),
        tool('exec'),
        tool('search_transcript'),
        tool('read_file', true),
    ];
    const kept = keepRequestedReadTools(available, '查一下原始对话记录的文件');
    assert.deepEqual(kept.map(item => item.function.name), ['search_transcript', 'read_file']);
});

test('ordinary chat does not carry unrelated builtin tools', () => {
    const available = [tool('exec'), tool('search_transcript'), tool('check_phone')];
    assert.deepEqual(keepRequestedReadTools(available, '抱抱我'), []);
});

test('VPS inspection still works when filesystem MCP is unavailable', () => {
    const available = [tool('exec'), tool('search_transcript')];
    const kept = keepRequestedReadTools(available, '看看 VPS 的服务日志');
    assert.deepEqual(kept.map(item => item.function.name), ['exec']);
});
