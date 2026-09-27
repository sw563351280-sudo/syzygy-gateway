const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../public/script.js'), 'utf8');
const section = source.slice(source.indexOf('let workroomCodexSocket ='), source.indexOf('// ==================== 供应商与模型库'));

function setup() {
    const room = { codexTaskId: 'task-1', messages: [], codexLastTurnId: null };
    const sockets = [];
    const timers = [];
    class Socket {
        constructor() { this.sent = []; sockets.push(this); }
        send(value) { this.sent.push(JSON.parse(value)); }
        close() {}
    }
    const context = vm.createContext({
        console, crypto: require('node:crypto'), WORKROOM_ID: 'room', activeChatId: 'main',
        ensureWorkroomSession: () => room, document: { getElementById: () => null },
        getActiveVersion: message => message.versions?.[0] || message,
        saveToCloud() {}, renderChatMessages() {}, toast() {}, renderMarkdown: text => text,
        location: { protocol: 'https:', host: 'example.test' }, WebSocket: Socket,
        setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {}
    });
    vm.runInContext(section, context);
    return { room, context, sockets, timers, run: code => vm.runInContext(code, context) };
}

test('status light tracks running snapshots and turns off when completed', () => {
    const { context } = setup();
    const label = { textContent: '' };
    let lit = false;
    const bar = { classList: { toggle(_name, active) { lit = active; } } };
    context.document.getElementById = id => ({ workroomCodexStatus: label, workroomCodexBar: bar })[id] || null;
    context.workroomHandleCodexMessage({ type: 'codex_snapshot', task: { id: 'task-1', status: 'running' }, events: [] });
    assert.equal(lit, true);
    assert.match(label.textContent, /正在工作/);
    context.workroomHandleCodexMessage({ type: 'codex_snapshot', task: { id: 'task-1', status: 'completed' }, events: [] });
    assert.equal(lit, false);
    assert.match(label.textContent, /待命/);
});

test('Codex avatar is distinct and has an accessible label', () => {
    const { run } = setup();
    assert.match(run("workroomSpeakerHTML('codex')"), /aria-label="Codex 头像"/);
    assert.match(run("workroomSpeakerHTML('codex')"), /&gt;_/);
    assert.doesNotMatch(run("workroomSpeakerHTML('shenwang')"), /workroom-codex-avatar/);
});
test('recipient selection and mentions are independent of execute permission', () => {
    const { context } = setup();
    assert.equal(context.workroomRecipientFor('你好', 'shenwang'), 'shenwang');
    assert.equal(context.workroomRecipientFor('@Codex 你觉得呢', 'all'), 'codex');
    assert.equal(context.workroomRecipientFor('@沈望 看看', 'codex'), 'shenwang');
    assert.equal(context.workroomRecipientFor('就这么改吧', 'all'), 'all');
    assert.equal(context.workroomRecipientFor('执行', 'shenwang', true), 'codex');
});
test('sending only to Codex bypasses Shenwang and needs no chat provider', async () => {
    const { context, room, run } = setup();
    const elements = {
        chatInput: { value: '@Codex 这段逻辑对吗' },
        workroomRecipient: { value: 'all' },
        chatWindow: { appendChild() {}, scrollHeight: 0, scrollTop: 0 }
    };
    context.document = { getElementById: id => elements[id] || null, createElement: () => ({ innerHTML: '', appendChild() {} }) };
    context._isStreamingReply = false;
    context.getActiveSession = () => room;
    context.isWorkroomSession = () => true;
    context.currentImgBase64List = [];
    context.clearImage = () => {};
    context.flushDirtyToZep = () => { throw new Error('should not touch Shenwang'); };
    context.suppliers = []; // a direct Codex question must not require a Shenwang supplier
    const calls = [];
    context.workroomDispatchToCodex = async (...args) => calls.push(args);
    const sendSource = source.slice(source.indexOf('async function sendChat(options = {})'), source.indexOf('// ==================== 江鱼 · 沈望 · Codex 共创工作区'));
    vm.runInContext(sendSource, context);
    await context.sendChat();
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], '@Codex 这段逻辑对吗');
    assert.equal(calls[0][3], false);
    assert.equal(room.messages[0].workroomTarget, 'codex');
    assert.equal(run('workroomSending'), false);
});
test('normal dispatch always creates read-only tasks even after an execution task', async () => {
    const { context, room } = setup();
    room.messages.push({ role: 'assistant', speaker: 'shenwang', content: '先确认方案' });
    const requests = [];
    context.fetch = async (_url, options = {}) => {
        if (options.method === 'POST') {
            requests.push(JSON.parse(options.body));
            return { ok: true, json: async () => ({ task: { id: 'fresh', status: 'starting' } }) };
        }
        return { ok: true, json: async () => ({ tasks: [{ id: 'task-1', mode: 'workspaceWrite', status: 'completed' }] }) };
    };
    await context.workroomDispatchToCodex('就这么改吧', '', []);
    assert.equal(requests[0].mode, 'readOnly');
    assert.equal(requests[0].workroomAction, 'discuss');
    assert.match(requests[0].prompt, /本轮仅讨论/);
    assert.match(requests[0].prompt, /先确认方案/);
    await context.workroomDispatchToCodex('把按钮改蓝', '', [], true);
    assert.equal(requests[1].mode, 'workspaceWrite');
    assert.equal(requests[1].workroomAction, 'execute');
});
test('structured work records are hidden from live and saved chat text', () => {
    const { run } = setup();
    assert.equal(run("workroomVisibleReply('完成。<work_record>{\"title\":\"修复\"}</work_record>')"), '完成。');
    assert.equal(run("workroomVisibleReply('完成。<work_record>{')"), '完成。');
});

