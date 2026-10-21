'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createResearchDispatch, prepareResearchWorkspace } = require('../research-dispatch');

function temporary(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'syzygy-research-test-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    return directory;
}

async function wait(check) {
    for (let index = 0; index < 120; index++) {
        const value = check();
        if (value) return value;
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('research fixture did not reach expected state');
}

function fixture(t, overrides = {}) {
    const directory = temporary(t);
    const workers = [];
    const results = [];
    const queue = createResearchDispatch({
        directory,
        source: path.join(directory, 'source'),
        root: path.join(directory, 'research-root'),
        now: () => new Date('2026-10-21T12:00:00Z'),
        prepareWorkspace: async job => ({ cwd: path.join(directory, 'workspaces', job.id), codexHome: path.join(directory, 'auth') }),
        createWorker: options => ({
            startTask(input) {
                workers.push({ options, input });
                return { id: `worker-${workers.length}` };
            },
        }),
        onResult: async job => results.push(job),
        ...overrides,
    });
    t.after(() => queue.stop());
    return { directory, queue, workers, results };
}

test('quick research waits for a compact card and enables live web search without production context', async t => {
    const { queue, workers } = fixture(t);
    const pending = queue.submit({
        title: '营业时间',
        question: '柏林某博物馆今天几点关门？',
        purpose: '安排今天行程',
        delivery: 'now',
    }, { sessionId: 'main' });
    const worker = await wait(() => workers[0]);
    assert.equal(worker.options.isolated, true);
    assert.equal(worker.options.serviceName, 'syzygy-research');
    assert.match(worker.options.developerInstructions, /只准使用内置网页搜索/);
    assert.deepEqual(worker.options.threadConfig, {
        web_search: 'live', tools: { web_search: { context_size: 'low' } },
    });
    assert.equal(worker.input.mode, 'readOnly');
    assert.equal(worker.input.effort, 'low');
    assert.match(worker.input.prompt, /公开检索问题：柏林某博物馆/);
    assert.doesNotMatch(worker.input.prompt, /聊天记录|日记正文/);
    worker.options.onTurnComplete({ replySnapshot: { text: '【结论】18:00\n【来源】https://example.test' } }, 'completed');
    const result = await pending;
    assert.equal(result.job.status, 'completed');
    assert.match(result.job.report, /18:00/);
    assert.equal(queue.context('main'), '', 'quick cards do not linger in the asynchronous pocket');
});

test('deep research is nonblocking, stays quiet by default, and can be opened from the originating pocket', async t => {
    const { queue, workers, results } = fixture(t);
    const submitted = await queue.submit({
        title: '医院口碑',
        question: '对比两家医院公开口碑中的重复问题',
        delivery: 'pocket',
    }, { sessionId: 'main' });
    assert.equal(submitted.job.status, 'queued');
    assert.equal(submitted.job.notifyWhenReady, false);
    const worker = await wait(() => workers[0]);
    assert.equal(worker.options.threadConfig.tools.web_search.context_size, 'medium');
    assert.match(queue.context('main'), /医院口碑/);
    assert.doesNotMatch(queue.context('other'), /医院口碑/);

    worker.options.onTurnComplete({ replySnapshot: { text: '【结论】样本有限\n【来源】https://example.test/post' } }, 'completed');
    await wait(() => results.length === 1);
    assert.equal(results[0].notifyWhenReady, false);
    assert.match(queue.context('main'), /"unread":true/);
    const card = queue.read({}, { sessionId: 'main' });
    assert.equal(card.title, '医院口碑');
    assert.match(card.card, /样本有限/);
    assert.equal(queue.context('main'), '', 'opened cards stop consuming future chat context');
    assert.throws(() => queue.read({ id: card.id }, { sessionId: 'other' }), /没有找到/);
});

test('only pocket jobs preserve an explicit notify request and duplicate questions do not spend another slot', async t => {
    const { queue, workers } = fixture(t);
    const first = await queue.submit({
        title: '商品避雷', question: '核对这款商品的公开召回记录', delivery: 'pocket', notify_when_ready: true,
    }, { sessionId: 'main' });
    const duplicate = await queue.submit({
        title: '换个标题', question: '核对这款商品的公开召回记录', delivery: 'pocket', notify_when_ready: true,
    }, { sessionId: 'main' });
    assert.equal(first.job.notifyWhenReady, true);
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.job.id, first.job.id);
    const worker = await wait(() => workers[0]);
    worker.options.onTurnComplete({ replySnapshot: { text: '<work_record>{"bad":true}</work_record>【结论】有一条召回' } }, 'completed');
    await wait(() => queue.list()[0].status === 'completed');
    assert.doesNotMatch(queue.list()[0].report, /work_record/);
    assert.equal(queue.isOpened(first.job.id), false);
    assert.equal(queue.markOpened(first.job.id), true);
    assert.equal(queue.isOpened(first.job.id), true);
    assert.equal(queue.context('main'), '');
});

test('validation bounds the public question and restart preserves evidence while interrupting active work', async t => {
    const base = fixture(t);
    await assert.rejects(base.queue.submit({ title: '太长', question: 'x'.repeat(1601), delivery: 'pocket' }, { sessionId: 'main' }), /最多 1600/);
    await base.queue.submit({ title: '重启测试', question: '查公开信息', delivery: 'pocket' }, { sessionId: 'main' });
    await wait(() => base.workers.length === 1);
    base.queue.stop();

    const resumed = createResearchDispatch({
        directory: base.directory,
        source: path.join(base.directory, 'source'),
        root: path.join(base.directory, 'research-root'),
        enabled: false,
        createWorker: () => { throw new Error('should not run'); },
    });
    t.after(() => resumed.stop());
    assert.equal(resumed.list()[0].status, 'interrupted');
    assert.match(resumed.list()[0].error, /服务器重启/);
});

test('real research workspace contains only an empty task directory and copied Codex auth', async t => {
    const directory = temporary(t);
    const source = path.join(directory, 'source');
    const root = path.join(directory, 'research-root');
    const authHome = path.join(directory, 'auth-home');
    fs.mkdirSync(source);
    fs.mkdirSync(authHome);
    fs.writeFileSync(path.join(source, 'private-chat.json'), 'must not be copied');
    fs.writeFileSync(path.join(authHome, 'auth.json'), '{"fixture":true}');
    const workspace = await prepareResearchWorkspace({ id: 'job-one' }, { source, root, authHome });
    assert.deepEqual(fs.readdirSync(workspace.cwd), []);
    assert.equal(fs.existsSync(path.join(workspace.cwd, 'private-chat.json')), false);
    assert.equal(fs.readFileSync(path.join(workspace.codexHome, 'auth.json'), 'utf8'), '{"fixture":true}');
    assert.equal(fs.existsSync(path.join(source, 'private-chat.json')), true);
});
