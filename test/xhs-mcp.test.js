'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createXhsMcp } = require('../xhs-mcp');
function setup(t, invoke) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-gate-'));
    t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
    const options = { dataDir, invoke, interval: 0 };
    return { options, gate: createXhsMcp(options) };
}
test('writes only prepare immutable exact operation; confirmation executes once, persists across restart', async t => {
    const calls = [];
    const { gate, options } = setup(t, async (name, args) => { calls.push({ name, args }); return { content: [{ type: 'text', text: '成功' }] }; });
    const args = { feed_id: 'note-1', content: '指定评论', xsec_token: 'internal' };
    const pending = JSON.parse(await gate.execute('xhs_post_comment_to_feed', args, { sessionId: 'main' }));
    args.content = '篡改';
    assert.equal(calls.length, 0);
    assert.equal(gate.approval(pending.id).args.xsec_token, undefined);
    assert.equal(JSON.parse(await gate.execute('xhs_post_comment_to_feed', { feed_id: 'note-1', content: '指定评论', xsec_token: 'internal' }, { sessionId: 'main' })).id, pending.id);
    await Promise.allSettled([gate.confirm(pending.id), gate.confirm(pending.id)]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].args.content, '指定评论');
    await assert.rejects(createXhsMcp(options).confirm(pending.id), /不会重复/);
});
test('uncertain writes never automatically replay after failure or restart', async t => {
    let calls = 0;
    const { gate, options } = setup(t, async () => { calls++; throw new Error('timeout'); });
    const pending = JSON.parse(await gate.execute('like_feed', { feed_id: 'one' }));
    await assert.rejects(gate.confirm(pending.id));
    assert.equal(gate.approval(pending.id).status, 'uncertain');
    await assert.rejects(createXhsMcp(options).confirm(pending.id));
    assert.equal(calls, 1);
});
test('unknown, discussion, background and expired actions cannot call upstream', async t => {
    let calls = 0;
    const { options } = setup(t, async () => { calls++; return {}; });
    let now = 0;
    const gate = createXhsMcp({ ...options, now: () => now });
    await assert.rejects(gate.execute('future_write_tool', {}));
    await assert.rejects(gate.execute('search_feeds', {}, { readOnly: true }));
    await assert.rejects(gate.execute('search_feeds', {}, { sessionId: 'background' }));
    const pending = JSON.parse(await gate.execute('delete_cookies', {}));
    now = 600001;
    await assert.rejects(gate.confirm(pending.id));
    assert.equal(calls, 0);
});
test('embedded JSON strips source links, proxies images and preserves internal note identifiers', t => {
    const { gate } = setup(t, async () => ({}));
    const output = gate.sanitize({ text: JSON.stringify({ id: 'one', xsec_token: 'locator', url: 'https://www.xiaohongshu.com/explore/one?xsec_token=secret', image: 'http://sns-webpic-qc.xhscdn.com/a/b.jpg', cookie: 'secret' }) });
    const data = JSON.parse(output.text);
    assert.equal(data.id, 'one'); assert.equal(data.xsec_token, 'locator');
    assert.equal(data.cookie, undefined);
    assert.equal(data.url, '[外部链接已隐藏]');
    assert.match(data.image, /^\/api\/xhs-mcp\/media\//);
    assert.equal(gate.media(data.image.split('/').pop()), 'https://sns-webpic-qc.xhscdn.com/a/b.jpg');
    assert.doesNotMatch(JSON.stringify(output), /https:|secret/);
});
test('challenge pauses browsing across restart; explicit successful login status unpauses', async t => {
    let calls = 0;
    const { options, gate } = setup(t, async name => { calls++; return { content: [{ type: 'text', text: name === 'check_login_status' ? '✅ 已登录' : '需要滑块验证' }] }; });
    await gate.execute('search_feeds', {});
    const restarted = createXhsMcp(options);
    await assert.rejects(restarted.execute('list_feeds', {})); assert.equal(calls, 1);
    await restarted.login('check_login_status');
    await restarted.execute('list_feeds', {}); assert.equal(calls, 3);
});
test('concurrent reads and immediate repeat are throttled', async t => {
    let release, calls = 0;
    const { options } = setup(t, async () => { calls++; await new Promise(r => { release = r; }); return {}; });
    const gate = createXhsMcp({ ...options, interval: 4000 });
    const first = gate.execute('list_feeds', {});
    await assert.rejects(gate.execute('list_feeds', {}), /间隔/);
    release(); await first;
    await assert.rejects(gate.execute('list_feeds', {}), /间隔/);
    assert.equal(calls, 1);
});
