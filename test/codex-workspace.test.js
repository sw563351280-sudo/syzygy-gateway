'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCodexWorkspace, workspaceRouter, DEFAULT_PROMPT } = require('../codex-workspace');
const { keepRequestedReadTools } = require('../tool-policy');
function fixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'syzygy-work-records-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    return { directory, store: createCodexWorkspace(directory) };
}
function task(turnId = 'turn-1', summary = '修好了消息去重') {
    return { id: 'task-1', turnId, replySnapshot: { text: '完成。<work_record>' + JSON.stringify({ title: '修复工作区', summary, verification: '通过单元测试，未验证线上', remaining: '等待线上验收' }) + '</work_record>' } };
}
test('settings persist, allow clearing and reject oversized or non-text prompts', t => {
    const { store, directory } = fixture(t);
    assert.equal(store.settings().prompt, DEFAULT_PROMPT);
    store.saveSettings({ prompt: '  温柔但独立  ' });
    assert.equal(createCodexWorkspace(directory).settings().prompt, '温柔但独立');
    assert.match(store.instructions(), /温柔但独立/);
    assert.match(store.instructions(), /工作记录协议/);
    assert.throws(() => store.saveSettings({ prompt: 'x'.repeat(6001) }));
    assert.throws(() => store.saveSettings({ prompt: {} }));
    store.saveSettings({ prompt: '' });
    assert.equal(store.settings().prompt, '');
});
test('model settings survive restart, migrate old settings and reject invalid updates', t => {
    const { store, directory } = fixture(t);
    fs.writeFileSync(path.join(directory, 'codex-settings.json'), JSON.stringify({ prompt: '旧设定' }));
    assert.equal(store.settings().model, '');
    assert.equal(store.settings().effort, 'high');
    store.saveSettings({ prompt: '旧设定', model: 'custom-model', effort: 'low' });
    const restored = createCodexWorkspace(directory);
    assert.equal(restored.settings().model, 'custom-model');
    assert.equal(restored.settings().effort, 'low');
    restored.saveSettings({ prompt: '仅改提示词' });
    assert.equal(restored.settings().model, 'custom-model');
    assert.throws(() => restored.saveSettings({ prompt: '', model: '--bad model', effort: 'low' }));
    assert.throws(() => restored.saveSettings({ prompt: '', model: '', effort: 'bogus' }));
    assert.equal(restored.settings().effort, 'low');
});
test('saved prompt survives missing primary file and stale pages cannot overwrite it', t => {
    const { store, directory } = fixture(t);
    const saved = store.saveSettings({ prompt: '不要丢失', expectedUpdatedAt: null });
    assert.throws(() => store.saveSettings({ prompt: '旧页面', expectedUpdatedAt: null }), /其他页面更新/);
    fs.unlinkSync(path.join(directory, 'codex-settings.json'));
    assert.equal(createCodexWorkspace(directory).settings().prompt, '不要丢失');
    assert.equal(store.settings().updatedAt, saved.updatedAt);
});

test('records survive restart, deduplicate by turn and preserve failed status', t => {
    const { store, directory } = fixture(t);
    const record = store.capture(task(), 'completed');
    store.capture(task(), 'completed');
    store.capture(task('turn-2'), 'failed');
    const restored = createCodexWorkspace(directory);
    assert.equal(restored.query().total, 2);
    assert.equal(restored.query().records[0].status, 'failed');
    assert.equal(record.author, 'codex');
    assert.match(record.createdAt, /^\d{4}-/);
    assert.equal(restored.query({ date: record.date, q: '消息去重' }).total, 2);
    assert.equal(restored.query({ limit: 1, offset: 1 }).records[0].turnId, 'turn-1');
    assert.match(restored.describe({}), /Codex 自报/);
});
test('casual chat writes nothing; malformed records fail visibly without overwriting history', t => {
    const { store } = fixture(t);
    assert.equal(store.capture({ replySnapshot: { text: '晚上好' } }, 'completed'), null);
    store.capture(task(), 'completed');
    assert.throws(() => store.capture({ ...task('2'), replySnapshot: { text: '<work_record>{"title":"不完整"}' } }, 'completed'), /不完整/);
    assert.throws(() => store.capture({ ...task('2'), replySnapshot: { text: '<work_record>invalid</work_record>' } }, 'completed'), /JSON/);
    assert.equal(store.query().total, 1);
});
test('corrupt storage is never treated as empty and overwritten', t => {
    const { store, directory } = fixture(t);
    fs.writeFileSync(path.join(directory, 'codex-work-records.json'), '{broken');
    assert.throws(() => store.capture(task(), 'completed'));
    assert.equal(fs.readFileSync(path.join(directory, 'codex-work-records.json'), 'utf8'), '{broken');
});
test('real tool work without a structured summary is archived with explicit uncertainty', t => {
    const { store } = fixture(t);
    const row = store.capture({ id: 'task', turnId: 'turn', didWork: true, replySnapshot: { text: '修改完成，尚未测试。' } }, 'completed');
    assert.match(row.title, /自动归档/);
    assert.equal(row.summary, '修改完成，尚未测试。');
    assert.match(row.verification, /未提供/);
});
test('Shenwang can access the read-only query tool on explicit requests', () => {
    const tools = [{ function: { name: 'query_work_records' } }, { function: { name: 'exec' } }];
    for (const text of ['查一下工作记录', 'Codex 做了什么', '看看开发进度', '看看记录']) assert.equal(keepRequestedReadTools(tools, text)[0].function.name, 'query_work_records');
    assert.equal(keepRequestedReadTools(tools, '晚上好').length, 0);
});
test('settings and records routes support authenticated reads and updates', async t => {
    const { store } = fixture(t);
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => req.headers.authorization === 'test' ? next() : res.sendStatus(401));
    app.use('/api/codex', workspaceRouter(store));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const url = 'http://127.0.0.1:' + server.address().port + '/api/codex';
    assert.equal((await fetch(url + '/settings')).status, 401);
    const response = await fetch(url + '/settings', { method: 'PUT', headers: { authorization: 'test', 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: '自己的设定' }) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).settings.prompt, '自己的设定');
    store.capture(task(), 'completed');
    const records = await fetch(url + '/work-records', { headers: { authorization: 'test' } });
    assert.equal(records.headers.get('cache-control'), 'no-store');
    assert.equal((await records.json()).total, 1);
});
