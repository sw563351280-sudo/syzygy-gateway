'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCacheHistoryWindow } = require('../cache-history-window');
const { prepareCachedRequest } = require('../provider-cache');
const full = () => Array.from({ length: 100 }, (_, i) => ({ _id: 'id' + i, role: i % 2 ? 'assistant' : 'user', content: 'original ' + i }));
const wire = messages => messages.map(({ role, content }) => ({ role, content }));
test('old client sliding 30-message history reuses exact wire prefix for five turns and stays bounded', () => {
    const tracker = createCacheHistoryWindow(), saved = full(), lengths = [];
    let first;
    for (let end = 40; end <= 52; end += 2) {
        const result = tracker.project(['chat', 'provider', 'model', 'credential'], wire(saved.slice(end - 30, end)), saved);
        lengths.push(result.messages.length);
        const body = prepareCachedRequest('https://api.treegpt.cc/v1/chat/completions', {
            model: 'claude-opus-5-5', messages: [{ role: 'system', content: 'fixed' }, ...result.messages, { role: 'user', content: 'runtime ' + end }],
        }, { historyEnd: result.messages.length });
        const stable = value => JSON.stringify(value.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : m.content.map(b => b.text).join('') })));
        if (!first) first = stable(body.messages.slice(0, 31));
        if (end <= 48) assert.equal(stable(body.messages.slice(0, 31)), first);
    }
    assert.deepEqual(lengths, [30, 32, 34, 36, 38, 30, 32]);
});
test('deleted, edited, reordered or switched-version history is never resurrected', () => {
    for (const change of [
        list => list.filter(m => m._id !== 'id10'),
        list => list.map(m => m._id === 'id10' ? { ...m, content: 'edited' } : m),
        list => { [list[10], list[11]] = [list[11], list[10]]; return list; },
        list => list.map(m => m._id === 'id10' ? { ...m, versions: [{ content: m.content }, { content: 'new version' }], activeVersion: 1 } : m),
    ]) {
        const tracker = createCacheHistoryWindow(), saved = full();
        tracker.project('scope', wire(saved.slice(10, 40)), saved);
        const result = tracker.project('scope', wire(saved.slice(12, 42)), change(saved));
        assert.equal(result.retained, 0);
        assert.equal(result.messages[0].content, 'original 12');
    }
});
test('stale storage, images, ambiguous matches, expiry and credential changes do not borrow history', () => {
    let time = 0;
    const saved = full(), tracker = createCacheHistoryWindow({ now: () => time, ttlMs: 100 });
    tracker.project(['a', 'key1'], wire(saved.slice(10, 40)), saved);
    assert.equal(tracker.project(['a', 'key2'], wire(saved.slice(12, 42)), saved).retained, 0);
    time = 101;
    assert.equal(tracker.project(['a', 'key1'], wire(saved.slice(12, 42)), saved).retained, 0);
    assert.equal(tracker.project('x', wire(saved.slice(12, 42)), saved.slice(0, 40)).state, 'unverified');
    assert.equal(tracker.project('x', wire(saved.slice(12, 42)), [...saved, ...saved]).state, 'unverified');
    const images = wire(saved.slice(12, 42)); images[0].content = [{ type: 'image_url', image_url: { url: 'fake' } }];
    assert.equal(tracker.project('x', images, saved).state, 'unverified');
});
test('timestamped old browser history matches saved active versions without changing wire text', () => {
    const saved = full().map(m => ({ ...m, versions: [{ content: m.content, fullTime: '2026-10-09' }], activeVersion: 0 }));
    const incoming = list => wire(list).map(m => ({ ...m, content: '[10-09 12:00] ' + m.content }));
    const tracker = createCacheHistoryWindow();
    tracker.project('scope', incoming(saved.slice(10, 40)), saved);
    const result = tracker.project('scope', incoming(saved.slice(12, 42)), saved);
    assert.equal(result.retained, 2);
    assert.equal(result.messages[0].content, '[10-09 12:00] original 10');
});
