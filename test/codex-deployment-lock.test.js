'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { acquireDeploymentLock } = require('../codex-deployment-lock');

function fixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'syzygy-lock-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    return path.join(directory, 'deployment.lock');
}

test('lease retains its descriptor until released, and release is idempotent', t => {
    const file = fixture(t);
    let fd;
    const release = acquireDeploymentLock(file, { platform: 'linux', run: (cmd, args, options) => {
        assert.equal(cmd, 'flock');
        assert.equal(args.at(-1), '3');
        fd = options.stdio[3];
        assert.ok(fs.fstatSync(fd).isFile());
        return { status: 0 };
    } });
    assert.ok(fs.fstatSync(fd).isFile());
    release();
    release();
    assert.throws(() => fs.fstatSync(fd), { code: 'EBADF' });
    assert.ok(fs.existsSync(file), 'lock inode must not be unlinked');
});

test('deployment contention and missing flock both fail closed without leaking descriptors', t => {
    const file = fixture(t);
    for (const result of [{ status: 75 }, { status: null, error: new Error('missing flock') }]) {
        let fd;
        assert.throws(() => acquireDeploymentLock(file, { platform: 'linux', run: (_cmd, _args, options) => {
            fd = options.stdio[3];
            return result;
        } }), result.status === 75 ? /正在发布/ : /无法建立部署保护锁/);
        assert.throws(() => fs.fstatSync(fd), { code: 'EBADF' });
    }
});

test('real Linux lock excludes deployment and a competing turn until release', { skip: process.platform !== 'linux' }, t => {
    const file = fixture(t);
    const release = acquireDeploymentLock(file);
    t.after(release);
    assert.equal(spawnSync('flock', ['-n', '-E', '75', file, 'true']).status, 75);
    assert.throws(() => acquireDeploymentLock(file), /正在发布/);
    release();
    assert.equal(spawnSync('flock', ['-n', '-E', '75', file, 'true']).status, 0);
});

test('deployment waits for active owner and kernel releases lock after owner crashes', { skip: process.platform !== 'linux', timeout: 10000 }, async t => {
    const file = fixture(t);
    const modulePath = require.resolve('../codex-deployment-lock');
    const owner = spawn(process.execPath, ['-e', 'require(process.argv[1]).acquireDeploymentLock(process.argv[2]); process.stdout.write("ready"); setInterval(() => {}, 1000)', modulePath, file], { stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(() => owner.kill('SIGKILL'));
    await once(owner.stdout, 'data');
    const waiter = spawn('flock', ['-w', '5', file, 'true']);
    t.after(() => waiter.kill('SIGKILL'));
    const waitDone = once(waiter, 'exit');
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(waiter.exitCode, null, 'deployment must still be waiting');
    const ownerDone = once(owner, 'exit');
    owner.kill('SIGKILL');
    await ownerDone;
    const [code] = await waitDone;
    assert.equal(code, 0);
});
