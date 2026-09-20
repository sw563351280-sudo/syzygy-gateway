'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { createMusic, sessionView } = require('../music');
const { createStore } = require('../music-store');
const { createProvider, playlistId, validateMedia } = require('../music-provider');
const { createRoom, inviteFrom } = require('../music-room');
const { requestedBuiltinToolNames, keepRequestedReadTools } = require('../tool-policy');

const selected = id => ({ id: String(id), name: `Song ${id}`, artist: `Artist ${Math.floor(Number(id) / 3)}`, provider: 'netease', album: 'Album', duration: 180000 });
function fakeProvider(overrides = {}) {
    return { status: () => ({ configured: true, userLoggedIn: true, companionLoggedIn: true }),
        search: async () => [selected(1), selected(2)], detail: async id => selected(id), audio: async () => 'https://m1.music.126.net/audio.mp3',
        playlist: async id => ({ id: String(id), name: '测试歌单', ownerId: '7', tracks: [selected(1), selected(2)] }),
        check(value) { assert.equal(value.code ?? value.data?.code, 200); return value; },
        api: async () => ({ code: 200 }), setCookie() {}, ...overrides };
}
function fixture(t, provider = fakeProvider(), ranker) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'syzygy-music-test-'));
    const music = createMusic({ directory, secret: 'test-secret-for-music-123456789012345', provider, ranker });
    t.after(() => { music.dispose(); fs.rmSync(directory, { recursive: true, force: true }); });
    return { music, directory };
}
async function httpFixture(t, provider) {
    const { music, directory } = fixture(t, provider);
    const app = express(); app.use(express.json());
    app.use('/api/music', (req, res, next) => req.headers.authorization === 'test' ? next() : res.sendStatus(401), music.router);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
    const base = `http://127.0.0.1:${server.address().port}/api/music`;
    const csrf = music.status().csrfToken;
    const call = (endpoint, body, method = 'POST', headers = {}) => fetch(base + endpoint, {
        method: body === undefined ? 'GET' : method,
        headers: { Authorization: 'test', 'Content-Type': 'application/json', 'X-Music-CSRF': csrf, ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { music, directory, call, base };
}

test('music API is authenticated; writes need token and inputs are validated', async t => {
    const { call, base } = await httpFixture(t);
    assert.equal((await fetch(base + '/status')).status, 401);
    assert.equal((await call('/mode', { mode: 'local' }, 'POST', { 'X-Music-CSRF': '' })).status, 403);
    assert.equal((await call('/mode', { mode: 'invalid' })).status, 400);
    assert.equal((await call('/mode', { mode: 'netease-room', partnerUid: 'bad' })).status, 400);
    assert.equal((await call('/session/event', { owner: 'xx', type: 'play' })).status, 400);
});

test('prepared card never becomes playback and ambiguous results require choice', async t => {
    const { music } = fixture(t);
    const choice = await music.prepare('some song', 'call-1');
    assert.equal(choice.status, 'needs_choice');
    assert.equal(choice.call_id, 'call-1');
    assert.equal(music.status().session.active, false);
    assert.equal(music.store.read().events.length, 0);
    const one = fixture(t, fakeProvider({ search: async () => [selected(5)] })).music;
    const card = await one.prepare('five', 'call-5');
    assert.equal(card.status, 'ready');
    assert.equal(card.song.id, card.attachment.song_id);
    assert.equal(one.status().session.state, 'closed');
});

test('failed candidate validation returns visible error, never a fake playable result', async t => {
    const { music } = fixture(t, fakeProvider({ audio: async () => { throw new Error('unavailable'); } }));
    const result = await music.prepare('song');
    assert.equal(result.status, 'error');
    assert.equal(result.error.code, 'NO_PLAYABLE_RESULTS');
});

test('ownership, lease, close and mode isolate the single playback authority', async t => {
    const { music } = fixture(t);
    const a = await music.localEvent({ type: 'claim', owner: 'client-a-123', songId: '1' });
    assert.equal(a.active, false);
    await music.localEvent({ type: 'play', owner: 'client-a-123', epoch: a.epoch });
    assert.equal(music.status().session.active, true);
    assert.equal(sessionView({ ...music.status().session, updatedAt: Date.now() - 50000 }).state, 'stale');
    const b = await music.localEvent({ type: 'claim', owner: 'client-b-123', songId: '2' });
    await assert.rejects(music.localEvent({ type: 'pause', owner: 'client-a-123', epoch: a.epoch }), { code: 'OWNER_CONFLICT' });
    await music.localEvent({ type: 'play', owner: 'client-b-123', epoch: b.epoch });
    await music.localEvent({ type: 'close', owner: 'client-b-123', epoch: b.epoch });
    assert.equal(music.status().session.active, false);
    assert.match(music.context(), /"state":"closed"/);
    await music.switchMode('netease-room', '7');
    await assert.rejects(music.localEvent({ type: 'claim', owner: 'client-a-123', songId: '1' }), { code: 'MODE_CONFLICT' });
});

test('mode switch during pending song detail cannot restore an old local player', async t => {
    let resolve;
    const { music } = fixture(t, fakeProvider({ detail: () => new Promise(r => { resolve = r; }) }));
    const pending = music.localEvent({ type: 'claim', owner: 'client-a-123', songId: '1' });
    await music.switchMode('netease-room', '7');
    resolve(selected(1));
    await assert.rejects(pending, { code: 'MODE_CONFLICT' });
    assert.equal(music.status().session.mode, 'netease-room');
});

test('restart restores historical song without reviving playback', async t => {
    const { music, directory } = fixture(t);
    const a = await music.localEvent({ type: 'claim', owner: 'client-a-123', songId: '1' });
    await music.localEvent({ type: 'play', owner: 'client-a-123', epoch: a.epoch });
    music.dispose();
    const restarted = createMusic({ directory, secret: 'test', provider: fakeProvider() });
    t.after(() => restarted.dispose());
    assert.equal(restarted.status().session.active, false);
    assert.equal(restarted.status().session.state, 'stale');
    assert.equal(restarted.status().session.song.id, '1');
});

test('short remote playlists merge instead of deleting local songs', async t => {
    let calls = 0;
    const { call, music } = await httpFixture(t, fakeProvider({ playlist: async () => ({ id: '7', name: 'My list', tracks: ++calls === 1 ? [selected(1), selected(2)] : [selected(1)] }) }));
    assert.equal((await call('/playlists/import', { value: '7' })).status, 200);
    assert.equal((await call('/playlists/import', { value: '7' })).status, 200);
    assert.equal(music.store.read().playlists['7'].tracks.length, 2);
});

test('corrupt library and contested transaction do not overwrite original data', t => {
    const { directory } = fixture(t);
    const store = createStore(directory);
    fs.writeFileSync(path.join(directory, 'library.json'), '{broken');
    assert.throws(() => store.mutate(data => { data.session.state = 'play'; }), { code: 'LIBRARY_INVALID' });
    assert.equal(fs.readFileSync(path.join(directory, 'library.json'), 'utf8'), '{broken');
    fs.writeFileSync(path.join(directory, 'library.lock'), '');
    assert.throws(() => store.mutate(() => {}), { code: 'LIBRARY_BUSY' });
});

test('playlist parser rejects arbitrary URLs and handles native hash URLs', () => {
    assert.equal(playlistId('https://music.163.com/#/playlist?id=123'), '123');
    assert.equal(playlistId('456'), '456');
    assert.throws(() => playlistId('http://127.0.0.1/playlist?id=1'));
    assert.throws(() => playlistId('https://music.163.com/song?id=1'));
});

test('media validation rejects private DNS results, mixed results, credentials and foreign hosts', async () => {
    const publicLookup = async () => [{ address: '8.8.8.8', family: 4 }];
    const privateLookup = async () => [{ address: '127.0.0.1', family: 4 }];
    const mixed = async () => [{ address: '8.8.8.8', family: 4 }, { address: '::1', family: 6 }];
    await assert.rejects(validateMedia('http://example.com/a', publicLookup), { code: 'BLOCKED_MEDIA' });
    await assert.rejects(validateMedia('http://m1.music.126.net/a', privateLookup), { code: 'BLOCKED_MEDIA' });
    await assert.rejects(validateMedia('https://m1.music.126.net/a', mixed), { code: 'BLOCKED_MEDIA' });
    await assert.rejects(validateMedia('http://user:password@m1.music.126.net/a', publicLookup), { code: 'BLOCKED_MEDIA' });
    const result = await validateMedia('https://m1.music.126.net/a', publicLookup);
    assert.equal(result.address.address, '8.8.8.8');
});

test('credentials are encrypted, sent only in body, and logout persists', async t => {
    const { directory } = fixture(t);
    const secret = 'test-encryption-key';
    let request;
    const provider = createProvider({ directory, secret, base: 'http://127.0.0.1:3001', fetchImpl: async (url, options) => {
        request = { url: String(url), options }; return { ok: true, text: async () => '{"code":200}' };
    } });
    provider.setCookie('companion', 'MUSIC_U=private-secret');
    assert.equal(fs.readFileSync(path.join(directory, 'credentials.enc')).includes('private-secret'), false);
    await provider.api('/listentogether/status', {}, 'companion');
    assert.equal(request.url.includes('private-secret'), false);
    assert.equal(JSON.parse(request.options.body).cookie, 'MUSIC_U=private-secret');
    const firstUrl = request.url;
    await provider.api('/listentogether/status', {}, 'companion');
    assert.notEqual(request.url, firstUrl, 'each POST must bypass upstream URL-only cache');
    assert.equal(new URL(request.url).pathname, '/listentogether/status');
    provider.setCookie('companion', '');
    const reopened = createProvider({ directory, secret });
    assert.equal(reopened.status().companionLoggedIn, false);
});

test('QR login never exposes upstream key or cookies, and logout clears only selected profile', async t => {
    const saved = [];
    const { call } = await httpFixture(t, fakeProvider({
        api: async route => {
            if (route === '/login/qr/key') return { code: 200, data: { unikey: 'private-upstream-key' } };
            if (route === '/login/qr/create') return { code: 200, data: { qrimg: 'data:image/png;base64,AAAA' } };
            if (route === '/login/qr/check') return { code: 803, cookie: 'MUSIC_U=private-cookie' };
            return { code: 200 };
        }, setCookie: (profile, cookie) => saved.push([profile, cookie]),
    }));
    const started = await (await call('/login/start', { profile: 'user' })).json();
    assert.equal(JSON.stringify(started).includes('private-upstream-key'), false);
    const checked = await (await call('/login/check', { token: started.token })).json();
    assert.deepEqual(checked, { status: 'success' });
    assert.deepEqual(saved[0], ['user', 'MUSIC_U=private-cookie']);
    await call('/login/logout', { profile: 'user' });
    assert.deepEqual(saved[1], ['user', '']);
});

test('room invitation parsing tolerates malformed cards and checks age and inviter', () => {
    const card = (url, time = Date.now()) => ({ time, msg: JSON.stringify({ generalMsg: { nativeUrl: url } }) });
    const url = 'orpheus://listenTogether?roomId=room-1&inviterId=7';
    assert.deepEqual(inviteFrom([card('listenTogether%zz'), card(encodeURIComponent(encodeURIComponent(url)))], '7'), { roomId: 'room-1', inviterId: '7' });
    assert.equal(inviteFrom([card(url, Date.now() - 600000)], '7'), null);
    assert.equal(inviteFrom([card(url)], '8'), null);
});

test('room records fast changes, pause, transient failure and confirmed termination', async t => {
    let session = { mode: 'netease-room', state: 'waiting', song: null };
    let sid = 1;
    let playStatus = 'PLAY';
    let hb = 200;
    const events = [];
    const provider = fakeProvider({ api: async route => {
        if (route === '/msg/private/history') return { code: 200, msgs: [{ time: Date.now(), msg: { generalMsg: { nativeUrl: 'orpheus://listenTogether?roomId=r1&inviterId=7' } } }] };
        if (route === '/listentogether/accept') return { code: 200 };
        if (route === '/listentogether/sync/playlist/get') return { code: 200, data: { playCommand: { targetSongId: sid, playStatus } } };
        return { code: hb };
    } });
    const room = createRoom({ provider, getSession: () => session, update(s, type) { session = s; if (type) events.push(type); } });
    t.after(() => room.dispose());
    room.start('7');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(session.song.id, '1');
    sid = 2; await room.poll();
    assert.equal(session.song.id, '2');
    assert.equal(events.filter(e => e === 'play').length, 2);
    playStatus = 'PAUSE'; await room.poll(); assert.equal(session.state, 'pause');
    hb = 500; await room.poll(); assert.equal(session.state, 'disconnected'); assert.equal(session.mode, 'netease-room');
    hb = 488; await room.poll(); assert.equal(session.mode, 'local'); assert.equal(session.state, 'closed');
});

test('room stop calls remote end; failure remains visible and retryable', async t => {
    let session = { mode: 'netease-room', state: 'play', roomId: 'r1' };
    let code = 500;
    const calls = [];
    const room = createRoom({ provider: fakeProvider({ api: async (route, args) => { calls.push([route, args]); return { code }; } }), getSession: () => session, update: s => { session = s; } });
    t.after(() => room.dispose());
    await assert.rejects(room.stop(), { code: 'LEAVE_FAILED' });
    code = 200; await room.stop();
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], ['/listentogether/end', { roomId: 'r1' }]);
});

test('daily discovery validates, excludes known songs, clamps artists and rejects invented ranking IDs', async t => {
    let searches = 0;
    const { music } = fixture(t, fakeProvider({ search: async () => { searches++; return Array.from({ length: 12 }, (_, i) => selected(i + 1)); },
        audio: async sid => { if (sid === '2') throw new Error('no audio'); return 'url'; } }), async () => [{ id: '999', reason: 'invented' }, { id: '3', reason: 'valid', tag: '私心' }]);
    music.store.mutate(data => { data.playlists['known'] = { name: '夜晚', tracks: [selected(1)] }; });
    const first = await music.daily();
    assert.ok(first.songs.length);
    assert.equal(first.songs.some(s => ['1', '2', '999'].includes(s.id)), false);
    const counts = new Map();
    for (const s of first.songs) counts.set(s.artist, (counts.get(s.artist) || 0) + 1);
    assert.ok([...counts.values()].every(n => n <= 2));
    const count = searches;
    await music.daily(); assert.equal(searches, count);
    const fallback = await music.daily(true);
    assert.ok(fallback.songs.length);
});

test('music tools remain available for spontaneous gifts and short follow-ups', () => {
    assert.ok(requestedBuiltinToolNames('陪我听首歌，推荐一首').has('music_search_and_play'));
    const tools = ['music_search_and_play', 'music_current_session'].map(name => ({ function: { name } }));
    assert.equal(keepRequestedReadTools(tools, '一起听歌').length, 2);
    for (const text of ['晚上好', '好', '你选', '今天有点累', '']) {
        assert.equal(keepRequestedReadTools(tools, text).length, 2);
    }
    assert.deepEqual(keepRequestedReadTools([], '好'), [], 'disabled tools are not reintroduced');
});

test('actual gateway tool selection offers music without keyword gates or duplicates', () => {
    const vm = require('node:vm');
    const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const start = source.indexOf('const ALWAYS_AVAILABLE_TOOLS =');
    const end = source.indexOf('// MCP Server 配置', start);
    assert.ok(start >= 0 && end > start);
    const names = require('../music').TOOL_NAMES;
    const select = vm.runInNewContext(source.slice(start, end) + '\nfilterRelevantTools;', {
        ...require('../tool-policy'), LIGHT_TOOLS: [], MUSIC_TOOL_NAMES: names,
        TOOLS_ENABLED: {}, console: { log() {} },
    });
    const available = names.map(name => ({ function: { name } }));
    for (const phrase of ['好', '你选', '今天下雨了', '一起听歌']) {
        for (const forced of [null, { type: 'function', function: { name: 'fetch_txt' } }]) {
            assert.deepEqual(Array.from(select(available, phrase, forced), t => t.function.name), names);
        }
    }
    assert.equal(select([], '好', null).length, 0);
});
