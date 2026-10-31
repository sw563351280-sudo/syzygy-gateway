const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
test('explicit tool settings are idempotent and broadcast confirmed state', () => {
    const handlers = {}, updates = [];
    const state = { mcp: false, toy_enabled: false };
    const context = { Date, Object, console, TOOLS_ENABLED: state,
        saveToolsConfig() {}, wsBroadcast: value => updates.push(structuredClone(value)),
        app: { get: (url, fn) => handlers[url] = fn, post: (url, fn) => handlers[url] = fn } };
    const source = read('server.js');
    vm.runInNewContext(source.slice(source.indexOf('let toolsStateRevision'), source.indexOf("app.post('/trigger-dream'")), context);
    const response = { json(value) { this.body = value; return this; }, status(code) { this.code = code; return this; } };
    for (let i = 0; i < 2; i++) handlers['/api/tools-toggle']({ query: {}, body: { enabled: true } }, response);
    assert.equal(state.mcp, true); assert.equal(state.toy_enabled, true);
    assert.equal(updates.length, 2);
    assert.ok(updates[1].revision > updates[0].revision);
    handlers['/api/tools-toggle']({ query: {}, body: { enabled: 'false' } }, response);
    assert.equal(response.code, 400); assert.equal(state.mcp, true);
});
test('client ignores stale responses and sends the requested value instead of a blind toggle', async () => {
    const toggle = { checked: false, disabled: true }, status = {};
    let release;
    const calls = [];
    const context = { document: { hidden: false, getElementById: id => id === 'toolsMasterToggle' ? toggle : status, addEventListener() {} },
        window: { addEventListener() {} }, setTimeout() {}, setInterval() {}, toast() {},
        ChatPersistence: { requestJson(url, options) {
            calls.push({ url, options });
            return new Promise(resolve => { release = resolve; });
        } } };
    vm.createContext(context);
    const source = read('public/script.js');
    vm.runInContext(source.slice(source.indexOf('let toolsSwitchRevision'), source.indexOf('async function syncMcpTools()')), context);
    const reading = context.refreshToolsSwitch();
    context.applyToolsSwitchState({ tools: { mcp: true, toy_enabled: true }, revision: 20 });
    release({ tools: { mcp: false, toy_enabled: false }, revision: 10 });
    await reading;
    assert.equal(toggle.checked, true); assert.equal(toggle.disabled, false);
    toggle.checked = false;
    const saving = context.toggleAllToolsUI();
    assert.equal(toggle.disabled, true);
    assert.deepEqual(JSON.parse(calls.at(-1).options.body), { enabled: false });
    release({ tools: { mcp: false, toy_enabled: false }, revision: 21 });
    await saving;
    assert.equal(toggle.checked, false); assert.equal(toggle.disabled, false);
    assert.equal(status.textContent, '已关闭');
});
