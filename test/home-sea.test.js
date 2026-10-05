'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { homeSnapshot, createHomeSea } = require('../home-sea');
test('home reads China day, latest note, unfinished tasks and actual listening without inventing schedules', () => {
    const snapshot = homeSnapshot({ now: new Date('2026-10-04T18:00:00Z'),
        pages: [{ date: '2026-9-30', shenwang_note: '旧信' }, { date: '2026-10-4', shenwang_note: '<think>私密思考</think>新信' }],
        todos: [{ id: 'a', done: true }, { id: 'b', owner: 'shen', done: false }],
        diaries: [{ type: 'mood_snapshot', text: '不展示快照', date: '2026-10-5' }, { title: '日记', date: '2026-10-4' }],
        music: { session: { state: 'play', updatedAt: 0, song: { name: '过期播放' } }, events: [{ type: 'play', at: 1, song: { name: '真实历史' } }] } });
    assert.equal(snapshot.date, '2026-10-05'); assert.equal(snapshot.days, 533);
    assert.equal(snapshot.letter.text, '新信'); assert.equal(snapshot.todos.length, 1);
    assert.deepEqual(snapshot.schedules, []); assert.equal(snapshot.diary.date, '2026-10-4');
    assert.equal(snapshot.music.name, '真实历史'); assert.equal(snapshot.music.playing, false);
});
test('missing sources remain absent; visible assistant reply is only a fallback', () => {
    const snapshot = homeSnapshot({ messages: [{ role: 'user', content: '用户' }, { role: 'assistant', content: '回应' }] });
    assert.equal(snapshot.letter.text, '回应'); assert.equal(snapshot.musicAvailable, false); assert.equal(snapshot.diary, null);
    assert.equal(homeSnapshot({}).letter, null);
});
test('signals persist across restart, retry is idempotent, old signals expire, malformed store stays intact', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sea-home-'));
    let now = new Date('2026-10-05T12:00:00Z');
    try {
        const factory = () => createHomeSea({ directory, clock: () => now });
        const home = factory();
        assert.throws(() => home.record('../../bad'), e => e.status === 400);
        const event = home.record('fixture-event-000001');
        assert.deepEqual(factory().record(event.id), event);
        assert.match(factory().context(), /点击了“想他了”/);
        assert.throws(() => home.record('fixture-event-000002'), e => e.status === 429);
        now = new Date(now.getTime() + 86400001); assert.equal(home.context(), '');
        fs.writeFileSync(path.join(directory, 'home_signals.json'), 'broken');
        assert.throws(() => home.record('fixture-event-000003'));
        assert.equal(fs.readFileSync(path.join(directory, 'home_signals.json'), 'utf8'), 'broken');
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
test('summary errors are explicit and writes validate requests', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sea-route-'));
    const app = express(); app.use(express.json()); app.use('/api/home', createHomeSea({ directory, snapshot: () => { throw Error('failed'); } }).router);
    const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
    const url = `http://127.0.0.1:${server.address().port}/api/home`;
    try {
        assert.equal((await fetch(url + '/summary')).status, 503);
        assert.equal((await fetch(url + '/miss-you', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 400);
    } finally { await new Promise(r => server.close(r)); fs.rmSync(directory, { recursive: true, force: true }); }
});
