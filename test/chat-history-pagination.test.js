'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DEFAULT_PAGE_SIZE, historyPage, mergePartialSession } = require('../chat-history');

const message = index => ({ _id: 'm' + index, role: index % 2 ? 'assistant' : 'user', content: 'message ' + index });

test('history pages walk backwards without overlap or gaps', () => {
    const messages = Array.from({ length: 240 }, (_, index) => message(index));
    const newest = historyPage(messages, messages.length, 80);
    const middle = historyPage(messages, newest.start, 80);
    const oldest = historyPage(messages, middle.start, 80);
    assert.deepEqual([newest.start, newest.end, newest.total, newest.hasMore], [160, 240, 240, true]);
    assert.deepEqual([middle.start, middle.end, middle.hasMore], [80, 160, true]);
    assert.deepEqual([oldest.start, oldest.end, oldest.hasMore], [0, 80, false]);
    assert.deepEqual([...oldest.messages, ...middle.messages, ...newest.messages].map(row => row._id), messages.map(row => row._id));
    assert.equal(historyPage(messages, 240, 999).messages.length, 240);
    assert.equal(DEFAULT_PAGE_SIZE, 120);
});

test('partial save preserves unloaded prefix and rejects a shifted boundary', () => {
    const existing = { id: 'main', messages: Array.from({ length: 200 }, (_, index) => message(index)) };
    const incoming = { id: 'main', messages: [...existing.messages.slice(120), message(200)] };
    incoming.messages.at(-2).content = 'edited recent message';
    const merged = mergePartialSession(existing, incoming, { start: 120, partial: true });
    assert.equal(merged.messages.length, 201);
    assert.equal(merged.messages[0]._id, 'm0');
    assert.equal(merged.messages[119]._id, 'm119');
    assert.equal(merged.messages[199].content, 'edited recent message');
    assert.equal(merged.messages[200]._id, 'm200');
    assert.throws(() => mergePartialSession(existing, { id: 'main', messages: [message(121)] }, { start: 120, partial: true }), /重新同步/);
    assert.throws(() => mergePartialSession(existing, incoming, { start: 999, partial: true }), /重新同步/);
});

test('real sync endpoints page main history and merge a versioned partial save', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const begin = source.indexOf("const CONFIG_FILE = path.join(DATA_DIR, 'web_config.json')");
    const end = source.indexOf("app.get('/api/user-state'", begin);
    const handlers = new Map();
    let stored = JSON.stringify({ _version: 7, suppliers: [], activeChatId: 'main', chatSessions: [
        { id: 'main', name: '主频道', messages: Array.from({ length: 240 }, (_, index) => message(index)) }
    ] });
    const app = {
        get(route, handler) { handlers.set('GET ' + route, handler); },
        post(route, handler) { handlers.set('POST ' + route, handler); }
    };
    const context = {
        app, DATA_DIR: '.', path: { join: () => 'fixture.json' }, console, structuredClone,
        fs: {
            existsSync: () => true,
            readFileSync: () => stored,
            writeFileSync: (_file, value) => { stored = value; },
            statSync: () => ({ size: stored.length })
        },
        historyPage, mergePartialSession, DEFAULT_PAGE_SIZE,
        workroomTranscriptArchive: { archive() {} }, recentWorkroomMessages: rows => rows,
        stripOpenClawInternalContext: value => value, sanitizeOpenClawContent: value => value,
        contentHasOpenClawInternalContext: () => false, contentHasVisibleText: value => Boolean(String(value).trim())
    };
    vm.runInNewContext(source.slice(begin, end), context);
    function response() {
        return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
    }
    const sync = response();
    handlers.get('GET /api/sync-config')({ query: { mainLimit: '80' } }, sync);
    const main = sync.body.chatSessions[0];
    assert.equal(main.messages.length, 80);
    assert.equal(main.messages[0]._id, 'm160');
    assert.deepEqual(JSON.parse(JSON.stringify(sync.body._historyWindows.main)), { start: 160, total: 240, hasMore: true, partial: true });

    const older = response();
    handlers.get('GET /api/chat-history/:sessionId')({ params: { sessionId: 'main' }, query: { before: '160', limit: '80' } }, older);
    assert.equal(older.body.messages[0]._id, 'm80');
    assert.equal(older.body.messages.at(-1)._id, 'm159');

    const save = response();
    handlers.get('POST /api/sync-config')({ body: {
        _version: 7, suppliers: [], activeChatId: 'main', activeSupIndex: 0,
        _historyWindows: { main: { start: 160, partial: true } },
        chatSessions: [{ ...main, messages: [...main.messages, message(240)] }]
    }, headers: {}, ip: 'test' }, save);
    assert.equal(save.body.success, true);
    const persisted = JSON.parse(stored);
    assert.equal(persisted.chatSessions[0].messages.length, 241);
    assert.equal(persisted.chatSessions[0].messages[0]._id, 'm0');
    assert.equal(persisted.chatSessions[0].messages.at(-1)._id, 'm240');

    const stale = response();
    handlers.get('POST /api/sync-config')({ body: {
        _version: 7, _historyWindows: { main: { start: 160, partial: true } }, chatSessions: [{ ...main }]
    }, headers: {}, ip: 'test' }, stale);
    assert.equal(stale.body._rejected, true);
    assert.equal(JSON.parse(stored).chatSessions[0].messages.length, 241);
});

test('frontend save metadata follows messages omitted by the cloud cap', () => {
    const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'script.js'), 'utf8');
    const begin = script.indexOf('function historyWindowsForPayload(');
    const end = script.indexOf('\nfunction ensureWorkroomSession', begin);
    const chatSessions = [{ id: 'main', messages: Array.from({ length: 240 }, (_, index) => message(index)) }];
    const context = { _historyWindows: { main: { start: 0, total: 240 } }, chatSessions };
    vm.runInNewContext(script.slice(begin, end), context);
    const clone = [{ id: 'main', messages: chatSessions[0].messages.slice(-200) }];
    assert.deepEqual(JSON.parse(JSON.stringify(context.historyWindowsForPayload(clone))), {
        main: { start: 40, total: 240, partial: true }
    });
});
