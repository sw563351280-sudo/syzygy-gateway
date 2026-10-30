'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { append, eligibleMessages, lastBridgeCursor } = require('../public/workroom-history-bridge');

function message(id, role, content, speaker, extra = {}) {
    return {
        _id: id,
        role,
        ...(speaker ? { speaker } : {}),
        ...extra,
        versions: [{ content, fullTime: '2026-10-30T10:00:00.000Z' }],
        activeVersion: 0
    };
}

test('selects complete turns where Shenwang participated and keeps Jiangyu, Shenwang and TT', () => {
    const workroom = [
        message('m1', 'user', '只问 TT', 'jiangyu', { workroomTarget: 'codex' }),
        message('m2', 'assistant', 'TT 私下回答', 'codex'),
        message('m3', 'user', '三个人一起聊', 'jiangyu', { workroomTarget: 'all' }),
        message('m4', 'assistant', '沈望回答', 'shenwang'),
        message('m5', 'assistant', 'TT 补充', 'codex'),
        message('m6', 'user', '只找沈望', 'jiangyu', { workroomTarget: 'shenwang' }),
        message('m7', 'assistant', '我在', 'shenwang')
    ];
    assert.deepEqual(eligibleMessages(workroom).map(item => item._id), ['m3', 'm4', 'm5', 'm6', 'm7']);
});

test('strips execution turns before bridging even if they contain a Shenwang message', () => {
    const workroom = [
        message('u1', 'user', '聊天室桥接怎么做', 'jiangyu', { workroomTarget: 'all' }),
        message('s1', 'assistant', '可以这样做', 'shenwang'),
        message('c1', 'assistant', '我补充一个边界', 'codex'),
        message('u2', 'user', '就这么改  ✦ TT开工', 'jiangyu', { workroomTarget: 'codex' }),
        message('s2', 'assistant', '旧数据里意外混入的沈望话', 'shenwang'),
        message('c2', 'assistant', '正在检查和修改代码', 'codex'),
        message('u3', 'user', '再修一下', 'jiangyu', { workroomTarget: 'codex', workroomAction: 'execute' }),
        message('s3', 'assistant', '也不应该被桥接', 'shenwang'),
        message('c3', 'assistant', '正在跑测试', 'codex')
    ];
    assert.deepEqual(eligibleMessages(workroom).map(item => item._id), ['u1', 's1', 'c1']);
});

test('appends the latest ten original messages once and advances the stable cursor', () => {
    const workroom = { messages: [] };
    for (let index = 1; index <= 6; index++) {
        workroom.messages.push(message(`u${index}`, 'user', `江鱼原话 ${index}`, 'jiangyu', { workroomTarget: 'all' }));
        workroom.messages.push(message(`s${index}`, 'assistant', `沈望原话 ${index}`, 'shenwang'));
        workroom.messages.push(message(`c${index}`, 'assistant', `TT 原话 ${index}`, 'codex'));
    }
    const main = { id: 'main', messages: [] };
    const first = append(workroom, main, {
        limit: 10,
        now: () => new Date('2026-10-30T12:00:00.000Z'),
        idFactory: () => 'first'
    });
    assert.equal(first._id, 'workroom-bridge:first');
    assert.deepEqual(first._workroomBridge.sourceMessageIds, ['c3', 'u4', 's4', 'c4', 'u5', 's5', 'c5', 'u6', 's6', 'c6']);
    assert.equal(main.workroomBridgeLastMessageId, 'c6');
    assert.equal(lastBridgeCursor(main), 'c6');
    assert.doesNotMatch(first.versions[0].content, /江鱼原话 1|沈望原话 2/);
    assert.match(first.versions[0].content, /\[江鱼\]\n江鱼原话 4/);
    assert.match(first.versions[0].content, /\[沈望\]\n沈望原话 6/);
    assert.match(first.versions[0].content, /\[TT\]\nTT 原话 6/);
    assert.equal(append(workroom, main, { idFactory: () => 'duplicate' }), null);
    assert.equal(main.messages.length, 1);

    workroom.messages.push(message('u7', 'user', '新一轮', 'jiangyu', { workroomTarget: 'all' }));
    workroom.messages.push(message('s7', 'assistant', '新的沈望回答', 'shenwang'));
    const second = append(workroom, main, { idFactory: () => 'second' });
    assert.equal(second._workroomBridge.lastMessageId, 's7');
    assert.equal(main.messages.length, 2);
});

test('uses the session cursor even when the earlier bridge message is outside the loaded history page', () => {
    const workroom = { messages: [
        message('u1', 'user', '问题', 'jiangyu'),
        message('s1', 'assistant', '回答', 'shenwang')
    ] };
    const main = { id: 'main', workroomBridgeLastMessageId: 's1', messages: [] };
    assert.equal(append(workroom, main, { idFactory: () => 'unused' }), null);
});
