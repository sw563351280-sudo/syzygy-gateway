'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

async function loadWorker() {
    return import('../workers/xhs-resolver/worker.mjs');
}

test('cloud resolver expands only Xiaohongshu redirects', async () => {
    const { expandXhsUrl } = await loadWorker();
    const requests = [];
    const fetchImpl = async (url) => {
        requests.push(url);
        if (requests.length === 1) {
            return new Response('', { status: 302, headers: { location: 'https://www.xiaohongshu.com/discovery/item/note_1?xsec_token=ok' } });
        }
        return new Response('<html></html>', { status: 200 });
    };
    const result = await expandXhsUrl(fetchImpl, 'http://xhslink.cn/o/abc');
    assert.equal(result, 'https://www.xiaohongshu.com/discovery/item/note_1?xsec_token=ok');
    assert.equal(requests.length, 2);
});

test('cloud resolver rejects redirects outside the allowlist', async () => {
    const { expandXhsUrl } = await loadWorker();
    const fetchImpl = async () => new Response('', { status: 302, headers: { location: 'https://example.com/private' } });
    await assert.rejects(() => expandXhsUrl(fetchImpl, 'https://xhslink.cn/o/abc'), /allowlist/);
});

test('cloud resolver endpoint requires its bearer token', async () => {
    const { default: worker } = await loadWorker();
    const response = await worker.fetch(new Request('https://resolver.test/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://xhslink.cn/o/abc' }),
    }), { RESOLVER_TOKEN: 'secret' });
    assert.equal(response.status, 401);
});
