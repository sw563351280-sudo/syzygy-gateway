'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// flock locks the inherited open file description. Keeping our descriptor open
// protects the whole turn; closing it (including on process exit) releases it.
// Never unlink the lock file: all processes must keep using the same inode.
function acquireDeploymentLock(file, { platform = process.platform, run = spawnSync } = {}) {
    if (!file || platform !== 'linux') return () => {};
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const fd = fs.openSync(file, 'a', 0o600);
    let closed = false;
    const release = () => {
        if (closed) return;
        closed = true;
        fs.closeSync(fd);
    };
    try {
        const result = run('flock', ['--exclusive', '--nonblock', '--conflict-exit-code', '75', '3'], {
            stdio: ['ignore', 'pipe', 'pipe', fd], timeout: 5000
        });
        if (result.error || result.status !== 0) {
            throw new Error(result.status === 75
                ? '小屋正在发布更新，请稍后再发送。'
                : '无法建立部署保护锁，暂时不能启动 Codex，请检查服务器 flock 配置。');
        }
        return release;
    } catch (error) {
        release();
        throw error;
    }
}

module.exports = { acquireDeploymentLock };
