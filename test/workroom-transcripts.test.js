'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWorkroomTranscriptArchive, groupWorkroomTurns, recentWorkroomMessages } = require('../workroom-transcripts');

function message(id, role, content, speaker, fullTime = '2026-09-29T12:00:00.000Z') {
    return { _id: id, role, speaker, versions: [{ content, fullTime }], activeVersion: 0 };
}

test('workroom transcript groups complete rounds and omits image payloads', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workroom-transcripts-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const user = message('u1', 'user', '一起想想', 'jiangyu');
    user.workroomTarget = 'all';
    user.versions[0].images = ['data:image/png;base64,secret'];
    const room = { id: 'syzygy-workroom', messages: [
        user,
        message('s1', 'assistant', '我先说', 'shenwang'),
        message('c1', 'assistant', '我也在', 'codex')
    ] };
    const turns = groupWorkroomTurns(room.messages);
    assert.equal(turns.length, 1);
    assert.deepEqual(turns[0].messages.map(row => row.speaker), ['jiangyu', 'shenwang', 'codex']);
    assert.equal(turns[0].messages[0].attachments[0].source, 'web-config');
    assert.doesNotMatch(JSON.stringify(turns), /base64|secret/);

    const archive = createWorkroomTranscriptArchive(directory);
    archive.archive([room]);
    room.messages.push(message('c2', 'assistant', '补充一句', 'codex'));
    archive.archive([room]);
    const files = fs.readdirSync(path.join(directory, '2026', '09'));
    assert.deepEqual(files, ['2026-09-29.json']);
    const saved = JSON.parse(fs.readFileSync(path.join(directory, '2026', '09', files[0]), 'utf8'));
    assert.equal(saved.length, 1);
    assert.equal(saved[0].messages.length, 4);
});

test('browser workroom history is trimmed on complete round boundaries', () => {
    const messages = [];
    for (let round = 1; round <= 52; round++) {
        messages.push(message('u' + round, 'user', '问' + round, 'jiangyu'));
        messages.push(message('c' + round, 'assistant', '答' + round, 'codex'));
    }
    const recent = recentWorkroomMessages(messages, 50);
    assert.equal(recent.length, 100);
    assert.equal(recent[0].id || recent[0]._id, 'u3');
    assert.equal(recent.at(-1).id || recent.at(-1)._id, 'c52');
});
