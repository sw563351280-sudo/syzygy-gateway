'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../public/context-continuity');
const { createRollingContext } = require('../rolling-context');
const active = m => m;
const source = (n = 8) => Array.from({ length: n }, (_, i) => ({ _id: 'm' + i,
    role: i % 2 ? 'assistant' : 'user', content: `${i}:` + '资料原文。'.repeat(20), fullTime: '2026-09-24' }));
const wire = messages => messages.map(m => ({ _contextId: m._id, _contextRevision: C.revisionOf(m, active), role: m.role, content: m.content }));
const trim = (messages, prefix) => { const s = { messages: structuredClone(messages), contextPrefix: prefix }; C.trimContextWindow(s, active, 4); return s; };

test('browser module and actual unload saver persist stable IDs and proof without truncating live history', () => {
    const window = {};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/context-continuity.js'), 'utf8'), { window, TextEncoder });
    assert.equal(window.ContextContinuity.digest('中文'), C.digest('中文'));
    const script = fs.readFileSync(path.join(__dirname, '../public/script.js'), 'utf8');
    const start = script.indexOf('function buildSavePayload()');
    const end = script.indexOf("document.addEventListener('visibilitychange'", start);
    const messages = source(204); delete messages[0]._id;
    const state = { ContextContinuity: window.ContextContinuity, chatSessions: [{ messages }],
        _hasDirtyFallbackState: () => false, structuredClone, crypto: { randomUUID: () => 'assigned' },
        getActiveVersion: active, historyWindowsForPayload: () => ({}), suppliers: [], activeSupIndex: 0, activeChatId: 'a', _dataVersion: 1 };
    const payload = JSON.parse(vm.runInNewContext(script.slice(start,end) + '\nbuildSavePayload()', state));
    assert.equal(messages.length, 204);
    assert.equal(messages[0]._id, 'assigned');
    const saved = payload.chatSessions[0];
    assert.equal(saved.messages.length, 200);
    let hash = C.seed;
    for (const m of messages.slice(0,4)) hash = C.nextDigest(hash,m._id,C.revisionOf(m,active));
    assert.deepEqual(saved.contextPrefix, { version: 1, count: 4, hash, firstId: 'm4' });
});

test('an idle hidden page does not write a new cloud version', () => {
    const script = fs.readFileSync(path.join(__dirname, '../public/script.js'), 'utf8');
    const start = script.indexOf("document.addEventListener('visibilitychange', function ()");
    const end = script.indexOf("window.addEventListener('online'", start);
    assert.ok(start >= 0 && end > start, 'unload save listener must be extractable');
    const handlers = {};
    let beacons = 0; let backups = 0; let pending = false;
    const context = {
        document: { hidden: true, addEventListener: (name, handler) => { handlers[name] = handler; } },
        window: { addEventListener: (name, handler) => { handlers[name] = handler; } },
        navigator: { sendBeacon: () => { beacons++; return true; } },
        Blob: class {}, clearTimeout() {}, _saveTimer: null, _savingNow: false,
        saveLocalBackup: () => { backups++; }, buildSavePayload: () => '{}',
        hasUnsavedCloudChanges: () => pending, resyncIfStale() {}
    };
    vm.runInNewContext(script.slice(start, end), context);
    handlers.visibilitychange();
    assert.equal(backups, 1);
    assert.equal(beacons, 0);

    pending = true;
    handlers.visibilitychange();
    assert.equal(beacons, 1);

    context._savingNow = true;
    handlers.visibilitychange();
    assert.equal(beacons, 1, 'do not race an in-flight fetch with a duplicate beacon');
});
function fixture() {
    const states = new Map(), batches = [], events = [];
    const store = { read: k => structuredClone(states.get(k) || null), write: (k, v) => states.set(k, structuredClone(v)) };
    const create = () => createRollingContext({ store, threshold: 400, tailTokens: 100, summaryTokens: 100,
        log: e => events.push(e), summarize: async b => { batches.push(b); return { content: '累计摘要', finishReason: 'stop' }; } });
    return { context: create(), create, states, batches, events };
}

