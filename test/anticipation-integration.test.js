'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const anticipation = require('../anticipation');

test('server action tags store antecedents and deliver them through the wake adapter', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    let stored = [];
    const sandbox = {
        ...anticipation, formatCareForWake: anticipation.formatAnticipationForWake,
        loadAnticipations: () => JSON.parse(JSON.stringify(stored)),
        saveAnticipations: items => { stored = JSON.parse(JSON.stringify(items)); },
        loadCrumbs: () => [], armAnticipationWake: () => {},
        extractAndProcessTodoTags: x => x, processPrivateJournalTags: x => x,
        console: { log: () => {} },
    };
    vm.createContext(sandbox);
    // Run the real server adapter without starting the app or reading production data.
    vm.runInContext(source.slice(source.indexOf('function addAnticipation(input)'), source.indexOf('function getDueAnticipation(')), sandbox);
    const text = '记着了。<ANTICIPATION entity="小说" due="tomorrow">明天问她那个东西买了吗</ANTICIPATION>';
    const sourceContext = { userText: '今天没买到，要等新版本到店。', sourceTexts: ['我想找的那本小说只有旧版。', '今天没买到，要等新版本到店。'], sourceRef: { message_id: 'turn', at: '2026-10-09T02:00:00Z' } };
    assert.equal(sandbox.processAssistantActionTags(text, sourceContext), '记着了。');
    assert.equal(stored.length, 1);
    assert.match(sandbox.formatAnticipationForWake(stored[0]), /那本小说只有旧版/);
    assert.equal(stored[0].source_message_id, 'turn');
    // A short old record can be repaired by a repeated tag without losing its clock/status.
    stored[0].context = ''; stored[0].source_quote = '';
    const due = stored[0].due_at;
    sandbox.processAssistantActionTags(text, sourceContext);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].due_at, due);
    assert.match(stored[0].context, /新版本到店/);
});
