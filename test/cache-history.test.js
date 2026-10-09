'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { selectCacheHistory, cachedChatHistory } = require('../public/cache-history');
const { prepareCachedRequest } = require('../provider-cache');
const { canUseRollingContext } = require('../public/cache-history');
const messages = n => Array.from({ length: n }, (_, i) => ({ _id: String(i), role: i % 2 ? 'assistant' : 'user', content: 'message ' + i }));

test('real browser send assigns IDs before fallback history anchoring', async () => {
    const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../public/script.js'), 'utf8');
    const begin = source.indexOf('const retainedImages = ChatWindowContext.imageWindow(session.messages, getActiveVersion);');
    const end = source.indexOf('var historyMsgs =', begin);
    const map = new Map();
    const storage = { getItem: k => map.get(k), setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) };
    const session = { id: 'same', messages: messages(101).map(({ _id, ...m }) => m) };
    let id = 0;
    const context = { session, currentSup: { url: '/via/tree/v1/chat/completions' }, selectedModel: 'claude-opus-5-5',
        ChatWindowContext: { imageWindow: () => new Set() }, getActiveVersion: m => m, isWorkroomSession: () => false,
        canUseRollingContext: async () => false, isCacheHistoryRoute: require('../public/cache-history').isCacheHistoryRoute,
        ContextContinuity: require('../public/context-continuity'), crypto: { randomUUID: () => 'id-' + (++id) },
        fetch: () => assert.fail('no model calls'), window: { sessionStorage: storage }, cachedChatHistory };
    const run = () => require('node:vm').runInNewContext(`(async () => { ${source.slice(begin, end)} return cachedChatHistory(session.messages.slice(0, -1), session.id, currentSup.url, selectedModel, historyStorage); })()`, context);
    const first = await run();
    session.messages.push({ role: 'assistant', content: 'reply' }, { role: 'user', content: 'next' });
    const next = await run();
    assert.equal(first.length, 30);
    assert.equal(next.length, 32);
    assert.equal(first[0]._id, next[0]._id);
});

test('free readiness check gates expanded history on configured server support', async () => {
    const route = '/via/aihubmix/v1/chat/completions';
    const model = 'claude-opus-4-6';
    assert.equal(await canUseRollingContext(route, model, async () => ({ ok: true, json: async () => ({ version: 1, rollingSummary: true }) })), true);
    assert.equal(await canUseRollingContext(route, model, async () => ({ ok: false })), false);
    assert.equal(await canUseRollingContext(route, model, async () => { throw Error('offline'); }), false);
    assert.equal(await canUseRollingContext(route, model, async () => ({ ok: true, json: async () => ({ version: 1, rollingSummary: false }) })), false);
    assert.equal(await canUseRollingContext('/via/other/v1', model, () => assert.fail('other routes untouched')), false);
    assert.equal(await canUseRollingContext('/via/tree/v1/chat/completions', 'claude-opus-5-5', async () => ({ ok: true, json: async () => ({ version: 1, rollingSummary: true }) })), false);
    assert.equal(await canUseRollingContext('/via/tree/v1/chat/completions', 'claude-opus-5-5', async () => ({ ok: true, json: async () => ({ version: 1, rollingSummary: true, cacheRoutes: ['tree'] }) })), true);
});

test('history prefix stays identical during append then rotates within a bound', () => {
    const all = messages(210);
    let anchor;
    const starts = [];
    for (let count = 100; count <= 120; count += 2) {
        const result = selectCacheHistory(all.slice(0, count), anchor, 30, 8);
        anchor = result.anchorId;
        starts.push(anchor);
        assert.ok(result.messages.length >= 30 && result.messages.length <= 38);
        assert.equal(result.messages.at(-1), all[count - 1]);
    }
    assert.deepEqual(starts.slice(0, 6), ['70', '70', '70', '70', '70', '80']);
});

test('storage cap, deletion, versions, restart and absent IDs never resurrect old content', () => {
    const all = messages(210);
    const original = selectCacheHistory(all.slice(2, 202));
    assert.equal(selectCacheHistory(all.slice(2, 202), original.anchorId).anchorId, original.anchorId);
    const edited = all.slice(2, 202).map(m => m._id === original.anchorId ? { ...m, content: 'edited' } : m);
    assert.equal(selectCacheHistory(edited, original.anchorId).messages[0].content, 'edited');
    assert.equal(selectCacheHistory(edited.filter(m => m._id !== original.anchorId), original.anchorId).messages.length, 30);
    assert.equal(selectCacheHistory([], original.anchorId).anchorId, null);
    assert.equal(selectCacheHistory(all.slice(0, 10), original.anchorId).messages.length, 10);
    assert.equal(selectCacheHistory(all.map(({ _id, ...m }) => m)).anchorId, null);
});

test('scope is provider/model/session specific; inaccessible storage safely falls back', () => {
    const map = new Map();
    const storage = { getItem: k => map.get(k), setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) };
    const route = '/via/aihubmix/v1/chat/completions', model = 'claude-opus-4-6-think';
    cachedChatHistory(messages(100), 'a', route, model, storage);
    assert.equal(cachedChatHistory(messages(102), 'a', route, model, storage).length, 32);
    assert.equal(cachedChatHistory(messages(102), 'b', route, model, storage).length, 30);
    assert.equal(cachedChatHistory(messages(102), 'a', route, 'claude-sonnet-4-6', storage).length, 30);
    assert.equal(cachedChatHistory(messages(102), 'a', '/via/other/v1', model, storage).length, 30);
    assert.equal(cachedChatHistory(messages(102), 'a', route, model, undefined).length, 30);
    assert.equal([...map.values()].some(v => v.includes('message')), false);
});

test('actual wire cache prefix survives next turn while dynamic suffix changes', () => {
    const all = messages(102);
    const first = selectCacheHistory(all.slice(0, 100));
    const second = selectCacheHistory(all, first.anchorId, 30, 8);
    function wire(history, dynamic) {
        return prepareCachedRequest('https://aihubmix.com/v1/chat/completions', {
            model: 'claude-opus-4-6', messages: [{ role: 'system', content: 'fixed' }, ...history.map(({ role, content }) => ({ role, content })), { role: 'user', content: dynamic }],
        }, { historyEnd: history.length });
    }
    // Cache markers themselves do not contribute text to the model prefix.
    const clean = value => JSON.stringify(value, (key, v) => key === 'cache_control' ? undefined : v);
    const textBlocks = list => list.map(m => ({ ...m, content: typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content }));
    const a = wire(first.messages, 'time1'), b = wire(second.messages, 'time2');
    assert.equal(clean(textBlocks(a.messages.slice(0, -1))), clean(textBlocks(b.messages.slice(0, 31))));
});