test('synchronous browser SHA256 matches Node for Unicode, padding boundaries and long text', () => {
    for (const s of ['', 'abc', '中文🐟', ...[55,56,63,64,65,127,128,10000].map(n => 'x'.repeat(n))]) {
        assert.equal(C.digest(s), createHash('sha256').update(s).digest('hex'));
    }
});
test('cloud cap proof stays constant size and accumulates exactly across repeated trims', () => {
    const first = trim(source());
    const next = trim([...first.messages, ...source(10).slice(8)], first.contextPrefix);
    const once = trim(source(10));
    assert.deepEqual(next, once);
    assert.equal(next.contextPrefix.count, 6);
    assert.deepEqual(Object.keys(next.contextPrefix), ['version','count','hash','firstId']);
    assert.equal(JSON.stringify(next.contextPrefix).includes('资料'), false);
});
test('missing IDs, empty history and stale proof fail safely; IDs are assigned on original objects', () => {
    const sessions = [{ messages: [{ _id: 'keep' }, {}] }];
    C.ensureMessageIds(sessions, () => 'new');
    assert.deepEqual(sessions[0].messages.map(m => m._id), ['keep','new']);
    const bad = source(); delete bad[0]._id;
    assert.equal(trim(bad).contextPrefix, undefined);
    assert.equal(trim([], trim(source()).contextPrefix).contextPrefix, undefined);
    const stale = trim(source().slice(5), trim(source()).contextPrefix);
    assert.equal(stale.contextPrefix, undefined);
});
test('verified cloud omission reuses identical summary projection across engine restart and later trims', async () => {
    const f = fixture(), all = source();
    const initial = await f.context.project('a', wire(all));
    const cloud = trim(all);
    const restored = await f.create().project('a', wire(cloud.messages), null, cloud.contextPrefix);
    assert.deepEqual(restored, initial);
    assert.equal(f.batches.length, 1);
    assert.equal(f.events.some(e => e.state === 'resumed' && e.restoredCount === 4), true);
    assert.equal(JSON.stringify(restored).includes('_context'), false);
    const appended = [...cloud.messages, ...source(10).slice(8)];
    const fullResult = await f.context.project('a', wire(appended), null, cloud.contextPrefix);
    const next = trim(appended, cloud.contextPrefix);
    assert.deepEqual(await f.context.project('a', wire(next.messages), null, next.contextPrefix), fullResult);
    assert.equal(JSON.stringify(f.events).includes(cloud.contextPrefix.hash), false);
});
for (const kind of ['absent','hash','count','edited omitted','deleted omitted','legacy archive','other scope','duplicate']) {
    test(`unverified ${kind} cannot resurrect omitted history`, async () => {
        const f = fixture(), all = source();
        const archived = wire(all);
        if (kind === 'legacy archive') archived.forEach(m => delete m._contextRevision);
        await f.context.project('a', archived);
        if (kind === 'edited omitted') all[0].content = '纠正内容';
        if (kind === 'deleted omitted') all.splice(0,1);
        const cloud = trim(all);
        let prefix = cloud.contextPrefix;
        if (kind === 'absent') prefix = null;
        if (kind === 'hash') prefix.hash = '0'.repeat(64);
        if (kind === 'count') prefix.count++;
        const input = wire(cloud.messages);
        if (kind === 'duplicate') input[1]._contextId = input[0]._contextId;
        f.events.length = 0;
        const result = await f.context.project(kind === 'other scope' ? 'b' : 'a', input, null, prefix);
        assert.equal(f.events.some(e => e.state === 'resumed'), false);
        assert.equal(JSON.stringify(result).includes('0:资料'), false);
        const latest = f.batches.at(-1);
        if (f.batches.length > 1) assert.equal(latest.previousSummary, '');
    });
}
test('editing retained covered content rebuilds from restored prefix with the correction', async () => {
    const f = fixture(); await f.context.project('a', wire(source()));
    const cloud = trim(source()); cloud.messages[0].content = '纠正后的事实';
    await f.context.project('a', wire(cloud.messages), null, cloud.contextPrefix);
    assert.equal(f.batches[1].previousSummary, '');
    assert.equal(f.batches[1].messages[4].content, '纠正后的事实');
});
test('regeneration never restores future messages or their summary', async () => {
    const f = fixture(); await f.context.project('a', wire(source()));
    const cloud = trim(source());
    await f.context.project('a', wire(cloud.messages.slice(0,1)), null, cloud.contextPrefix);
    assert.equal(f.batches[1].previousSummary, '');
    const current = [...f.states.values()][0];
    assert.equal(current.current.length, 5);
    assert.equal(current.current.some(v => current.revisions[v]._contextId === 'm5'), false);
});
