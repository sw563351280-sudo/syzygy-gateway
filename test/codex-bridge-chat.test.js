const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { createCodexBridge } = require('../codex-bridge');
const TEST_IMAGE = 'data:image/png;base64,AAAA';

function waitFor(check, timeoutMs = 1000) {
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
        const poll = () => {
            const value = check();
            if (value) return resolve(value);
            if (Date.now() - startedAt >= timeoutMs) return reject(new Error('Timed out waiting for state'));
            setTimeout(poll, 5);
        };
        poll();
    });
}

function createFakeChatProcess() {
    const child = new EventEmitter();
    const writes = [];
    let turnNumber = 0;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.killed = false;
    child.writes = writes;
    child.stdin = new Writable({
        write(chunk, _encoding, callback) {
            const message = JSON.parse(chunk.toString().trim());
            writes.push(message);
            if (message.method === 'initialize') {
                setImmediate(() => child.stdout.write(JSON.stringify({ id: 1, result: {} }) + '\n'));
            } else if (message.method === 'thread/start') {
                setImmediate(() => child.stdout.write(JSON.stringify({ id: 2, result: { thread: { id: 'thread-chat' } } }) + '\n'));
            } else if (message.method === 'turn/start') {
                turnNumber += 1;
                const id = message.id;
                setImmediate(() => child.stdout.write(JSON.stringify({ id, result: { turn: { id: `turn-${turnNumber}` } } }) + '\n'));
            }
            callback();
        }
    });
    child.kill = () => {
        if (child.killed) return;
        child.killed = true;
        setImmediate(() => child.emit('close', 0, null));
    };
    return child;
}

test('workroom model and effort reach Codex and later edits do not alter an active task', async () => {
    const child = createFakeChatProcess();
    let settings = { model: 'custom-model', effort: 'low' };
    const bridge = createCodexBridge({ cwd: process.cwd(), spawn: () => child, getTaskSettings: () => settings });
    const started = bridge.startTask({ prompt: '检查', source: 'workroom', model: 'ignored', effort: 'high' });
    try {
        await waitFor(() => child.writes.find(row => row.method === 'turn/start'));
        const turn = child.writes.find(row => row.method === 'turn/start');
        assert.equal(turn.params.model, 'custom-model');
        assert.equal(turn.params.effort, 'low');
        assert.equal(started.model, 'custom-model');
        assert.equal(started.effort, 'low');
        settings = { model: 'next-model', effort: 'high' };
        assert.equal(bridge.taskById(started.id).model, 'custom-model');
        assert.equal(bridge.taskById(started.id).effort, 'low');
    } finally { child.kill(); }
});

test('snapshot preserves long replies and approvals after event log truncation', async () => {
    const child = createFakeChatProcess();
    const bridge = createCodexBridge({ cwd: process.cwd(), spawn: () => child });
    const started = bridge.startTask({ prompt: '检查', mode: 'workspaceWrite' });
    const task = bridge.taskById(started.id);
    try {
        await waitFor(() => task.status === 'running');
        child.stdout.write(JSON.stringify({ id: 0, method: 'item/commandExecution/requestApproval', params: { command: ['git', 'status'] } }) + '\n');
        for (let i = 0; i < 550; i++) child.stdout.write(JSON.stringify({ method: 'item/agentMessage/delta', params: { delta: 'x' } }) + '\n');
        await waitFor(() => task.replySnapshot?.text.length === 550);
        const ws = new EventEmitter();
        ws.readyState = 1;
        const sent = [];
        ws.send = value => sent.push(JSON.parse(value));
        bridge.attachSocket(ws, task.id);
        assert.equal(sent[0].reply.text.length, 550);
        assert.equal(sent[0].reply.turnId, 'turn-1');
        assert.equal(sent[0].approvals[0].params.requestId, 0);
        assert.equal(sent[0].task.canFollowup, true);
        assert.equal(sent[0].events.length, 120);
    } finally { child.kill(); }
});