test('snapshot replay is idempotent and uses stable message IDs', () => {
    const { room, context } = setup();
    const snapshot = { type: 'codex_snapshot', task: { id: 'task-1' }, reply: { turnId: 'turn-1', text: '完成', status: 'completed' } };
    context.workroomHandleCodexMessage(snapshot);
    context.workroomHandleCodexMessage(snapshot);
    assert.equal(room.messages.length, 1);
    assert.equal(room.messages[0]._id, 'codex:task-1:turn-1');
    room.codexLastTurnId = null;
    context.workroomHandleCodexMessage(snapshot);
    assert.equal(room.messages.length, 1);
});

test('legacy snapshots do not replay an older turn when latest is already saved', () => {
    const { room, context } = setup();
    room.codexLastTurnId = 'latest';
    context.workroomHandleCodexMessage({ type: 'codex_snapshot', task: { status: 'completed' }, events: [
        { method: 'codex/started', params: { turnId: 'old' } },
        { method: 'item/agentMessage/delta', params: { delta: '旧消息' } },
        { method: 'turn/completed', params: {} },
        { method: 'codex/started', params: { turnId: 'latest' } },
        { method: 'turn/completed', params: {} }
    ] });
    assert.equal(room.messages.length, 0);
});

test('connected bubble cannot be updated in the private chat', () => {
    const { run } = setup();
    run('workroomCodexLiveBubble = { isConnected: true }');
    assert.equal(run('workroomEnsureLiveBubble()'), null);
});

test('stale sockets are ignored and followup waits for fresh snapshot', () => {
    const { context, sockets, room } = setup();
    context.workroomConnectCodex('task-1');
    context.workroomConnectCodex('task-1', true, { text: '继续' }, 'running');
    sockets[1].onopen();
    assert.equal(sockets[1].sent.length, 0);
    sockets[0].onmessage({ data: JSON.stringify({ type: 'codex_error', error: 'stale' }) });
    assert.equal(room.messages.length, 0);
    sockets[1].onmessage({ data: JSON.stringify({ type: 'codex_snapshot', task: { status: 'completed' }, events: [] }) });
    assert.equal(sockets[1].sent[0].type, 'followup');
    sockets[1].onmessage({ data: JSON.stringify({ type: 'codex_snapshot', task: { status: 'completed' }, events: [] }) });
    assert.equal(sockets[1].sent.length, 1);
});

test('approval queue retains concurrent requests, including ID zero', () => {
    const { context, run } = setup();
    context.workroomShowApproval({ params: { requestId: 0 } });
    context.workroomShowApproval({ params: { requestId: 1 } });
    assert.equal(run('workroomCodexApprovalId'), 0);
    context.workroomHandleCodexEvent({ method: 'codex/approval-resolved', params: { requestId: 0 } });
    assert.equal(run('workroomCodexApprovalId'), 1);
});

test('unexpected close schedules reconnect without resubmitting a sent command', () => {
    const { context, sockets, timers } = setup();
    context.workroomConnectCodex('task-1');
    sockets[0].onclose({ code: 1006 });
    assert.equal(timers.length, 1);
    timers[0]();
    assert.equal(sockets.length, 2);
});
