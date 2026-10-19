'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../public/script.js'), 'utf8');

test('history loading unlocks after a failed bounded request and permits another attempt', async () => {
    let rejectRequest, requests = 0;
    const session = { id: 'main', messages: [] };
    const context = vm.createContext({
        _historyLoading: false, _isStreamingReply: false, _visibleMessageCounts: {},
        _historyWindows: { main: { hasMore: true, start: 200 } }, CHAT_HISTORY_PAGE_SIZE: 80,
        document: { body: { dataset: { view: 'chat' } } },
        getActiveSession: () => session, isWorkroomSession: () => false,
        ChatPersistence: { requestJson() { requests++; return new Promise((_, reject) => { rejectRequest = reject; }); } },
        console: { error() {} }, toast() {}
    });
    vm.runInContext(source.slice(source.indexOf('async function revealEarlierChatMessages()'), source.indexOf('function captureChatScrollAnchor(')), context);
    const first = context.revealEarlierChatMessages();
    await context.revealEarlierChatMessages();
    assert.equal(requests, 1);
    rejectRequest(new Error('timeout'));
    await first;
    assert.equal(context._historyLoading, false);
    const second = context.revealEarlierChatMessages();
    assert.equal(requests, 2);
    rejectRequest(new Error('timeout'));
    await second;
    assert.equal(context._historyLoading, false);
});
