'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { hasProjectFileIntent, hasToyDeviceIntent, hasToyFollowUpIntent, hasAlbumSearchIntent, requestedBuiltinToolNames, keepRequestedReadTools } = require('../tool-policy');

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

test('ledger tools are retained for ledger and expense contexts', () => {
    const available = [tool('check_ledger'), tool('query_ledger'), tool('exec')];
    for (const phrase of ['小金库我能看吗', '昨天点的外卖花了多少', '这个月底结余怎么样', '最近是不是乱花钱了']) {
        assert.deepEqual(
            keepRequestedReadTools(available, phrase).map(item => item.function.name),
            ['check_ledger', 'query_ledger'],
            phrase,
        );
    }
});

test('natural device commands work without saying the device name', () => {
    for (const phrase of ['震我一下', '开震', '调强一点', '调轻一点', '停震']) {
        assert.equal(hasToyDeviceIntent(phrase), true, phrase);
    }
    for (const phrase of ['帮我开一下窗', '我们停一下聊别的', '你轻一点说']) {
        assert.equal(hasToyDeviceIntent(phrase), false, phrase);
    }
});

test('device follow-ups include escalation and hold wording', () => {
    for (const phrase of ['还要', '再来', '继续', '保持', '就这样']) {
        assert.equal(hasToyFollowUpIntent(phrase), true, phrase);
    }
});

test('album search requires an explicit request instead of a photo mention', () => {
    for (const phrase of ['看看相册', '帮我找一下去年旅行的照片', '相册里有什么照片', '给我看 album 里的图']) {
        assert.equal(hasAlbumSearchIntent(phrase), true, phrase);
    }
    for (const phrase of ['截图中成功是约 2.4 万 token', '你刚才一边等外卖一边翻相册', '这张图片的颜色真好看']) {
        assert.equal(hasAlbumSearchIntent(phrase), false, phrase);
    }
});

test('VPS inspection still works when filesystem MCP is unavailable', () => {
    const available = [tool('exec'), tool('search_transcript')];
    const kept = keepRequestedReadTools(available, '看看 VPS 的服务日志');
    assert.deepEqual(kept.map(item => item.function.name), ['exec']);
});
