'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildChatHeat, characterCount, cleanConversationText, heatLevel, shanghaiDate } = require('../chat-heat');

function message(role, content, fullTime) {
    return { role, versions: [{ content, fullTime }], activeVersion: 0 };
}

test('chat heat groups messages by Shanghai day and counts completed conversation rounds', () => {
    const result = buildChatHeat([
        message('user', '晚安', '2026-10-16T15:00:00.000Z'),
        message('assistant', '睡个好觉。', '2026-10-16T15:01:00.000Z'),
        message('user', '还不想睡', '2026-10-16T16:00:00.000Z'),
        message('assistant', '还早，先陪你坐一会儿。', '2026-10-16T16:01:00.000Z'),
        message('user', '那就再说一会儿', '2026-10-16T16:02:00.000Z'),
        message('assistant', '好。', '2026-10-16T16:03:00.000Z'),
        message('user', '只有我说了这句', '2026-10-16T16:04:00.000Z')
    ], { year: 2026 });
    assert.equal(shanghaiDate(Date.parse('2026-10-16T16:01:00.000Z')), '2026-10-17');
    assert.deepEqual(result.days.map(day => [day.date, day.rounds]), [['2026-10-16', 1], ['2026-10-17', 2]]);
    assert.equal(result.days[1].userCharacters, 18);
    assert.equal(result.days[1].level, 1);
});

test('chat heat removes code and logs, caps long pasted text and never returns message content', () => {
    const pasted = `真实的话\n\`\`\`js\n${'const secret = 1;\n'.repeat(200)}\`\`\`\nERROR connection failed`;
    assert.equal(cleanConversationText(pasted), '真实的话');
    assert.equal(characterCount(pasted), 4);
    const result = buildChatHeat([
        message('user', pasted + '\n' + '心'.repeat(900), '2026-10-17T08:00:00Z'),
        message('assistant', '收到', '2026-10-17T08:01:00Z')
    ], { year: 2026 });
    assert.equal(result.days[0].userCharacters, 600);
    assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('many tiny repeated exchanges do not fill the highest heat level by themselves', () => {
    const messages = [];
    for (let index = 0; index < 10; index++) {
        messages.push(message('user', 'OAO', `2026-10-17T08:${String(index * 2).padStart(2, '0')}:00Z`));
        messages.push(message('assistant', '嗯', `2026-10-17T08:${String(index * 2 + 1).padStart(2, '0')}:00Z`));
    }
    const day = buildChatHeat(messages, { year: 2026 }).days[0];
    assert.equal(day.rounds, 10);
    assert.equal(day.level, 1);
});

test('fixed heat thresholds stay separate from presentation code', () => {
    assert.deepEqual([0, 1, 99, 100, 189, 190].map(value => heatLevel(value)), [0, 1, 1, 2, 2, 3]);
});

test('archived transcript time fields are accepted without exposing a separate data path', () => {
    const result = buildChatHeat([
        { role: 'user', content: '原文里的时间', time: '2026-10-17T08:00:00.000Z' },
        { role: 'assistant', content: '收到', time: '2026-10-17T08:01:00.000Z' }
    ], { year: 2026 });
    assert.equal(result.days[0].rounds, 1);
});

test('legacy timestamps without a zone are interpreted as Shanghai wall time', () => {
    const result = buildChatHeat([
        { role: 'user', content: '深夜', time: '2026-03-01T23:59:00.000' },
        { role: 'assistant', content: '还在同一天', time: '2026-03-01T23:59:30.000' }
    ]);
    assert.equal(result.days[0].date, '2026-03-01');
});
