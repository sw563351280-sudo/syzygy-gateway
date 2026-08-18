const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { createCodexBridge } = require('../codex-bridge');

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
    child.stdout.write(JSON.stringify({ method: 'turn/completed', params: { turn: { id: 'turn-1', status: 'completed' } } }) + '\n');
    await waitFor(() => task.status === 'completed');
    assert.equal(child.killed, false);

    bridge.sendClientCommand(task, { type: 'followup', text: '继续解释一下' });
    await waitFor(() => task.status === 'running' && task.turnId === 'turn-2');

    const followup = child.writes.find(message => String(message.id || '').startsWith('followup-'));
    assert.equal(followup.params.threadId, 'thread-chat');
    assert.equal(followup.params.input[0].text, '继续解释一下');
    assert.ok(task.events.some(event => event.method === 'codex/user-message' && event.params.text === '继续解释一下'));

    bridge.sendClientCommand(task, { type: 'steer', text: '再补充一个边界情况' });
    assert.ok(task.events.some(event => event.method === 'codex/user-message' && event.params.steer === true));

    child.stdout.write(JSON.stringify({ method: 'turn/completed', params: { turn: { id: 'turn-2', status: 'completed' } } }) + '\n');
    await waitFor(() => task.status === 'completed');
    child.kill();
});
