'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createWorkroomBriefs, finalWorkRecords, normalizeBaseUrl } = require('../workroom-briefs');
const { createWorkroomTranscriptArchive } = require('../workroom-transcripts');

function message(id, role, content, fullTime, extra = {}) {
    return { _id: id, role, ...extra, versions: [{ content, fullTime }], activeVersion: 0 };
}

function room() {
    return { id: 'syzygy-workroom', type: 'codex-workroom', messages: [
        message('old', 'user', '昨天的共享话题', '2026-10-17T12:00:00.000Z', { workroomTarget: 'all' }),
        message('old-s', 'assistant', '昨天回应', '2026-10-17T12:01:00.000Z', { speaker: 'shenwang' }),
        message('shared', 'user', '今晚一起聊便签', '2026-10-18T16:00:00.000Z', { workroomTarget: 'all' }),
        message('shared-s', 'assistant', '我同意', '2026-10-18T16:01:00.000Z', { speaker: 'shenwang' }),
        message('shared-c', 'assistant', '我来实现', '2026-10-18T16:02:00.000Z', { speaker: 'codex' }),
        message('private', 'user', '这句只给 Codex', '2026-10-18T16:03:00.000Z', { workroomTarget: 'codex' }),
        message('private-c', 'assistant', '只在这里答', '2026-10-18T16:04:00.000Z', { speaker: 'codex' })
    ] };
}

function fixture(t, overrides = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workroom-briefs-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const calls = [];
    const records = [
        { id: 'task:1', taskId: 'task', title: '初稿', status: 'running', createdAt: '2026-10-18T15:00:00Z', summary: '还在做', verification: '未验证', remaining: '继续' },
        { id: 'task:2', taskId: 'task', title: '终稿', status: 'completed', createdAt: '2026-10-18T15:30:00Z', summary: '已经做完', verification: '测试通过', remaining: '无' }
    ];
    const fetchImpl = overrides.fetchImpl || (async (_url, options) => {
        calls.push(JSON.parse(options.body));
        return Response.json({ choices: [{ message: { content: JSON.stringify({ summary: '聊了便签方案', topics: [{ title: '工作区便签', summary: '三人确认实现方式', conclusion: '使用 DeepSeek', pending: '', kind: 'discussion', continue_in_chat: true, turn_ids: ['shared'] }] }) } }] });
    });
    const store = createWorkroomBriefs({ directory, transcriptDirectory: path.join(directory, 'archive'), getWorkRecords: () => records, fetchImpl, clock: () => new Date('2026-10-18T16:05:00.000Z') });
    return { directory, store, calls, records };
}

test('settings keep the API key server-side and validate safe base URLs', t => {
    const { store, directory } = fixture(t);
    const saved = store.saveSettings({ enabled: true, baseUrl: 'https://api.deepseek.com/', apiKey: 'secret-key', model: 'deepseek-chat' });
    assert.equal(saved.apiKeyConfigured, true);
    assert.equal(Object.hasOwn(saved, 'apiKey'), false);
    assert.equal(store.settings().baseUrl, 'https://api.deepseek.com');
    assert.match(fs.readFileSync(path.join(directory, 'workroom-note-settings.json'), 'utf8'), /secret-key/);
    assert.throws(() => normalizeBaseUrl('http://example.com'), /HTTPS/);
});

