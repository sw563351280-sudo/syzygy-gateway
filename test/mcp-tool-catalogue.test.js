const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
test('repeated discovery never mutates the shared catalogue or retains disconnected tools', async () => {
    const tool = (name, server) => ({ function: { name }, _mcp: server });
    const xhs = Object.freeze([tool('xhs_list_feeds', 'xhs')]);
    const connections = new Map([['toy', { tools: [tool('toy_status', 'toy'), tool('toy_vibrate', 'toy'), tool('toy_status', 'toy')] }]]);
    const context = vm.createContext({ xhsMcp: { tools: async () => xhs }, mcpConnections: connections });
    const source = fs.readFileSync(require.resolve('../server'), 'utf8');
    vm.runInContext(source.slice(source.indexOf('async function getAllMCPTools()'), source.indexOf('async function callMCPTool(')), context);
    for (let i = 0; i < 20; i++) {
        const result = await context.getAllMCPTools();
        assert.deepEqual(Array.from(result, t => t.function.name), ['xhs_list_feeds', 'toy_status', 'toy_vibrate']);
        result.push(tool('injected', 'toy'));
    }
    assert.equal(xhs.length, 1);
    connections.delete('toy');
    assert.deepEqual(Array.from(await context.getAllMCPTools(), t => t.function.name), ['xhs_list_feeds']);
});
