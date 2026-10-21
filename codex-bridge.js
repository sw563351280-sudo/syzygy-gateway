const { spawn } = require('child_process');
const readline = require('readline');
const crypto = require('crypto');
const path = require('path');
const { acquireDeploymentLock } = require('./codex-deployment-lock');

const MAX_TASKS = 30;
const MAX_EVENTS = 500;
const MAX_PROMPT_LENGTH = 12000;
const MAX_IMAGE_COUNT = 4;
const MAX_IMAGE_DATA_BYTES = 4 * 1024 * 1024;
const LOGIN_TIMEOUT_MS = 16 * 60 * 1000;
const CHAT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const ALLOWED_DECISIONS = new Set(['accept', 'acceptForSession', 'decline', 'cancel']);

function shortText(value, max = 4000) {
    return String(value || '').replace(/\u0000/g, '').slice(0, max);
}

function replyActivityKind(method, params = {}) {
    if (!method || method.includes('requestApproval')) return '';
    const itemType = String(params.item?.type || '');
    if (method.startsWith('item/fileChange') || method === 'turn/diff/updated' || itemType === 'fileChange') return 'editing';
    if (method.startsWith('item/commandExecution') || itemType === 'commandExecution') {
        const command = String(params.command || params.item?.command || params.item?.aggregatedOutput || '').toLowerCase();
        if (/\b(test|vitest|jest|pytest|mocha|lint|typecheck|check)\b/.test(command)) return 'testing';
        if (/\b(git\s+push|gh\s+pr)\b/.test(command)) return 'sending';
        if (/\b(screenshot|chromium|chrome|playwright)\b/.test(command)) return 'looking';
        return 'reading';
    }
    if (itemType && !['agentMessage', 'reasoning', 'plan'].includes(itemType)) return 'working';
    if (/^item\/(?:mcpToolCall|dynamicToolCall|webSearch)/.test(method)) return 'working';
    return '';
}

function appendReplyText(snapshot, value) {
    const delta = String(value || '');
    if (!snapshot || !delta) return;
    const timeline = snapshot.timeline ||= [];
    const previous = timeline[timeline.length - 1];
    if (previous?.type === 'text') previous.text += delta;
    else {
        timeline.push({ type: 'text', text: delta });
        if (snapshot.text) snapshot.text += '\n\n';
    }
    snapshot.text += delta;
}

function appendReplyActivity(snapshot, method, params) {
    const kind = replyActivityKind(method, params);
    if (!snapshot || !kind) return;
    const timeline = snapshot.timeline ||= [];
    const previous = timeline[timeline.length - 1];
    const hasCommandDetail = Boolean(params.command || params.item?.command || params.item?.aggregatedOutput);
    if (previous?.type === 'activity') {
        if (kind !== 'reading' || previous.kind === 'reading' || hasCommandDetail) previous.kind = kind;
    }
    else timeline.push({ type: 'activity', kind });
}

function normalizeImages(value) {
    if (!Array.isArray(value)) return [];
    if (value.length > MAX_IMAGE_COUNT) throw new Error(`一次最多发送 ${MAX_IMAGE_COUNT} 张图片`);
    let totalBytes = 0;
    return value.map(item => {
        const url = String(item || '');
        const match = url.match(/^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/i);
        if (!match) throw new Error('Codex 图片格式无效');
        totalBytes += Math.ceil(match[1].length * 0.75);
        if (totalBytes > MAX_IMAGE_DATA_BYTES) throw new Error('Codex 图片总大小不能超过 4 MB');
        return url;
    });
}

