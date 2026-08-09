'use strict';

function normalizeTodo(todo) {
    const item = todo && typeof todo === 'object' ? todo : {};
    const id = String(item.id || '');
    const rawOwner = String(item.owner || item.author || '').toLowerCase();
    const owner = rawOwner === 'shen' || rawOwner === 'assistant' || rawOwner === '沈望' || id.startsWith('shen_')
        ? 'shen'
        : 'fish';

    return {
        ...item,
        id,
        text: String(item.text || item.task || item.title || '').trim(),
        owner,
        done: Boolean(item.done)
    };
}

function normalizeTodos(items) {
    return Array.isArray(items)
        ? items.map(normalizeTodo).filter(item => item.id && item.text)
        : [];
}

function partitionActiveTodos(items) {
    const active = normalizeTodos(items).filter(item => !item.done);
    return {
        active,
        shen: active.filter(item => item.owner === 'shen'),
        fish: active.filter(item => item.owner === 'fish')
    };
}

function buildTodoPrompt(items) {
    const { shen, fish } = partitionActiveTodos(items);
    const lines = ['【共享待办列表 · 未完成】', '沈望写的：'];
    if (shen.length) {
        for (const item of shen) lines.push(`  ○ [${item.id}] ${item.text}`);
    } else {
        lines.push('  （暂无）');
    }
    lines.push('江鱼写的：');
    if (fish.length) {
        for (const item of fish) lines.push(`  ○ [${item.id}] ${item.text}`);
    } else {
        lines.push('  （暂无）');
    }
    lines.push(
        '待办规则：',
        '- 当你（沈望）决定稍后要做、要跟进或要提醒自己的具体事项时，必须在回复末尾追加 <ADD_TODO>事项</ADD_TODO>。',
        '- 这是沈望自己的行动清单；不要把普通闲聊、永久记忆或江鱼已经写入的事项重复添加。',
        '- 完成已有事项时，用 <DONE_TODO id="对应ID"/>。标签只供后台处理，不要向江鱼解释标签。'
    );
    return '\n\n' + lines.join('\n');
}

module.exports = { normalizeTodo, normalizeTodos, partitionActiveTodos, buildTodoPrompt };