test('settings refresh each turn and completed work is recorded without browser clients', async () => {
    const child = createFakeChatProcess();
    let instruction = '设定一';
    const captured = [];
    const bridge = createCodexBridge({ cwd: process.cwd(), spawn: () => child,
        getInstructions: () => instruction,
        onTurnComplete: (task, status) => { captured.push({ text: task.replySnapshot.text, status }); return { id: 'record-1', title: '工作记录' }; }
    });
    const started = bridge.startTask({ prompt: '检查' });
    const task = bridge.taskById(started.id);
    try {
        await waitFor(() => task.status === 'running');
        assert.match(child.writes.find(m => m.method === 'turn/start').params.input[0].text, /设定一/);
        child.stdout.write(JSON.stringify({ method: 'item/agentMessage/delta', params: { delta: '检查结果' } }) + '\n');
        child.stdout.write(JSON.stringify({ method: 'turn/completed', params: { turn: { status: 'completed' } } }) + '\n');
        await waitFor(() => captured.length === 1);
        assert.equal(captured[0].text, '检查结果');
        instruction = '设定二';
        bridge.sendClientCommand(task, { type: 'followup', text: '继续' });
        await waitFor(() => task.turnId === 'turn-2');
        assert.match(child.writes.filter(m => m.method === 'turn/start')[1].params.input[0].text, /设定二/);
    } finally { child.kill(); }
});

test('journal write failure is visible and does not change the completed task result', async () => {
    const child = createFakeChatProcess();
    const bridge = createCodexBridge({ cwd: process.cwd(), spawn: () => child, onTurnComplete: () => { throw new Error('disk full'); } });
    const task = bridge.taskById(bridge.startTask({ prompt: '检查' }).id);
    try {
        await waitFor(() => task.status === 'running');
        child.stdout.write(JSON.stringify({ method: 'turn/completed', params: { turn: { status: 'completed' } } }) + '\n');
        await waitFor(() => task.status === 'completed');
        assert.ok(task.events.some(event => event.method === 'codex/work-record-error' && event.params.message === 'disk full'));
    } finally { child.kill(); }
});

test('workroom discussion cannot inherit requested write mode or elevate through approval', async () => {
    const child = createFakeChatProcess();
    const bridge = createCodexBridge({ cwd: process.cwd(), spawn: () => child });
    const started = bridge.startTask({ prompt: '修改这里', source: 'workroom', mode: 'workspaceWrite' });
    const task = bridge.taskById(started.id);
    try {
        await waitFor(() => task.status === 'running');
        assert.equal(started.mode, 'readOnly');
        assert.equal(child.writes.find(m => m.method === 'turn/start').params.sandboxPolicy.type, 'readOnly');
        assert.throws(() => bridge.sendClientCommand(task, { type: 'steer', text: '继续改' }), /独立权限/);
        child.stdout.write(JSON.stringify({ id: 99, method: 'item/commandExecution/requestApproval', params: {} }) + '\n');
        await waitFor(() => task.status === 'failed');
        assert.equal(task.pending.size, 0);
    } finally { child.kill(); }
});

test('explicit workroom execute creates a write-enabled task', async () => {
    const child = createFakeChatProcess();
    const bridge = createCodexBridge({ cwd: process.cwd(), spawn: () => child });
    const task = bridge.startTask({ prompt: '修改这里', source: 'workroom', workroomAction: 'execute' });
    try {
        await waitFor(() => bridge.taskById(task.id).status === 'running');
        assert.equal(task.mode, 'workspaceWrite');
    } finally { child.kill(); }
});

test('completed Codex task stays alive and starts a follow-up turn on the same thread', async () => {
    const child = createFakeChatProcess();
    const bridge = createCodexBridge({ cwd: process.cwd(), spawn: () => child });
    const started = bridge.startTask({ prompt: '先检查这里', mode: 'readOnly', effort: 'medium' });
    const task = bridge.taskById(started.id);

    await waitFor(() => task.status === 'running' && task.turnId === 'turn-1');
    const threadStart = child.writes.find(message => message.method === 'thread/start');
    const firstTurn = child.writes.find(message => message.method === 'turn/start' && message.id === 3);
    assert.equal(threadStart.params.sandbox, 'read-only');
    assert.equal(firstTurn.params.sandboxPolicy.type, 'readOnly');
    child.stdout.write(JSON.stringify({ method: 'turn/completed', params: { turn: { id: 'turn-1', status: 'completed' } } }) + '\n');
    await waitFor(() => task.status === 'completed');
    assert.equal(child.killed, false);

    bridge.sendClientCommand(task, { type: 'followup', text: '继续解释一下', images: [TEST_IMAGE] });
    await waitFor(() => task.status === 'running' && task.turnId === 'turn-2');

    const followup = child.writes.find(message => String(message.id || '').startsWith('followup-'));
    assert.equal(followup.params.threadId, 'thread-chat');
    assert.equal(followup.params.input[0].text, '继续解释一下');
    assert.deepEqual(followup.params.input[1], { type: 'image', url: TEST_IMAGE, detail: 'auto' });
    assert.ok(task.events.some(event => event.method === 'codex/user-message' && event.params.text === '继续解释一下'));

    bridge.sendClientCommand(task, { type: 'steer', text: '再补充一个边界情况' });
    assert.ok(task.events.some(event => event.method === 'codex/user-message' && event.params.steer === true));

    child.stdout.write(JSON.stringify({ method: 'turn/completed', params: { turn: { id: 'turn-2', status: 'completed' } } }) + '\n');
    await waitFor(() => task.status === 'completed');
    child.kill();
});

