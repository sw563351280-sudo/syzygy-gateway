'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildCuratorMessages,
    extractDailyStateUpdates,
    normalizeUpdates,
    shouldCurateMessage,
    shouldCuratePersistentState,
    stripLeakedStateUpdates,
} = require('../daily-state-curator');

test('curator validates confidence, mode, length and duplicate updates', () => {
    const updates = normalizeUpdates({ updates: [
        { key: '晚餐', value: '妈妈做的韭菜馅饼', mode: 'daily', confidence: 0.96 },
        { key: '晚餐', value: '妈妈做的韭菜馅饼', mode: 'daily', confidence: 0.96 },
        { key: '猜测', value: '也许会出门', mode: 'daily', confidence: 0.4 },
        { key: '近期用药', value: '维生素D', mode: 'persistent', life_days: 99, confidence: 0.88 },
    ] });

    assert.deepEqual(updates, [
        { key: '近期用药', value: '维生素D', mode: 'persistent', confidence: 0.88, life_days: 30 },
    ]);
});

test('internal state tags and leaked bare state JSON never reach the visible reply', () => {
    const reply = [
        '你妈做的韭菜馅饼。去吃。',
        '<STATE_UPDATE>{"key":"晚餐","value":"韭菜馅饼","mode":"daily"}</STATE_UPDATE>',
        '{"key":"晚餐","value":"妈妈做的韭菜馅饼","mode":"daily"}',
    ].join('\n');

    assert.equal(stripLeakedStateUpdates(reply), '你妈做的韭菜馅饼。去吃。');
    assert.equal(
        stripLeakedStateUpdates('头发吹了吗。{"key":"晚餐","value":"韭菜馅饼","mode":"daily"}'),
        '头发吹了吗。'
    );
    assert.equal(
        stripLeakedStateUpdates('去吃。\n```json\n{"key":"晚餐","value":"韭菜馅饼","mode":"daily"}\n```'),
        '去吃。'
    );
});

test('curator uses the shared Gemini manager and accepts strict JSON output', async () => {
    let request;
    const fetchImpl = async (url, options) => {
        request = { url, options, body: JSON.parse(options.body) };
        return {
            ok: true,
            status: 200,
            async json() {
                return { choices: [{ message: { content: '```json\n{"updates":[{"key":"近期用药","value":"维生素D","mode":"persistent","confidence":0.94}]}\n```' } }] };
            }
        };
    };

    const updates = await extractDailyStateUpdates({
        fetchImpl,
        apiKey: 'secret',
        userText: '晚上应该吃我妈做的韭菜馅饼。',
        assistantText: '去吃。'
    });

    assert.equal(request.body.model, 'gemini-3.1-pro-preview');
    assert.equal(request.body.response_format.type, 'json_object');
    assert.equal(request.options.headers.Authorization, 'Bearer secret');
    assert.deepEqual(updates.map(({ key, value, mode }) => ({ key, value, mode })), [
        { key: '近期用药', value: '维生素D', mode: 'persistent' }
    ]);
});

test('curator prompt treats only Jiangyu text as a fact source and skips empty chatter', () => {
    const messages = buildCuratorMessages('我晚饭吃了面', '你吃了面。');
    assert.match(messages[0].content, /不把沈望的建议、推断、复述当成新事实/);
    assert.match(messages[1].content, /江鱼本轮原话/);
    assert.equal(shouldCurateMessage('嗯。'), false);
    assert.equal(shouldCurateMessage('我晚饭吃了面'), true);
});

test('persistent-state gate only lets likely ongoing state changes spend a Pro call', () => {
    assert.equal(shouldCuratePersistentState('我最近开始吃维生素D，每天一粒。'), true);
    assert.equal(shouldCuratePersistentState('我现在在追那部剧，准备这周看完。'), true);
    assert.equal(shouldCuratePersistentState('高温假已经开始了。'), true);
    assert.equal(shouldCuratePersistentState('我请假到下周，工作安排改了。'), true);
    assert.equal(shouldCuratePersistentState('今晚吃了妈妈做的韭菜馅饼。'), false);
    assert.equal(shouldCuratePersistentState('我今天好困，想睡觉。'), false);
    assert.equal(shouldCuratePersistentState('我在改 Codex 的记忆库界面。'), false);
});

test('curator retries without response_format for a strict compatibility error', async () => {
    const bodies = [];
    const fetchImpl = async (_url, options) => {
        bodies.push(JSON.parse(options.body));
        if (bodies.length === 1) return { ok: false, status: 422 };
        return {
            ok: true,
            status: 200,
            async json() { return { choices: [{ message: { content: '{"updates":[]}' } }] }; }
        };
    };

    assert.deepEqual(await extractDailyStateUpdates({
        fetchImpl,
        apiKey: 'secret',
        userText: '晚上吃了面',
        assistantText: '知道了。'
    }), []);
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].response_format.type, 'json_object');
    assert.equal(Object.hasOwn(bodies[1], 'response_format'), false);
});
