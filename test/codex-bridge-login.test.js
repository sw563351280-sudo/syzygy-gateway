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

function createFakeCodexProcess() {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.killed = false;
    child.stdin = new Writable({
        write(chunk, _encoding, callback) {
            const message = JSON.parse(chunk.toString().trim());
            if (message.method === 'initialize') {
                setImmediate(() => child.stdout.write(JSON.stringify({ id: 1, result: {} }) + '\n'));
            }
            if (message.method === 'account/login/start') {
                setImmediate(() => child.stdout.write(JSON.stringify({
                    id: 2,
                    result: {
                        type: 'chatgptDeviceCode',
                        loginId: 'login-test',
                        verificationUrl: 'https://auth.openai.com/codex/device',
                        userCode: 'ABCD-1234'
                    }
                }) + '\n'));
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

function createFakeAccountProcess(result) {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.killed = false;
    child.stdin = new Writable({
        write(chunk, _encoding, callback) {
            const message = JSON.parse(chunk.toString().trim());
            if (message.method === 'initialize') {
                setImmediate(() => child.stdout.write(JSON.stringify({ id: 1, result: {} }) + '\n'));
            }
            if (message.method === 'account/read') {
                setImmediate(() => child.stdout.write(JSON.stringify({ id: 2, result }) + '\n'));
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

test('device login survives without a browser socket and completes from app-server notification', async () => {
    const child = createFakeCodexProcess();
    const bridge = createCodexBridge({ cwd: process.cwd(), spawn: () => child });

    assert.equal(bridge.startDeviceLogin().status, 'starting');
    const waiting = await waitFor(() => bridge.loginStatus().status === 'waiting' && bridge.loginStatus());
    assert.equal(waiting.userCode, 'ABCD-1234');
    assert.equal(waiting.verificationUrl, 'https://auth.openai.com/codex/device');

    child.stdout.write(JSON.stringify({ method: 'account/updated', params: { authMode: 'chatgpt', planType: 'pro' } }) + '\n');
    child.stdout.write(JSON.stringify({ method: 'account/login/completed', params: { loginId: 'login-test', success: true, error: null } }) + '\n');

    const completed = await waitFor(() => bridge.loginStatus().status === 'completed' && bridge.loginStatus());
    assert.equal(completed.authMode, 'chatgpt');
    assert.equal(completed.planType, 'pro');
});

test('device login can be cancelled and the background process is stopped', async () => {
    const child = createFakeCodexProcess();
    const bridge = createCodexBridge({ cwd: process.cwd(), spawn: () => child });

    bridge.startDeviceLogin();
    await waitFor(() => bridge.loginStatus().status === 'waiting');
    assert.equal(bridge.cancelDeviceLogin().status, 'cancelled');
    await waitFor(() => child.killed);
    assert.equal(child.killed, true);
});

test('account status uses the explicit app-server auth signal', async () => {
    const child = createFakeAccountProcess({
        account: { type: 'chatgpt', email: 'test@example.com', planType: 'pro' },
        requiresOpenaiAuth: false
    });
    const bridge = createCodexBridge({ cwd: process.cwd(), spawn: () => child });

    const status = await bridge.readAccountStatus();
    assert.equal(status.ok, true);
    assert.equal(status.authenticated, true);
    assert.equal(status.requiresOpenaiAuth, false);
    assert.equal(status.account.planType, 'pro');
});

test('account status only requests login when app-server says auth is required', async () => {
    const child = createFakeAccountProcess({ account: null, requiresOpenaiAuth: true });
    const bridge = createCodexBridge({ cwd: process.cwd(), spawn: () => child });

    const status = await bridge.readAccountStatus();
    assert.equal(status.authenticated, false);
    assert.equal(status.requiresOpenaiAuth, true);
});
