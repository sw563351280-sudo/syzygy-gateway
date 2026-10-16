'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { recentWorkroomMessages } = require('../workroom-transcripts');
const root = path.resolve(__dirname, '..');
const read = file => process.env.AUDIT_BASELINE === '1' ? execFileSync('git', ['show', (process.env.AUDIT_BASE_REF || '83317fb') + ':' + file], { cwd: root, encoding: 'utf8' }) : fs.readFileSync(path.join(root, file), 'utf8');
const script = read('public/script.js');
const server = read('server.js');

test('startup refuses to run without every required authentication secret', () => {
    const check = server.slice(
        server.indexOf('(function checkEnv()'),
        server.indexOf('// ==========================================', server.indexOf('(function checkEnv()') + 1)
    );
    assert.match(check, /!process\.env\.SITE_PASSWORD/);
    assert.match(check, /!process\.env\.SESSION_SECRET/);
    assert.match(check, /!process\.env\.MEMORY_PASSWORD/);
});

test('home initializes before slow chat sync; completing sync does not reset a newly opened view', async () => {
    const source = script.slice(script.indexOf('async function startSystem()'), script.indexOf('\nstartSystem();'));
    const events = [];
    let finishSync;
    const waiting = new Promise(resolve => { finishSync = resolve; });
    const document = { body: { dataset: {}, classList: { contains: () => true } } };
    const context = vm.createContext({ document, console,
        syncFromCloud: () => { events.push('sync'); return waiting; },
        updateDays: () => events.push('days'), neuInitHome: () => events.push('home'),
        loadFavCache: async () => events.push('favorites'), renderChatMessages: () => events.push('render') });
    vm.runInContext(source, context);
    const started = context.startSystem();
    assert.ok(events.includes('home'), 'home must be populated without waiting for chat data');
    document.body.dataset.view = 'shen-settings';
    finishSync(); await started;
    assert.equal(document.body.dataset.view, 'shen-settings');
});

test('hidden conversation rendering does not touch messages or load link cards', () => {
    const source = script.slice(script.indexOf('function renderChatMessages('), script.indexOf('\nfunction ', script.indexOf('function renderChatMessages(') + 1));
    const context = vm.createContext({ _isStreamingReply: false,
        document: { getElementById: id => {
            if (id === 'sec-chat') return { classList: { contains: () => false } };
            throw Error('Hidden chat queried: ' + id);
        } } });
    vm.runInContext(source, context);
    context.renderChatMessages();
});

test('device requests run only in visible dev panel and do not overlap', async () => {
    const begin = script.includes('let devicePanelRefreshing') ? script.indexOf('let devicePanelRefreshing') : script.indexOf('async function refreshDevicePanel()');
    const source = script.slice(begin, script.indexOf('\nsetInterval(refreshDevicePanel', begin)).replace(/\nrefreshDevicePanel\(\);/, '');
    const document = { hidden: false, body: { dataset: { view: 'home' } } };
    let calls = 0, release;
    const wait = new Promise(resolve => { release = resolve; });
    const context = vm.createContext({ document, syncMcpTools: () => { calls++; return wait; }, refreshToyConnectionStatus: () => { calls++; return wait; } });
    vm.runInContext(source, context);
    const homeRefresh = context.refreshDevicePanel();
    assert.equal(calls, 0);
    await homeRefresh;
    document.body.dataset.view = 'dev'; document.hidden = true;
    await context.refreshDevicePanel(); assert.equal(calls, 0);
    document.hidden = false;
    const first = context.refreshDevicePanel();
    assert.equal(calls, 2);
    await context.refreshDevicePanel(); assert.equal(calls, 2);
    release(); await first;
    await context.refreshDevicePanel(); assert.equal(calls, 4);
});

test('sync GET filters and limits the response without rewriting saved conversations', async () => {
    const messages = Array.from({ length: 120 }, (_, i) => ({ _id: 'm' + i, role: i % 2 ? 'assistant' : 'user', content: 'message ' + i }));
    const stored = JSON.stringify({ chatSessions: [
        { id: 'syzygy-workroom', messages },
        { id: 'main', messages: [{ role: 'assistant', content: '数据加载失败，请刷新页面重试' }, { role: 'user', content: 'keep me' }] }
    ] });
    let saved = stored, response, archived, handler, writes = 0;
    const sharedConfig = JSON.parse(saved);
    const context = { CONFIG_FILE: 'fixture.json', console,
        fs: { existsSync: () => true, readFileSync: () => saved, writeFileSync: (_p, value) => { saved = value; writes++; } },
        workroomTranscriptArchive: { archive: sessions => { archived = JSON.parse(JSON.stringify(sessions)); } },
        webConfigStore: { readShared: async () => sharedConfig, diagnostics: () => ({ signature: 'fixture' }) }, scheduleWorkroomArchive: sessions => { archived = JSON.parse(JSON.stringify(sessions)); },
        recentWorkroomMessages, stripOpenClawInternalContext: v => v,
        contentHasOpenClawInternalContext: () => false, contentHasVisibleText: v => Boolean(String(v).trim()),
        app: { get: (_route, callback) => { handler = callback; } } };
    const begin = server.indexOf('function clientVisibleMessage(');
    vm.runInNewContext(server.slice(begin, server.indexOf("app.get('/api/chat-history/:sessionId'", begin)), context);
    await handler({}, { status() { return this; }, json: value => { response = value; } });
    assert.equal(response.chatSessions[0].messages.length, 100);
    assert.equal(response.chatSessions[1].messages.length, 1);
    assert.equal(archived[0].messages.length, 120);
    assert.equal(sharedConfig.chatSessions[0].messages.length, 120, 'response projection must not trim the shared cache');
    assert.equal(sharedConfig.chatSessions[1].messages.length, 2, 'response filtering must not rewrite the shared cache');
    assert.equal(writes, 0, 'reading data must not persist a trimmed response');
    assert.equal(saved, stored);
});
