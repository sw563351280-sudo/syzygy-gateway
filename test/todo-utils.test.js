'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTodos, partitionActiveTodos, buildTodoPrompt } = require('../todo-utils');

test('legacy todo owners are inferred without hiding items', () => {
    const todos = normalizeTodos([
        { id: 'shen_abc', title: '记得回来看结果' },
        { id: 'fish_def', task: '买牛奶' },
        { id: 'legacy_fish', text: '整理照片', owner: 'fish' },
        { id: 'shen_done', text: '已经完成', done: true }
    ]);
    const groups = partitionActiveTodos(todos);

    assert.deepEqual(groups.shen.map(item => item.text), ['记得回来看结果']);
    assert.deepEqual(groups.fish.map(item => item.text), ['买牛奶', '整理照片']);
    assert.equal(groups.active.length, 3);
});

test('empty todo list still teaches Shen how to create the first item', () => {
    const prompt = buildTodoPrompt([]);

    assert.match(prompt, /沈望写的：\n  （暂无）/);
    assert.match(prompt, /江鱼写的：\n  （暂无）/);
    assert.match(prompt, /必须.*<ADD_TODO>事项<\/ADD_TODO>/);
    assert.match(prompt, /<DONE_TODO id="对应ID"\/>/);
});

test('todo prompt keeps Shen and Jiangyu entries separate', () => {
    const prompt = buildTodoPrompt([
        { id: 'shen_one', text: '检查部署', owner: 'shen' },
        { id: 'fish_one', text: '写日报', owner: 'fish' }
    ]);

    assert.match(prompt, /沈望写的：[\s\S]*\[shen_one\] 检查部署/);
    assert.match(prompt, /江鱼写的：[\s\S]*\[fish_one\] 写日报/);
});
