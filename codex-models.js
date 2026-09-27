'use strict';
const readline = require('node:readline');

// Read-only discovery. Never starts a thread or a paid turn.
function createModelReader({ spawn, bin, cwd, env, timeoutMs = 10000 }) {
    let pending;
    let cached;
    let expires = 0;
    return function readModels() {
        if (cached && Date.now() < expires) return Promise.resolve(cached);
        if (pending) return pending;
        pending = new Promise((resolve, reject) => {
            let child, lines, settled = false;
            const rows = [], cursors = new Set();
            const timer = setTimeout(() => finish(new Error('读取模型列表超时，请稍后重试')), timeoutMs);
            function finish(error, value) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                lines?.close();
                try { child?.kill(); } catch (_) {}
                if (error) reject(error);
                else { cached = value; expires = Date.now() + 60000; resolve(value); }
            }
            function send(method, id, params) {
                child.stdin.write(JSON.stringify({ method, id, params }) + '\n');
            }
            try {
                child = spawn(bin, ['app-server', '--listen', 'stdio://'], { cwd, env: env(), stdio: ['pipe', 'pipe', 'pipe'] });
                lines = readline.createInterface({ input: child.stdout });
                child.stderr.on('data', () => {});
                child.stdin.on('error', error => finish(error));
                child.once('error', error => finish(error));
                child.once('close', () => finish(new Error('模型列表连接已关闭')));
                lines.on('line', line => {
                    if (settled) return;
                    let message;
                    try { message = JSON.parse(line); } catch (_) { return; }
                    if (![1, 2].includes(message.id)) return;
                    if (message.error) return finish(new Error(message.error.message || '读取模型列表失败'));
                    try {
                        if (message.id === 1) {
                            send('initialized', undefined, {});
                            send('model/list', 2, { limit: 100, includeHidden: false });
                        } else {
                            if (!Array.isArray(message.result?.data)) throw new Error('模型列表格式无效');
                            rows.push(...message.result.data);
                            const cursor = message.result.nextCursor;
                            if (cursor) {
                                if (cursors.has(cursor) || cursors.size >= 20) throw new Error('模型列表分页异常');
                                cursors.add(cursor);
                                send('model/list', 2, { limit: 100, includeHidden: false, cursor });
                            } else {
                                finish(null, rows.filter(row => !row.hidden && typeof row.model === 'string').map(row => ({
                                    model: row.model, displayName: row.displayName || row.model,
                                    defaultReasoningEffort: row.defaultReasoningEffort,
                                    supportedReasoningEfforts: row.supportedReasoningEfforts || [],
                                    isDefault: Boolean(row.isDefault)
                                })));
                            }
                        }
                    } catch (error) { finish(error); }
                });
                send('initialize', 1, { clientInfo: { name: 'syzygy-model-picker', version: '1.0.0' } });
            } catch (error) { finish(error); }
        });
        pending.then(() => { pending = null; }, () => { pending = null; });
        return pending;
    };
}
module.exports = { createModelReader };
