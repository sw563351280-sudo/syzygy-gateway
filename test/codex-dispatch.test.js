'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { createCodexDispatch, prepareWorkspace, deliverDispatchResult } = require('../codex-dispatch');
const { createCodexBridge } = require('../codex-bridge');
const { createWebConfigStore } = require('../web-config-store');

function temporary(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'syzygy-dispatch-'));
    t.after(() => {
        assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
        assert.ok(path.basename(directory).startsWith('syzygy-dispatch-'));
        fs.rmSync(directory, { recursive: true, force: true });
    });
    return directory;
}
async function wait(check) {
    for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
    throw new Error('Offline worker did not reach expected state');
}
const task = (problem = '保存失败') => ({ title: '检查保存', problem, evidence: '页面返回 500', evidenceKind: 'observed', mode: 'repair' });
function fixture(t, overrides = {}) {
    const directory = temporary(t), workers = [];
    const settings = { directory, source: path.join(directory, 'source'), root: path.join(directory, 'jobs'),
        now: () => new Date('2026-10-13T12:00:00Z'),
        prepareWorkspace: async job => ({ cwd: path.join(directory, 'jobs', job.id), codexHome: path.join(directory, 'auth'), readableRoots: [] }),
        createWorker: options => ({ startTask(input) { workers.push({ options, input }); return { id: 'fake-' + workers.length }; } }),
        ...overrides };
    const queue = createCodexDispatch(settings); t.after(() => queue.stop());
    return { queue, settings, workers, directory };
}
test('dispatch is nonblocking, deduplicates independently of title, downgrades hypotheses, and enforces daily limits', async t => {
    const { queue, workers } = fixture(t, { dailyLimit: 2 });
    const first = queue.enqueue(task(), { sessionId: 'main' });
    assert.equal(first.job.status, 'queued'); assert.equal(workers.length, 0);
    assert.equal(queue.enqueue({ ...task(), title: '改一个标题' }, { sessionId: 'main' }).duplicate, true);
    const second = queue.enqueue({ ...task('可能有竞态'), evidenceKind: 'hypothesis' }, { sessionId: 'main' });
    assert.equal(second.job.mode, 'inspect');
    assert.throws(() => queue.enqueue(task('另一个问题'), { sessionId: 'main' }), /达到 2 单/);
    await wait(() => workers.length === 1);
    assert.equal(workers[0].options.isolated, true);
    assert.equal(workers[0].input.mode, 'workspaceWrite');
    workers[0].options.onTurnComplete({ replySnapshot: { text: '已在副本修复，测试通过' } }, 'completed');
    await wait(() => workers.length === 2);
    assert.equal(workers[1].input.mode, 'readOnly');
    workers[1].options.onTurnComplete({ replySnapshot: { text: '只读检查报告' } }, 'completed');
    await wait(() => queue.list().every(j => j.status === 'completed') && !queue.status().running);
});
test('restart preserves queued work and marks started work interrupted without retrying it', async t => {
    const { queue, settings, workers } = fixture(t);
    const first = queue.enqueue(task(), { sessionId: 'main' });
    queue.enqueue(task('第二个问题'), { sessionId: 'other' });
    await wait(() => workers.length === 1); queue.stop();
    const resumedWorkers = [];
    const resumed = createCodexDispatch({ ...settings, createWorker: o => ({ startTask(i) { resumedWorkers.push({ o, i }); return { id: 'resumed' }; } }) });
    t.after(() => resumed.stop());
    assert.equal(resumed.list('main')[0].id, first.job.id);
    assert.equal(resumed.list('main')[0].status, 'interrupted');
    resumed.start(); await wait(() => resumedWorkers.length === 1);
    assert.match(resumedWorkers[0].i.prompt, /第二个问题/);
});
test('carried-over queued jobs cannot exceed the current Beijing-day execution cap', async t => {
    let time = new Date('2026-10-13T12:00:00Z');
    const { queue, settings, workers } = fixture(t, { dailyLimit: 1, now: () => time });
    queue.stop();
    fs.writeFileSync(path.join(settings.directory, 'codex-dispatch.json'), JSON.stringify(['old-a', 'old-b'].map(id => ({
        ...task(id), id, sessionId: 'main', status: 'queued', createdAt: '2026-10-12T12:00:00Z', deliveredAt: null
    }))));
    const resumed = createCodexDispatch(settings); t.after(() => resumed.stop());
    resumed.start(); await wait(() => workers.length === 1);
    workers[0].options.onTurnComplete({ replySnapshot: { text: '只读检查结束' } }, 'completed');
    await wait(() => !resumed.status().running);
    resumed.start(); assert.equal(workers.length, 1);
    time = new Date('2026-10-14T12:00:00Z');
    resumed.start(); await wait(() => workers.length === 2);
    workers[1].options.onTurnComplete({ replySnapshot: { text: '第二单结束' } }, 'completed');
    await wait(() => !resumed.status().running);
});
test('failed setup produces a durable report and disabled dispatch cannot start a worker', async t => {
    const received = [];
    const { queue } = fixture(t, { prepareWorkspace: async () => { throw new Error('auth cache absent'); }, onResult: async job => received.push(job) });
    queue.enqueue(task(), { sessionId: 'main' }); await wait(() => received.length === 1);
    assert.equal(received[0].status, 'failed'); assert.match(received[0].error, /auth cache absent/);
    assert.ok(queue.list()[0].deliveredAt);
    const disabled = fixture(t, { enabled: false });
    assert.throws(() => disabled.queue.enqueue(task(), { sessionId: 'main' }), /已关闭/);
    disabled.queue.start(); assert.equal(disabled.workers.length, 0);
});
test('read-only chat cannot delegate write access, and corrupt storage disables only dispatch without overwriting evidence', t => {
    const { queue, settings } = fixture(t);
    const job = queue.enqueue(task(), { sessionId: 'discussion', readOnly: true });
    assert.equal(job.job.mode, 'inspect'); queue.stop();
    const file = path.join(settings.directory, 'codex-dispatch.json');
    fs.writeFileSync(file, 'broken json');
    const damaged = createCodexDispatch(settings); t.after(() => damaged.stop());
    assert.equal(damaged.status().enabled, false);
    assert.throws(() => damaged.enqueue(task(), { sessionId: 'main' }), /暂停/);
    assert.equal(fs.readFileSync(file, 'utf8'), 'broken json');
});
test('result delivery is idempotent, stays in the originating chat and never recreates deleted sessions', async t => {
    const directory = temporary(t), file = path.join(directory, 'web_config.json');
    fs.writeFileSync(file, JSON.stringify({ _version: 1, chatSessions: [{ id: 'main', messages: [] }, { id: 'other', messages: [] }] }));
    const store = createWebConfigStore(file);
    const job = { id: 'job1', title: '检查保存', sessionId: 'other', status: 'completed', mode: 'inspect', report: '已定位', finishedAt: '2026-10-13T12:00:00Z' };
    await deliverDispatchResult(store, job); await deliverDispatchResult(store, job);
    const config = await store.readShared();
    assert.equal(config.chatSessions[0].messages.length, 0); assert.equal(config.chatSessions[1].messages.length, 1);
    assert.equal(config.chatSessions[1].messages[0].speaker, 'codex');
    assert.equal(await deliverDispatchResult(store, { ...job, id: 'job2', sessionId: 'deleted' }), null);
});
test('real local Git preparation excludes live uncommitted files and ignored credentials, disables push and keeps auth outside the workspace', async t => {
    const directory = temporary(t), source = path.join(directory, 'source'), root = path.join(directory, 'jobs'), authHome = path.join(directory, 'auth');
    fs.mkdirSync(source); fs.mkdirSync(authHome);
    const git = args => execFileSync('git', args, { cwd: source, stdio: 'pipe' });
    git(['init']); git(['config', 'user.name', 'Offline fixture']); git(['config', 'user.email', 'fixture@example.invalid']);
    fs.writeFileSync(path.join(source, '.gitignore'), '.env\nnode_modules/\n');
    fs.writeFileSync(path.join(source, 'code.js'), 'committed'); git(['add', '.']); git(['commit', '-m', 'fixture']);
    fs.writeFileSync(path.join(source, 'code.js'), 'live uncommitted'); fs.writeFileSync(path.join(source, '.env'), 'fake private config');
    fs.writeFileSync(path.join(authHome, 'auth.json'), '{"fixture":true}');
    const workspace = await prepareWorkspace({ id: 'offline-fixture' }, { source, root, authHome });
    assert.equal(fs.readFileSync(path.join(workspace.cwd, 'code.js'), 'utf8'), 'committed');
    assert.equal(fs.existsSync(path.join(workspace.cwd, '.env')), false);
    assert.equal(fs.existsSync(path.join(workspace.cwd, 'auth.json')), false);
    assert.equal(execFileSync('git', ['remote', 'get-url', '--push', 'origin'], { cwd: workspace.cwd, encoding: 'utf8' }).trim(), 'DISABLED');
    assert.equal(fs.readFileSync(path.join(source, 'code.js'), 'utf8'), 'live uncommitted');
});
test('isolated bridge overrides production workdir, disables inspection networking and declines unattended privilege requests', async t => {
    const directory = temporary(t), writes = [], child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.killed = false;
    child.kill = () => { child.killed = true; };
    child.stdin = new Writable({ write(chunk, _encoding, callback) { writes.push(JSON.parse(chunk.toString())); callback(); } });
    let spawned;
    const original = process.env.CODEX_WORKDIR; process.env.CODEX_WORKDIR = '/opt/syzygy';
    t.after(() => { if (original === undefined) delete process.env.CODEX_WORKDIR; else process.env.CODEX_WORKDIR = original; });
    const bridge = createCodexBridge({ isolated: true, cwd: directory, codexHome: path.join(directory, 'auth'), readableRoots: [directory],
        acquireTurnLease: () => () => {}, spawn: (_bin, _args, options) => { spawned = options; return child; } });
    const started = bridge.startTask({ prompt: 'offline inspect' });
    t.after(() => { child.emit('close', 0); child.stdout.end(); child.stderr.end(); child.stdin.end(); });
    child.stdout.write(JSON.stringify({ id: 1, result: {} }) + '\n');
    child.stdout.write(JSON.stringify({ id: 2, result: { thread: { id: 'fixture-thread' } } }) + '\n');
    await wait(() => writes.some(w => w.method === 'turn/start'));
    assert.equal(spawned.cwd, directory); assert.equal(spawned.env.CODEX_HOME, path.join(directory, 'auth'));
    assert.deepEqual(writes.find(w => w.method === 'turn/start').params.sandboxPolicy, { type: 'readOnly', networkAccess: false });
    child.stdout.write(JSON.stringify({ id: 70, method: 'item/commandExecution/requestApproval', params: {} }) + '\n');
    await wait(() => writes.some(w => w.id === 70));
    assert.equal(writes.find(w => w.id === 70).result.decision, 'decline');
    assert.equal(bridge.taskById(started.id).pending.size, 0);
    child.stdout.write(JSON.stringify({ method: 'turn/completed', params: { turn: { status: 'completed' } } }) + '\n');
    await wait(() => child.killed);
    assert.equal(bridge.taskById(started.id).proc, null, 'background workers must not linger for the manual chat idle timeout');
});
