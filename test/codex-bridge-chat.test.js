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
