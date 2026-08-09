const { spawn } = require('child_process');
const readline = require('readline');
const crypto = require('crypto');
const path = require('path');

const MAX_TASKS = 30;
const MAX_EVENTS = 500;
const MAX_PROMPT_LENGTH = 12000;
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
        task.status = 'failed';
        task.error = shortText(message, 1000) || 'Codex 任务失败';
        addEvent(task, 'codex/error', { message: task.error });
        if (activeTaskId === task.id) activeTaskId = null;
        try { task.proc?.kill(); } catch (_) {}
    }

    function finishTask(task, status, error = null) {
        if (task.status === 'completed' || task.status === 'failed' || task.status === 'interrupted') return;
        if (task.timeout) clearTimeout(task.timeout);
        task.status = status;
        task.error = error ? shortText(error, 1000) : task.error;
        if (activeTaskId === task.id) activeTaskId = null;
        broadcastState(task);
        setTimeout(() => {
            try { task.proc?.kill(); } catch (_) {}
        }, 250);
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
                    approvalPolicy: task.mode === 'workspaceWrite' ? 'onRequest' : 'never',
                    sandbox: task.mode === 'workspaceWrite' ? 'workspaceWrite' : 'readOnly',
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
                    approvalPolicy: task.mode === 'workspaceWrite' ? 'onRequest' : 'never',
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
            child = spawn(config.bin, ['app-server', '--listen', 'stdio://'], {
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

    function pruneTasks() {
        while (order.length > MAX_TASKS) {
            const oldId = order.shift();
            const old = tasks.get(oldId);
            if (old && old.status !== 'running' && old.status !== 'starting') tasks.delete(oldId);
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
            timeout: null
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
            write(task, { method: 'turn/steer', id: `steer-${Date.now()}`, params: { threadId: task.threadId, expectedTurnId: task.turnId, input: [{ type: 'text', text }] } });
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
        taskById,
        attachSocket,
        sendClientCommand
    };
}

module.exports = { createCodexBridge };
