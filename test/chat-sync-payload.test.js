'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../public/script.js'), 'utf8');
const begin = source.indexOf('async function _doSave()');
const end = source.indexOf('let _savingNow', begin);
function context(size) {
    const state = { chatSessions: [{ id: 'main', messages: [{ _id: 'm1', role: 'user', content: 'x'.repeat(size) }] }],
        _dataVersion: 1, _preservePendingHistory: true, suppliers: [], activeSupIndex: 0, activeChatId: 'main',
        Blob, structuredClone, console: { log() {}, warn() {}, error() {} }, crypto: { randomUUID: () => 'unused' },
        _hasDirtyFallbackState: () => false, ContextContinuity: { ensureMessageIds() {} }, cleanupOldImages() {},
        _stripOldestImgRound: () => false, _countImgRounds: () => 0, historyWindowsForPayload: () => ({}),
        _chatJournal: { acknowledge() {}, hasPending: () => false }, _loopCount: 0, _loopLocalOnly: 0,
        ChatPersistence: { async requestJson(url, options) { state.sent = JSON.parse(options.body); return { success: true, _version: 2 }; } } };
    vm.createContext(state);
    vm.runInContext(source.slice(begin, end), state);
    return state;
}
test('a text-only payload above the old 3 MB cap is actually saved and acknowledged', async () => {
    const state = context(4 * 1024 * 1024);
    await vm.runInContext('_doSave()', state);
    assert.equal(state.sent.chatSessions[0].messages[0].content, state.chatSessions[0].messages[0].content);
    assert.equal(state._dataVersion, 2);
});
test('a genuine oversized payload reports data size without falsely blaming an image', async () => {
    const state = context(16 * 1024 * 1024);
    await assert.rejects(vm.runInContext('_doSave()', state), error => /超过 15 MB/.test(error.message) && !/最新图片/.test(error.message));
    assert.equal(state.sent, undefined);
    assert.equal(state.chatSessions[0].messages[0].content.length, 16 * 1024 * 1024);
});