test('first run starts at the latest available day, excludes Codex-only turns and deduplicates cursors', async t => {
    const { store, calls } = fixture(t);
    store.saveSettings({ enabled: true, apiKey: 'secret-key', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' });
    const context = await store.prepare([room()]);
    assert.match(context, /未读工作区进展简报/);
    assert.match(context, /工作区便签/);
    assert.equal(calls.length, 1);
    const sent = JSON.stringify(calls[0]);
    assert.match(sent, /今晚一起聊便签/);
    assert.doesNotMatch(sent, /昨天的共享话题|这句只给 Codex|只在这里答/);
    const brief = store.list().briefs[0];
    assert.equal(brief.progress.length, 1);
    assert.equal(brief.progress[0].title, '终稿');
    assert.equal(Object.hasOwn(brief.topics[0], 'turnIds'), false);
    const raw = store.query({ segment_id: brief.topics[0].id });
    assert.match(raw, /今晚一起聊便签/);
    assert.doesNotMatch(raw, /这句只给 Codex/);
    assert.equal(await store.prepare([room()]), '');
    assert.equal(calls.length, 1);
});

test('disabled note writer leaves conversation cursor untouched while work progress still arrives', async t => {
    const { store, calls } = fixture(t);
    const context = await store.prepare([room()]);
    assert.match(context, /未读工作区进展简报/);
    assert.doesNotMatch(context, /正在整理/);
    assert.equal(calls.length, 0);
    store.saveSettings({ enabled: true, apiKey: 'secret-key', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' });
    assert.match(await store.prepare([room()]), /工作区便签/);
    assert.equal(calls.length, 1);
});

test('a failed summary remains pending and the same unread range retries later', async t => {
    let attempts = 0;
    const { store } = fixture(t, { fetchImpl: async () => {
        attempts++;
        if (attempts === 1) throw new Error('temporary');
        return Response.json({ choices: [{ message: { content: JSON.stringify({ summary: '重试成功', topics: [{ title: '重试', summary: '完成', turn_ids: ['shared'] }] }) } }] });
    } });
    store.saveSettings({ enabled: true, apiKey: 'secret-key', model: 'deepseek-chat' });
    assert.match(await store.prepare([room()]), /正在整理/);
    assert.equal(store.list().briefs[0].status, 'pending');
    assert.match(await store.prepare([room()]), /重试/);
    assert.equal(store.list().briefs[0].status, 'ready');
    assert.equal(attempts, 2);
});

test('work records collapse multiple updates to the final state while consuming every revision', () => {
    const result = finalWorkRecords([
        { id: 'a', taskId: 'same', createdAt: '2026-01-01', status: 'running' },
        { id: 'b', taskId: 'same', createdAt: '2026-01-02', status: 'completed' },
        { id: 'c', taskId: 'other', createdAt: '2026-01-01', status: 'failed' }
    ], new Set());
    assert.deepEqual(result.records.map(row => row.id), ['c', 'b']);
    assert.deepEqual(result.consumedIds, ['a', 'b', 'c']);
});

test('chat kickoff returns immediately while the external note writer finishes in background', async t => {
    let release;
    const response = new Promise(resolve => { release = resolve; });
    const { store } = fixture(t, { fetchImpl: () => response });
    store.saveSettings({ enabled: true, apiKey: 'secret-key', model: 'deepseek-chat' });
    const immediate = store.start([room()]);
    assert.match(immediate, /未读工作区进展简报/);
    assert.match(immediate, /后台整理/);
    assert.equal(store.list().briefs.length, 0);

    release(Response.json({ choices: [{ message: { content: JSON.stringify({ summary: '已完成', topics: [{ title: '后台便签', summary: '没有阻塞通讯', turn_ids: ['shared'] }] }) } }] }));
    for (let index = 0; index < 20 && store.list().briefs[0]?.status !== 'ready'; index++) {
        await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(store.list().briefs[0]?.status, 'ready');
    const nextContext = store.start([room()]);
    assert.match(nextContext, /后台便签/);
    assert.match(nextContext, /segment_/);
    const background = store.background([room()]);
    assert.match(background, /后台便签/);
    assert.doesNotMatch(background, /今晚一起聊便签|我同意|我来实现/);
});

test('background context reports current shared activity without leaking raw workroom messages', t => {
    const { store } = fixture(t);
    const context = store.background([room()]);
    assert.match(context, /当前工作区共聊状态/);
    assert.match(context, /尚未归入正式便签/);
    assert.doesNotMatch(context, /今晚一起聊便签|我同意|我来实现|这句只给 Codex/);
});

test('date and keyword lookup search the shared archive, not only generated note segments', t => {
    const { store, directory } = fixture(t);
    createWorkroomTranscriptArchive(path.join(directory, 'archive')).archive([room()]);
    const byDate = store.query({ date: '2026-10-18' });
    assert.match(byDate, /今晚一起聊便签/);
    assert.doesNotMatch(byDate, /这句只给 Codex|只在这里答/);
    assert.match(store.query({ keyword: '昨天' }), /昨天的共享话题/);
});