function buildTurnInput(text, images) {
    const input = [{ type: 'text', text: text || '请查看我附上的图片。' }];
    for (const url of images || []) input.push({ type: 'image', url, detail: 'auto' });
    return input;
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
    const acquireTurnLease = options.acquireTurnLease || (() => acquireDeploymentLock(options.deploymentLockPath));
    const turnInput = (text, images) => buildTurnInput(options.getInstructions ? options.getInstructions() + '\n\n【本轮消息】\n' + text : text, images);
    function recordTurn(task, status) {
        if (!options.onTurnComplete) return;
        try {
            const record = options.onTurnComplete(task, status);
            if (record) addEvent(task, 'codex/work-record-saved', { id: record.id, title: record.title });
        } catch (error) {
            addEvent(task, 'codex/work-record-error', { message: String(error.message || '工作记录保存失败') });
        }
    }
    function processEnv() {
        const env = buildCodexEnv();
        if (options.codexHome) env.CODEX_HOME = options.codexHome;
        return env;
    }
    const config = {
        enabled: process.env.CODEX_ENABLED !== 'false',
        bin: process.env.CODEX_BIN || 'codex',
        model: process.env.CODEX_MODEL || 'gpt-5.6-terra',
        cwd: path.resolve(options.isolated ? options.cwd : process.env.CODEX_WORKDIR || options.cwd || process.cwd()),
        timeoutMs: Math.max(60_000, Number(process.env.CODEX_TIMEOUT_MS || 20 * 60 * 1000)),
        networkAccess: !options.isolated && process.env.CODEX_NETWORK_ACCESS === 'true'
    };
    const threadConfig = options.threadConfig && typeof options.threadConfig === 'object'
        ? structuredClone(options.threadConfig)
        : null;

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
            effort: task.effort,
            mode: task.mode,
            cwd: task.cwd,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
            threadId: task.threadId || null,
            turnId: task.turnId || null,
            error: task.error || null,
            usage: task.usage || null,
            pendingApproval: task.pending.size > 0,
            interruptRequested: Boolean(task.interruptRequested),
            canFollowup: Boolean(task.proc && !task.proc.killed && !task.proc.stdin.destroyed),
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
        if (method === 'codex/started') task.didWork = false;
        if (method.startsWith('item/commandExecution') || method.startsWith('item/fileChange')
            || (['item/started', 'item/completed'].includes(method) && ['commandExecution', 'fileChange'].includes(params.item?.type))) task.didWork = true;
        // Preserve the reply independently of the bounded diagnostic event log.
        if (method === 'codex/started') task.replySnapshot = { turnId: params.turnId, text: '', timeline: [], status: 'running' };
        if (method === 'item/agentMessage/delta') appendReplyText(task.replySnapshot, params.delta || params.text || '');
        else appendReplyActivity(task.replySnapshot, method, params);
        if (method === 'turn/completed' && task.replySnapshot) task.replySnapshot.status = params.turn?.status || 'completed';
        if (method === 'codex/error' && task.replySnapshot) {
            task.replySnapshot.status = 'failed';
        }
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
        task.input = null;
        task.error = shortText(message, 1000) || 'Codex 任务失败';
        addEvent(task, 'codex/error', { message: task.error });
        recordTurn(task, 'failed');
        if (activeTaskId === task.id) activeTaskId = null;
        try { task.proc?.kill(); } catch (_) {}
        task.releaseDeploymentLock?.();
        task.releaseDeploymentLock = null;
    }

    function finishTask(task, status, error = null) {
        if (task.status === 'completed' || task.status === 'failed' || task.status === 'interrupted') return;
        if (task.timeout) clearTimeout(task.timeout);
        task.timeout = null;
        task.status = status;
        task.pending.clear();
        recordTurn(task, status);
        task.error = error ? shortText(error, 1000) : task.error;
        if (activeTaskId === task.id) activeTaskId = null;
        broadcastState(task);
        // Persist the result and broadcast completion before allowing deployment.
        task.releaseDeploymentLock?.();
        task.releaseDeploymentLock = null;
        if (options.isolated) {
            try { task.proc?.kill(); } catch (_) {}
            task.proc = null;
            return;
        }
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

    function sandboxPolicy(task) {
        if (task.mode === 'workspaceWrite') return { type: 'workspaceWrite', writableRoots: [task.cwd], networkAccess: config.networkAccess };
        // Explicit networkAccess is supported by older and newer CLI schemas.
        // Keep the manual bridge's existing policy unchanged.
        return options.isolated ? { type: 'readOnly', networkAccess: false }
            : { type: 'readOnly', access: { type: 'fullAccess' } };
    }

    function approvalPolicy(mode) {
        return mode === 'workspaceWrite' ? 'on-request' : 'never';
    }

    function approvalsReviewer(mode) {
        // Keep the workspace sandbox and on-request policy in place. Codex's
        // reviewer resolves eligible low-risk requests; anything it cannot
        // safely resolve still reaches the user through the normal queue.
        return mode === 'workspaceWrite' ? 'auto_review' : 'user';
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
                    approvalsReviewer: approvalsReviewer(task.mode),
                    // thread/start uses the SandboxMode wire enum, whose values are kebab-case.
                    // turn/start below uses the structured SandboxPolicy enum and remains camelCase.
                    sandbox: threadSandboxMode(task.mode),
                    serviceName: options.serviceName || 'syzygy-mobile-debug',
                    ...(options.developerInstructions ? { developerInstructions: shortText(options.developerInstructions, 8000) } : {}),
                    ...(threadConfig ? { config: threadConfig } : {})
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
                    input: task.input,
                    cwd: task.cwd,
                    model: task.model,
                    effort: task.effort,
                    approvalPolicy: approvalPolicy(task.mode),
                    approvalsReviewer: approvalsReviewer(task.mode),
                    sandboxPolicy: sandboxPolicy(task),
                    summary: 'concise',
                    personality: 'friendly'
                }
            });
            return;
        }
        task.input = null;
        if (message.id === 3) {
            task.turnId = message.result?.turn?.id || null;
            if (!task.turnId) return failTask(task, 'Codex 没有返回 turn id');
            task.status = 'running';
            addEvent(task, 'codex/started', { threadId: task.threadId, turnId: task.turnId });
            if (task.interruptRequested) write(task, { method: 'turn/interrupt', id: `interrupt-${Date.now()}`, params: { threadId: task.threadId, turnId: task.turnId } });
            return;
        }
        if (String(message.id || '').startsWith('followup-')) {
            task.turnId = message.result?.turn?.id || null;
            if (!task.turnId) return failTask(task, 'Codex 没有返回 follow-up turn id');
            task.status = 'running';
            addEvent(task, 'codex/started', { threadId: task.threadId, turnId: task.turnId, followup: true });
            if (task.interruptRequested) write(task, { method: 'turn/interrupt', id: `interrupt-${Date.now()}`, params: { threadId: task.threadId, turnId: task.turnId } });
            return;
        }
        addEvent(task, 'codex/response', { id: message.id, result: message.result || null });
    }

    function handleServerRequest(task, message) {
        const method = String(message.method || '');
        if (method.includes('requestApproval') || method === 'applyPatchApproval' || method === 'execCommandApproval') {
            if (options.isolated) {
                // Background jobs cannot acquire broader permissions through a
                // missing UI client. Decline using the existing protocol mapper.
                task.pending.set(String(message.id), message);
                sendClientCommand(task, { type: 'approval', requestId: message.id, decision: 'decline' });
                return;
            }
            if (task.source === 'workroom' && task.mode === 'readOnly') return failTask(task, '讨论模式不能申请执行权限；需要修改请点击让 Codex 开工');
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
                env: processEnv(),
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
    let accountStatusPromise = null;

    const readModels = require('./codex-models').createModelReader({
        spawn: spawnProcess, bin: config.bin, cwd: config.cwd, env: buildCodexEnv
    });
    function readAccountStatus() {
        if (!config.enabled) return Promise.resolve({ ok: false, error: 'Codex Bridge 已禁用' });
        if (accountStatusPromise) return accountStatusPromise;
        accountStatusPromise = new Promise((resolve, reject) => {
            let child;
            let settled = false;
            const timer = setTimeout(() => finishError('读取 Codex 账号状态超时'), 8_000);
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
                            child.stdin.write(JSON.stringify({ method: 'account/read', id: 2, params: { refreshToken: false } }) + '\n');
                        } catch (error) { finishError(error.message); }
                        return;
                    }
                    if (message.id !== 2) return;
                    if (message.error) return finishError(message.error.message || '无法读取 Codex 账号状态');
                    const result = message.result || {};
                    if (typeof result.requiresOpenaiAuth !== 'boolean') return finishError('Codex 返回了无法识别的账号状态');
                    const account = result.account || null;
                    const loginRequired = result.requiresOpenaiAuth && !account;
                    finish({
                        ok: true,
                        authenticated: !loginRequired,
                        loginRequired,
                        requiresOpenaiAuth: result.requiresOpenaiAuth,
                        account,
                        fetchedAt: new Date().toISOString()
                    });
                });
                child.stderr.on('data', () => {});
                child.once('error', (error) => finishError(`无法启动 Codex：${error.message}`));
                child.once('close', () => { if (!settled) finishError('Codex 账号连接已关闭'); });
                child.stdin.write(JSON.stringify({
                    method: 'initialize',
                    id: 1,
                    params: { clientInfo: { name: 'syzygy-account-check', title: 'Syzygy Account Check', version: '1.0.0' } }
                }) + '\n');
            } catch (error) {
                finishError(error.message);
            }
        });
        accountStatusPromise.then(() => { accountStatusPromise = null; }, () => { accountStatusPromise = null; });
        return accountStatusPromise;
    }

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
        const isWorkroom = input.source === 'workroom';
        const executing = isWorkroom && input.workroomAction === 'execute';
        const prompt = shortText(input.prompt, MAX_PROMPT_LENGTH).trim();
        const images = normalizeImages(input.images);
        if (!prompt && images.length === 0) throw new Error('请输入问题或添加图片');
        const displayPrompt = prompt || `（发送了 ${images.length} 张图片）`;
        const mode = isWorkroom ? (executing ? 'workspaceWrite' : 'readOnly') : input.mode === 'workspaceWrite' ? 'workspaceWrite' : 'readOnly';
        const selection = isWorkroom && options.getTaskSettings ? options.getTaskSettings() : input;
        const effort = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(selection.effort) ? selection.effort : 'medium';
        const task = {
            id: crypto.randomUUID(),
            status: 'starting',
            prompt: displayPrompt,
            input: turnInput(prompt + (isWorkroom && !executing ? '\n【服务端讨论约束】本轮未点击开工，只能讨论或只读检查。不得修改、部署、推送，也不得通过外部工具绕过只读限制。' : ''), images),
            source: options.isolated ? 'background' : isWorkroom ? 'workroom' : 'dev',
            model: /^[a-zA-Z0-9._-]{1,80}$/.test(selection.model || '') ? selection.model : config.model,
            effort,
            mode,
            cwd: config.cwd,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            threadId: null,
            turnId: null,
            usage: null,
            error: null,
            interruptRequested: false,
            events: [],
            pending: new Map(),
            clients: new Set(),
            proc: null,
            timeout: null,
            idleTimeout: null
        };
        task.releaseDeploymentLock = acquireTurnLease();
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
        if (task.source === 'workroom' && ['steer', 'followup'].includes(payload.type)) throw new Error('工作区每轮需通过发送或开工入口创建独立权限会话');
        if (payload.type === 'interrupt') {
            if (!['starting', 'running'].includes(task.status)) throw new Error('这个 Codex 任务已经结束');
            if (task.interruptRequested) return;
            task.interruptRequested = true;
            addEvent(task, 'codex/interrupt-requested', {});
            if (task.threadId && task.turnId) write(task, { method: 'turn/interrupt', id: `interrupt-${Date.now()}`, params: { threadId: task.threadId, turnId: task.turnId } });
            return;
        }
        if (payload.type === 'steer') {
            const text = shortText(payload.text, 4000).trim();
            const images = normalizeImages(payload.images);
            if ((!text && images.length === 0) || !task.threadId || !task.turnId) throw new Error('当前任务还不能继续对话');
            const displayText = text || `（发送了 ${images.length} 张图片）`;
            addEvent(task, 'codex/user-message', { text: displayText, imageCount: images.length, steer: true });
            write(task, { method: 'turn/steer', id: `steer-${Date.now()}`, params: { threadId: task.threadId, expectedTurnId: task.turnId, input: buildTurnInput(text, images) } });
            return;
        }
        if (payload.type === 'followup') {
            const text = shortText(payload.text, MAX_PROMPT_LENGTH).trim();
            const images = normalizeImages(payload.images);
            const input = turnInput(text, images);
            if (!text && images.length === 0) throw new Error('请输入内容或添加图片');
            if (!task.threadId || !task.proc || task.proc.stdin.destroyed) throw new Error('这个 Codex 对话已经休眠，请新建对话');
            if (!['completed', 'interrupted'].includes(task.status)) throw new Error('请等当前回复结束后再继续');
            if (activeTaskId && activeTaskId !== task.id) throw new Error('当前有另一个 Codex 对话正在运行');
            task.releaseDeploymentLock = acquireTurnLease();
            if (task.idleTimeout) clearTimeout(task.idleTimeout);
            task.idleTimeout = null;
            task.status = 'starting';
            task.interruptRequested = false;
            task.error = null;
            activeTaskId = task.id;
            task.timeout = setTimeout(() => failTask(task, 'Codex 任务超时'), config.timeoutMs);
            const displayText = text || `（发送了 ${images.length} 张图片）`;
            addEvent(task, 'codex/user-message', { text: displayText, imageCount: images.length });
            try {
                write(task, {
                    method: 'turn/start',
                    id: `followup-${Date.now()}`,
                    params: {
                        threadId: task.threadId,
                        input,
                        cwd: task.cwd,
                        model: task.model,
                        effort: task.effort,
                        approvalPolicy: approvalPolicy(task.mode),
                        approvalsReviewer: approvalsReviewer(task.mode),
                        sandboxPolicy: sandboxPolicy(task),
                        summary: 'concise',
                        personality: 'friendly'
                    }
                });
            } catch (error) {
                failTask(task, error.message);
                throw error;
            }
            broadcastState(task);
            return;
        }
        if (payload.type === 'approval') {
            const requestId = String(payload.requestId ?? '');
            const pending = task.pending.get(requestId);
            const decision = String(payload.decision || '');
            if (!pending || !ALLOWED_DECISIONS.has(decision)) throw new Error('审批请求已失效或决定无效');
            task.pending.delete(requestId);
            let result;
            if (pending.method === 'item/permissions/requestApproval') {
                const accepted = decision === 'accept' || decision === 'acceptForSession';
                result = {
                    permissions: accepted ? (pending.params?.permissions || {}) : {},
                    scope: decision === 'acceptForSession' ? 'session' : 'turn'
                };
            } else if (pending.method === 'applyPatchApproval' || pending.method === 'execCommandApproval') {
                const legacyDecision = decision === 'accept'
                    ? 'approved'
                    : decision === 'acceptForSession'
                        ? 'approved_for_session'
                        : decision === 'cancel'
                            ? 'abort'
                            : { denied: { rejection: '用户拒绝了这项操作' } };
                result = { decision: legacyDecision };
            } else {
                result = { decision };
            }
            write(task, { id: pending.id, result });
            addEvent(task, 'codex/approval-resolved', { requestId: pending.id, decision });
            return;
        }
        throw new Error('不支持的 Codex 指令');
    }

    function attachSocket(ws, taskId) {
        const task = taskById(taskId);
        if (!task) {
            sendSocket(ws, { type: 'codex_error', code: 'TASK_NOT_FOUND', recoverable: true, error: '找不到 Codex 任务' });
            return ws.close(1008, 'Unknown task');
        }
        task.clients.add(ws);
        sendSocket(ws, {
            type: 'codex_snapshot', task: publicTask(task), events: task.events.slice(-120),
            reply: task.replySnapshot || null,
            approvals: Array.from(task.pending.values(), request => ({ method: request.method, params: { ...request.params, requestId: request.id } }))
        });
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
        readModels,
        readAccountStatus,
        loginStatus,
        startDeviceLogin,
        cancelDeviceLogin,
        taskById,
        attachSocket,
        sendClientCommand
    };
}

module.exports = { createCodexBridge };
