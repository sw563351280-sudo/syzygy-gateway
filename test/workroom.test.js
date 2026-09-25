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
        saveToCloud() {}, renderChatMessages() {}, toast() {}, renderMarkdown: text => text,
        location: { protocol: 'https:', host: 'example.test' }, WebSocket: Socket,
        setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {}
    });
    vm.runInContext(section, context);
    return { room, context, sockets, timers, run: code => vm.runInContext(code, context) };
}

test('Codex avatar is distinct and has an accessible label', () => {
    const { run } = setup();
    assert.match(run("workroomSpeakerHTML('codex')"), /aria-label="Codex 头像"/);
    assert.match(run("workroomSpeakerHTML('codex')"), /&gt;_/);
    assert.doesNotMatch(run("workroomSpeakerHTML('shenwang')"), /workroom-codex-avatar/);
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