test('workspace-write mode uses the correct thread wire enum and structured turn policy', async () => {
    const child = createFakeChatProcess();
    const bridge = createCodexBridge({ cwd: process.cwd(), spawn: () => child });
    const started = bridge.startTask({ prompt: '修复这个问题', images: [TEST_IMAGE], mode: 'workspaceWrite', effort: 'high' });
    const task = bridge.taskById(started.id);

    await waitFor(() => task.status === 'running' && task.turnId === 'turn-1');
    const threadStart = child.writes.find(message => message.method === 'thread/start');
    const firstTurn = child.writes.find(message => message.method === 'turn/start' && message.id === 3);
    assert.equal(threadStart.params.sandbox, 'workspace-write');
    assert.equal(threadStart.params.approvalPolicy, 'on-request');
    assert.equal(firstTurn.params.approvalPolicy, 'on-request');
    assert.equal(firstTurn.params.sandboxPolicy.type, 'workspaceWrite');
    assert.deepEqual(firstTurn.params.sandboxPolicy.writableRoots, [process.cwd()]);
    assert.deepEqual(firstTurn.params.input[1], { type: 'image', url: TEST_IMAGE, detail: 'auto' });

    child.kill();
});

test('approval request id zero can be accepted by the client', async () => {
    const child = createFakeChatProcess();
    const bridge = createCodexBridge({ cwd: process.cwd(), spawn: () => child });
    const started = bridge.startTask({ prompt: '提交修改', mode: 'workspaceWrite', effort: 'medium' });
    const task = bridge.taskById(started.id);

    await waitFor(() => task.status === 'running');
    child.stdout.write(JSON.stringify({
        id: 0,
        method: 'item/commandExecution/requestApproval',
        params: { command: ['git', 'commit'], reason: '需要写入 .git' }
    }) + '\n');
    await waitFor(() => task.pending.has('0'));

    bridge.sendClientCommand(task, { type: 'approval', requestId: 0, decision: 'accept' });
    const response = await waitFor(() => child.writes.find(message => message.id === 0 && message.result));
    assert.deepEqual(response.result, { decision: 'accept' });
    assert.equal(task.pending.has('0'), false);
    child.kill();
});

test('permission approvals return the requested grant with the selected scope', async () => {
    const child = createFakeChatProcess();
    const bridge = createCodexBridge({ cwd: process.cwd(), spawn: () => child });
    const started = bridge.startTask({ prompt: '推送修改', mode: 'workspaceWrite', effort: 'medium' });
    const task = bridge.taskById(started.id);
    const permissions = { fileSystem: { write: [process.cwd()] }, network: { enabled: true } };

    await waitFor(() => task.status === 'running');
    child.stdout.write(JSON.stringify({
        id: 7,
        method: 'item/permissions/requestApproval',
        params: { permissions, reason: '需要提交并推送' }
    }) + '\n');
    await waitFor(() => task.pending.has('7'));

    bridge.sendClientCommand(task, { type: 'approval', requestId: 7, decision: 'acceptForSession' });
    const response = await waitFor(() => child.writes.find(message => message.id === 7 && message.result));
    assert.deepEqual(response.result, { permissions, scope: 'session' });
    child.kill();
});

test('Codex image input only accepts bounded image data URLs', () => {
    const bridge = createCodexBridge({ cwd: process.cwd(), spawn: createFakeChatProcess });
    assert.throws(
        () => bridge.startTask({ prompt: '看看这个', images: ['https://example.com/private.png'] }),
        /图片格式无效/
    );
    assert.throws(
        () => bridge.startTask({ prompt: '', images: [] }),
        /输入问题或添加图片/
    );
});
