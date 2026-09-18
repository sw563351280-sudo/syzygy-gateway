const { spawn } = require('child_process');
const readline = require('readline');
const crypto = require('crypto');
const path = require('path');

const MAX_TASKS = 30;
const MAX_EVENTS = 500;
const MAX_PROMPT_LENGTH = 12000;
const LOGIN_TIMEOUT_MS = 16 * 60 * 1000;
const CHAT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const ALLOWED_DECISIONS = new Set(['accept', 'acceptForSession', 'decline', 'cancel']);

function shortText(value, max = 4000) {
    return String(value || '').replace(/\u0000/g, '').slice(0, max);
}

function buildCodexEnv() {
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
        if (/(PASSWORD|SECRET|TOKEN|PRIVATE_KEY|API_KEY|ACCESS_KEY)/i.test(key)) delete env[key];
    }
    return env;
}

function createCodexBridge(options = {}) {
    const spawnProcess = options.spawn || spawn;
    const config = {
        enabled: process.env.CODEX_ENABLED !== 'false',
        bin: process.env.CODEX_BIN || 'codex',
        model: process.env.CODEX_MODEL || 'gpt-5.6-terra',
        cwd: path.resolve(process.env.CODEX_WORKDIR || options.cwd || process.cwd()),
        timeoutMs: Math.max(60_000, Number(process.env.CODEX_TIMEOUT_MS || 20 * 60 * 1000)),
        networkAccess: process.env.CODEX_NETWORK_ACCESS === 'true'
    };

    const tasks = new Map();
    const order = [];
    let activeTaskId = null;
    let loginAttempt = null;

    function publicLogin(attempt = loginAttempt) {
        if (!attempt) return { status: 'idle' };
        return {
            status: attempt.status,
            loginId: attempt.loginId || null,
            verificationUrl: attempt.verificationUrl || null,
            userCode: attempt.userCode || null,
            createdAt: attempt.createdAt,
            updatedAt: attempt.updatedAt,
            expiresAt: attempt.expiresAt,
            authMode: attempt.authMode || null,
            planType: attempt.planType || null,
            error: attempt.error || null
        };
    }

    function stopLoginProcess(attempt, delay = 0) {
        if (!attempt) return;
        if (attempt.timeout) {
            clearTimeout(attempt.timeout);
            attempt.timeout = null;
        }
        const stop = () => {
            try { attempt.proc?.kill(); } catch (_) {}
            attempt.proc = null;
        };
        if (delay > 0) setTimeout(stop, delay);
        else stop();
    }

    function finishLogin(attempt, status, error = null) {
        if (!attempt || attempt !== loginAttempt) return;
        if (!['starting', 'waiting'].includes(attempt.status)) return;
        attempt.status = status;
        attempt.error = error ? shortText(error, 800) : null;
        attempt.updatedAt = new Date().toISOString();
        stopLoginProcess(attempt, 250);
    }

    function loginStatus() {
        if (loginAttempt && ['starting', 'waiting'].includes(loginAttempt.status) && Date.now() >= loginAttempt.expiresAt) {
            finishLogin(loginAttempt, 'expired', '设备代码已过期，请重新生成');
        }
        return publicLogin();
    }

    function startDeviceLogin() {
        if (!config.enabled) throw new Error('Codex Bridge 已被禁用');
        if (loginAttempt && ['starting', 'waiting'].includes(loginAttempt.status) && Date.now() < loginAttempt.expiresAt) {
            return publicLogin();
        }

        const now = Date.now();
        const attempt = {
            status: 'starting',
            loginId: null,
            verificationUrl: null,
            userCode: null,
            createdAt: new Date(now).toISOString(),
            updatedAt: new Date(now).toISOString(),
            expiresAt: now + LOGIN_TIMEOUT_MS,
            authMode: null,
            planType: null,
            error: null,
            proc: null,
            timeout: null
        };
        loginAttempt = attempt;

        let child;
        try {
            child = spawnProcess(config.bin, ['app-server', '--listen', 'stdio://'], {
                cwd: config.cwd,
                env: buildCodexEnv(),
                stdio: ['pipe', 'pipe', 'pipe']
            });
        } catch (error) {
            finishLogin(attempt, 'failed', `无法启动 Codex：${error.message}`);
            return publicLogin();
        }
        attempt.proc = child;
        attempt.timeout = setTimeout(() => {
            if (attempt.loginId && child.stdin && !child.stdin.destroyed) {
                try {
                    child.stdin.write(JSON.stringify({ method: 'account/login/cancel', id: 3, params: { loginId: attempt.loginId } }) + '\n');
                } catch (_) {}
            }
            finishLogin(attempt, 'expired', '设备代码已过期，请重新生成');
        }, LOGIN_TIMEOUT_MS);

        const stdout = readline.createInterface({ input: child.stdout });
        stdout.on('line', (line) => {
            if (!line.trim() || attempt !== loginAttempt) return;
            let message;
            try { message = JSON.parse(line); } catch (_) { return; }

            if (message.id === 1) {
                if (message.error) return finishLogin(attempt, 'failed', message.error.message || 'Codex 初始化失败');
                try {
                    child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
                    child.stdin.write(JSON.stringify({ method: 'account/login/start', id: 2, params: { type: 'chatgptDeviceCode' } }) + '\n');
                } catch (error) {
                    finishLogin(attempt, 'failed', error.message);
                }
                return;
            }

            if (message.id === 2) {
                if (message.error) return finishLogin(attempt, 'failed', message.error.message || '无法创建设备代码');
                const result = message.result || {};
                if (!result.loginId || !result.verificationUrl || !result.userCode) {
                    return finishLogin(attempt, 'failed', 'Codex 没有返回完整的设备登录信息');
                }
                attempt.status = 'waiting';
                attempt.loginId = shortText(result.loginId, 200);
                attempt.verificationUrl = shortText(result.verificationUrl, 1000);
                attempt.userCode = shortText(result.userCode, 100);
                attempt.updatedAt = new Date().toISOString();
                return;
            }

            if (message.method === 'account/login/completed') {
                const params = message.params || {};
                if (attempt.loginId && params.loginId && params.loginId !== attempt.loginId) return;
                if (params.success) finishLogin(attempt, 'completed');
                else finishLogin(attempt, 'failed', params.error || 'Codex 登录未完成');
                return;
            }

            if (message.method === 'account/updated') {
                attempt.authMode = shortText(message.params?.authMode, 100) || null;
                attempt.planType = shortText(message.params?.planType, 100) || null;
                attempt.updatedAt = new Date().toISOString();
            }
        });
        child.stderr.on('data', (chunk) => {
            const text = shortText(chunk, 800).trim();
            if (text && attempt.status === 'starting') attempt.error = text;
        });
        child.once('error', (error) => finishLogin(attempt, 'failed', `无法启动 Codex：${error.message}`));
        child.once('close', (code, signal) => {
            if (['starting', 'waiting'].includes(attempt.status)) {
                finishLogin(attempt, 'failed', `Codex 登录进程已退出（code=${code ?? 'null'}, signal=${signal || 'none'}）`);
            }
        });
        try {
            child.stdin.write(JSON.stringify({
                method: 'initialize',
                id: 1,
                params: { clientInfo: { name: 'syzygy-device-login', title: 'Syzygy Device Login', version: '1.0.0' } }
            }) + '\n');
        } catch (error) {
            finishLogin(attempt, 'failed', error.message);
        }
        return publicLogin();
    }

    function cancelDeviceLogin() {
        const attempt = loginAttempt;
        if (!attempt || !['starting', 'waiting'].includes(attempt.status)) return publicLogin();
        if (attempt.loginId && attempt.proc?.stdin && !attempt.proc.stdin.destroyed) {
            try {
                attempt.proc.stdin.write(JSON.stringify({ method: 'account/login/cancel', id: 3, params: { loginId: attempt.loginId } }) + '\n');
            } catch (_) {}
        }
        finishLogin(attempt, 'cancelled');
        return publicLogin();
    }

    function publicTask(task) {
        return {
            id: task.id,
            status: task.status,
            prompt: task.prompt,
            model: task.model,
            mode: task.mode,
            cwd: task.cwd,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
            threadId: task.threadId || null,
            turnId: task.turnId || null,
            error: task.error || null,
            usage: task.usage || null,
            pendingApproval: task.pending.size > 0,
            eventCount: task.events.length
        };
    }

    function sendSocket(ws, payload) {
        if (ws && ws.readyState === 1) {
            try { ws.send(JSON.stringify(payload)); } catch (_) {}
        }
    }

    function broadcast(task, payload) {
        for (const ws of task.clients) sendSocket(ws, payload);
    }

    function broadcastState(task) {
        task.updatedAt = new Date().toISOString();
        broadcast(task, { type: 'codex_state', task: publicTask(task) });
    }

    function addEvent(task, method, params = {}, extra = {}) {
        const event = {
            at: new Date().toISOString(),
            method,
            params,
            ...extra
        };
        task.events.push(event);
        if (task.events.length > MAX_EVENTS) task.events.splice(0, task.events.length - MAX_EVENTS);
        task.updatedAt = event.at;
        broadcast(task, { type: 'codex_event', taskId: task.id, event });
        broadcastState(task);
    }

    function write(task, message) {
        if (!task.proc || task.proc.stdin.destroyed) throw new Error('Codex 进程不可用');
        task.proc.stdin.write(JSON.stringify(message) + '\n');
    }

    function failTask(task, message) {
        if (task.status !== 'running' && task.status !== 'starting') return;
        if (task.timeout) clearTimeout(task.timeout);
        if (task.idleTimeout) clearTimeout(task.idleTimeout);
        task.status = 'failed';
        task.error = shortText(message, 1000) || 'Codex 任务失败';
        addEvent(task, 'codex/error', { message: task.error });
        if (activeTaskId === task.id) activeTaskId = null;
        try { task.proc?.kill(); } catch (_) {}
    }

    function finishTask(task, status, error = null) {
        if (task.status === 'completed' || task.status === 'failed' || task.status === 'interrupted') return;
        if (task.timeout) clearTimeout(task.timeout);
        task.timeout = null;
        task.status = status;
        task.error = error ? shortText(error, 1000) : task.error;
        if (activeTaskId === task.id) activeTaskId = null;
        broadcastState(task);
        if (task.idleTimeout) clearTimeout(task.idleTimeout);
        task.idleTimeout = setTimeout(() => {
            task.idleTimeout = null;
            try { task.proc?.kill(); } catch (_) {}
            task.proc = null;
            broadcastState(task);
        }, CHAT_IDLE_TIMEOUT_MS);
        task.idleTimeout.unref?.();
    }

    function threadSandboxMode(mode) {
        return mode === 'workspaceWrite' ? 'workspace-write' : 'read-only';
    }

    function approvalPolicy(mode) {
        return mode === 'workspaceWrite' ? 'on-request' : 'never';
    }

    function handleResponse(task, message) {
        if (message.error) {
            failTask(task, message.error.message || 'Codex RPC 请求失败');
            return;
        }
        if (message.id === 1) {
            write(task, { method: 'initialized', params: {} });
            write(task, {
                method: 'thread/start',
                id: 2,
                params: {
                    model: task.model,
                    cwd: task.cwd,
                    approvalPolicy: approvalPolicy(task.mode),
                    // thread/start uses the SandboxMode wire enum, whose values are kebab-case.
                    // turn/start below uses the structured SandboxPolicy enum and remains camelCase.
                    sandbox: threadSandboxMode(task.mode),
                    serviceName: 'syzygy-mobile-debug'
                }
            });
            return;
        }
        if (message.id === 2) {
            task.threadId = message.result?.thread?.id || null;
            if (!task.threadId) return failTask(task, 'Codex 没有返回 thread id');
            write(task, {
                method: 'turn/start',
                id: 3,
                params: {
                    threadId: task.threadId,
                    input: [{ type: 'text', text: task.prompt }],
                    cwd: task.cwd,
                    model: task.model,
                    effort: task.effort,
                    approvalPolicy: approvalPolicy(task.mode),
                    sandboxPolicy: task.mode === 'workspaceWrite'
                        ? { type: 'workspaceWrite', writableRoots: [task.cwd], networkAccess: config.networkAccess }
                        : { type: 'readOnly', access: { type: 'fullAccess' } },
                    summary: 'concise',
                    personality: 'friendly'
                }
            });
            return;
        }
        if (message.id === 3) {
            task.turnId = message.result?.turn?.id || null;
            if (!task.turnId) return failTask(task, 'Codex 没有返回 turn id');
            task.status = 'running';
            addEvent(task, 'codex/started', { threadId: task.threadId, turnId: task.turnId });
            return;
        }
        if (String(message.id || '').startsWith('followup-')) {
            task.turnId = message.result?.turn?.id || null;
            if (!task.turnId) return failTask(task, 'Codex 没有返回 follow-up turn id');
            task.status = 'running';
            addEvent(task, 'codex/started', { threadId: task.threadId, turnId: task.turnId, followup: true });
            return;
        }
        addEvent(task, 'codex/response', { id: message.id, result: message.result || null });
    }

    function handleServerRequest(task, message) {
        const method = String(message.method || '');
        if (method.includes('requestApproval')) {
            task.pending.set(String(message.id), message);
            addEvent(task, method, { requestId: message.id, ...(message.params || {}) });
            return;
        }
        addEvent(task, method || 'codex/request', { requestId: message.id, ...(message.params || {}) });
    }

    function handleNotification(task, message) {
        addEvent(task, message.method || 'codex/event', message.params || {});
        if (message.method === 'thread/tokenUsage/updated') task.usage = message.params?.tokenUsage || message.params || null;
        if (message.method === 'turn/completed') {
            const status = message.params?.turn?.status;
            finishTask(task, status === 'interrupted' ? 'interrupted' : status === 'failed' ? 'failed' : 'completed', message.params?.turn?.error?.message);
        }
        if (message.method === 'error') failTask(task, message.params?.error?.message || message.params?.message);
    }

    function attachProcess(task) {
        let child;
        try {
            child = spawnProcess(config.bin, ['app-server', '--listen', 'stdio://'], {
                cwd: task.cwd,
                env: buildCodexEnv(),
                stdio: ['pipe', 'pipe', 'pipe']
            });
        } catch (error) {
            failTask(task, error.message);
            return;
        }
        task.proc = child;
        const stdout = readline.createInterface({ input: child.stdout });
        stdout.on('line', (line) => {
            if (!line.trim()) return;
            try {
                const message = JSON.parse(line);
                if (message.method && message.id !== undefined) handleServerRequest(task, message);
                else if (message.id !== undefined) handleResponse(task, message);
                else handleNotification(task, message);
            } catch (error) {
                addEvent(task, 'codex/protocol-error', { message: shortText(error.message), line: shortText(line) });
            }
        });
        const stderr = readline.createInterface({ input: child.stderr });
        stderr.on('line', (line) => addEvent(task, 'codex/stderr', { text: shortText(line) }));
        child.once('error', (error) => failTask(task, `无法启动 Codex：${error.message}`));
        child.once('close', (code, signal) => {
            if (task.status === 'running' || task.status === 'starting') {
                failTask(task, `Codex 进程已退出（code=${code ?? 'null'}, signal=${signal || 'none'}）`);
            }
        });
        try {
            write(task, {
                method: 'initialize',
                id: 1,
                params: {
                    clientInfo: { name: 'syzygy-mobile-debug', title: 'Syzygy Mobile Debug', version: '1.0.0' }
                }
            });
        } catch (error) {
            failTask(task, error.message);
        }
    }

    let usagePromise = null;
    function readAccountUsage() {
        if (!config.enabled) return Promise.resolve({ ok: false, error: 'Codex Bridge 已禁用' });
        if (usagePromise) return usagePromise;
        usagePromise = new Promise((resolve, reject) => {
            let child;
            let settled = false;
            const responses = new Map();
            const timer = setTimeout(() => finishError('读取 Codex 用量超时'), 12_000);
            const finish = (value) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                try { child?.kill(); } catch (_) {}
                resolve(value);
            };
            const finishError = (message) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                try { child?.kill(); } catch (_) {}
                reject(new Error(shortText(message, 800)));
            };
            const maybeFinish = () => {
                if (!responses.has(2) || !responses.has(3)) return;
                const rate = responses.get(2);
                const usage = responses.get(3);
                const errors = [rate, usage].filter(item => item?.error).map(item => item.error);
                finish({
                    ok: errors.length === 0,
                    error: errors.length ? errors.join('；') : null,
                    rateLimits: rate?.result || null,
                    usage: usage?.result || null,
                    fetchedAt: new Date().toISOString()
                });
            };
            try {
                child = spawnProcess(config.bin, ['app-server', '--listen', 'stdio://'], {
                    cwd: config.cwd,
                    env: buildCodexEnv(),
                    stdio: ['pipe', 'pipe', 'pipe']
                });
                const stdout = readline.createInterface({ input: child.stdout });
                stdout.on('line', (line) => {
                    if (!line.trim()) return;
                    let message;
                    try { message = JSON.parse(line); } catch (_) { return; }
                    if (message.id === 1) {
                        if (message.error) return finishError(message.error.message || 'Codex 初始化失败');
                        try {
                            child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
                            child.stdin.write(JSON.stringify({ method: 'account/rateLimits/read', id: 2 }) + '\n');
                            child.stdin.write(JSON.stringify({ method: 'account/usage/read', id: 3 }) + '\n');
                        } catch (error) { finishError(error.message); }
                        return;
                    }
                    if (message.id === 2 || message.id === 3) {
                        responses.set(message.id, message.error ? { error: message.error.message || 'Codex 请求失败' } : { result: message.result || {} });
                        maybeFinish();
                    }
                });
                child.stderr.on('data', () => {});
                child.once('error', (error) => finishError(`无法启动 Codex：${error.message}`));
                child.once('close', () => { if (!settled) finishError('Codex 用量连接已关闭'); });
                child.stdin.write(JSON.stringify({
                    method: 'initialize',
                    id: 1,
                    params: { clientInfo: { name: 'syzygy-usage-panel', title: 'Syzygy Usage Panel', version: '1.0.0' } }
                }) + '\n');
            } catch (error) {
                finishError(error.message);
            }
        });
        usagePromise.then(() => { usagePromise = null; }, () => { usagePromise = null; });
        return usagePromise;
    }

    function pruneTasks() {
        while (order.length > MAX_TASKS) {
            const oldId = order.shift();
            const old = tasks.get(oldId);
            if (old && old.status !== 'running' && old.status !== 'starting') {
                if (old.idleTimeout) clearTimeout(old.idleTimeout);
                try { old.proc?.kill(); } catch (_) {}
                tasks.delete(oldId);
            }
            else order.push(oldId);
        }
    }

    function startTask(input = {}) {
        if (!config.enabled) throw new Error('Codex Bridge 已被禁用');
        if (activeTaskId) throw new Error('当前已有 Codex 任务运行中，请先等待或中断它');
        const prompt = shortText(input.prompt, MAX_PROMPT_LENGTH).trim();
        if (!prompt) throw new Error('请输入要诊断的问题');
        const mode = input.mode === 'workspaceWrite' ? 'workspaceWrite' : 'readOnly';
        const effort = ['low', 'medium', 'high', 'xhigh'].includes(input.effort) ? input.effort : 'medium';
        const task = {
            id: crypto.randomUUID(),
            status: 'starting',
            prompt,
            model: /^[a-zA-Z0-9._-]{1,80}$/.test(input.model || '') ? input.model : config.model,
            effort,
            mode,
            cwd: config.cwd,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            threadId: null,
            turnId: null,
            usage: null,
            error: null,
            events: [],
            pending: new Map(),
            clients: new Set(),
            proc: null,
            timeout: null,
            idleTimeout: null
        };
        tasks.set(task.id, task);
        order.push(task.id);
        activeTaskId = task.id;
        task.timeout = setTimeout(() => failTask(task, 'Codex 任务超时'), config.timeoutMs);
        addEvent(task, 'codex/queued', { model: task.model, mode: task.mode, cwd: task.cwd });
        attachProcess(task);
        pruneTasks();
        return publicTask(task);
    }

    function taskById(id) {
        return tasks.get(String(id || '')) || null;
    }

    function sendClientCommand(task, payload) {
        if (!task || !payload || typeof payload !== 'object') throw new Error('无效的 Codex 指令');
        if (payload.type === 'interrupt') {
            if (task.threadId && task.turnId) write(task, { method: 'turn/interrupt', id: `interrupt-${Date.now()}`, params: { threadId: task.threadId, turnId: task.turnId } });
            return;
        }
        if (payload.type === 'steer') {
            const text = shortText(payload.text, 4000).trim();
            if (!text || !task.threadId || !task.turnId) throw new Error('当前任务还不能继续对话');
            addEvent(task, 'codex/user-message', { text, steer: true });
            write(task, { method: 'turn/steer', id: `steer-${Date.now()}`, params: { threadId: task.threadId, expectedTurnId: task.turnId, input: [{ type: 'text', text }] } });
            return;
        }
        if (payload.type === 'followup') {
            const text = shortText(payload.text, MAX_PROMPT_LENGTH).trim();
            if (!text) throw new Error('请输入要继续问 Codex 的内容');
            if (!task.threadId || !task.proc || task.proc.stdin.destroyed) throw new Error('这个 Codex 对话已经休眠，请新建对话');
            if (!['completed', 'interrupted'].includes(task.status)) throw new Error('请等当前回复结束后再继续');
            if (activeTaskId && activeTaskId !== task.id) throw new Error('当前有另一个 Codex 对话正在运行');
            if (task.idleTimeout) clearTimeout(task.idleTimeout);
            task.idleTimeout = null;
            task.status = 'starting';
            task.error = null;
            activeTaskId = task.id;
            task.timeout = setTimeout(() => failTask(task, 'Codex 任务超时'), config.timeoutMs);
            addEvent(task, 'codex/user-message', { text });
            write(task, {
                method: 'turn/start',
                id: `followup-${Date.now()}`,
                params: {
                    threadId: task.threadId,
                    input: [{ type: 'text', text }],
                    cwd: task.cwd,
                    model: task.model,
                    effort: task.effort,
                    approvalPolicy: approvalPolicy(task.mode),
                    sandboxPolicy: task.mode === 'workspaceWrite'
                        ? { type: 'workspaceWrite', writableRoots: [task.cwd], networkAccess: config.networkAccess }
                        : { type: 'readOnly', access: { type: 'fullAccess' } },
                    summary: 'concise',
                    personality: 'friendly'
                }
            });
            broadcastState(task);
            return;
        }
        if (payload.type === 'approval') {
            const requestId = String(payload.requestId || '');
            const pending = task.pending.get(requestId);
            const decision = String(payload.decision || '');
            if (!pending || !ALLOWED_DECISIONS.has(decision)) throw new Error('审批请求已失效或决定无效');
            task.pending.delete(requestId);
            write(task, { id: pending.id, result: { decision } });
            addEvent(task, 'codex/approval-resolved', { requestId: pending.id, decision });
            return;
        }
        throw new Error('不支持的 Codex 指令');
    }

    function attachSocket(ws, taskId) {
        const task = taskById(taskId);
        if (!task) {
            sendSocket(ws, { type: 'codex_error', error: '找不到 Codex 任务' });
            return ws.close(1008, 'Unknown task');
        }
        task.clients.add(ws);
        sendSocket(ws, { type: 'codex_snapshot', task: publicTask(task), events: task.events.slice(-120) });
        ws.on('message', (raw) => {
            try {
                sendClientCommand(task, JSON.parse(raw.toString()));
            } catch (error) {
                sendSocket(ws, { type: 'codex_error', error: shortText(error.message, 500) });
            }
        });
        const cleanup = () => task.clients.delete(ws);
        ws.on('close', cleanup);
        ws.on('error', cleanup);
    }

    return {
        status() {
            return {
                enabled: config.enabled,
                configured: config.enabled,
                available: config.enabled,
                bin: config.bin,
                model: config.model,
                cwd: config.cwd,
                activeTaskId,
                active: activeTaskId ? publicTask(tasks.get(activeTaskId)) : null,
                historyCount: order.length,
                message: config.enabled ? 'Codex Bridge 已启用；首次运行需要服务器上的 Codex 登录状态。' : 'Codex Bridge 已禁用。'
            };
        },
        listTasks() { return order.slice().reverse().map(id => publicTask(tasks.get(id))).filter(Boolean); },
        startTask,
        readAccountUsage,
        loginStatus,
        startDeviceLogin,
        cancelDeviceLogin,
        taskById,
        attachSocket,
        sendClientCommand
    };
}

module.exports = { createCodexBridge };
