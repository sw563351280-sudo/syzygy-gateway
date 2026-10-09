'use strict';
const { stableToolSchema } = require('./tool-schema-cache');
const nameOf = tool => tool.function?.name || tool.name;
function createCachedToolPolicy(available, selected) {
    const catalogue = available.map(({ _mcp, ...tool }) => tool);
    const availableNames = new Set(catalogue.map(nameOf));
    const allowed = new Set(selected.map(nameOf).filter(name => availableNames.has(name)));
    return {
        tools: stableToolSchema(catalogue),
        allows: name => allowed.has(name),
        hint: '【本轮工具调用范围】\n本轮仅允许调用：' + ([...allowed].sort().join('、') || '无（无需调用工具）')
            + '。工具目录中的其他定义不代表本轮调用授权，不得调用。',
    };
}
function appendToolHint(message, policy) {
    if (!policy) return;
    message.content = Array.isArray(message.content)
        ? [...message.content, { type: 'text', text: policy.hint }]
        : String(message.content || '') + '\n\n' + policy.hint;
}
async function executeAllowedTool(policy, name, execute) {
    if (policy && !policy.allows(name)) return '[工具未执行：该工具不在本轮允许的调用范围内。请使用允许的工具或直接回答。]';
    return execute();
}
module.exports = { createCachedToolPolicy, appendToolHint, executeAllowedTool };
