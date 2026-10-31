const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { keepRequestedReadTools } = require('../tool-policy');
const { createCachedToolPolicy } = require('../cached-tool-policy');
const names = ['toy_vibrate', 'toy_suction', 'toy_stop_vibration', 'toy_stop_suction', 'toy_stop_all', 'toy_status'];
const tools = names.map(name => ({ type: 'function', function: { name, parameters: { type: 'object', properties: {} } }, _mcp: 'toy' }));
function setup(flags) {
    const source = fs.readFileSync(require.resolve('../server'), 'utf8');
    const context = vm.createContext({ TOOLS_ENABLED: flags, ALWAYS_AVAILABLE_TOOLS: new Set(), MUSIC_TOOL_NAMES: [],
        TOY_TOOLS: new Set(names), CODE_TOOLS: new Set(), hasProjectFileIntent: () => false,
        isExplicitHealthDataRequest: () => false, console: { log() {} } });
    vm.runInContext(source.slice(source.indexOf('function filterRelevantTools('), source.indexOf('// MCP Server 配置：')), context);
    return context.filterRelevantTools;
}
test('all enabled device tools remain available for natural follow-ups and ordinary conversation', () => {
    const filter = setup({ mcp: true, toy_enabled: true });
    for (const text of ['嗯', '爸爸试着开启一下先？', '轻一点', '停', '今天有点冷', '检查啵啵贝的连接状态']) {
        const selected = keepRequestedReadTools(filter(tools, text, null), text);
        assert.deepEqual(Array.from(selected, tool => tool.function.name), names);
        const policy = createCachedToolPolicy(tools, selected);
        for (const name of names) assert.equal(policy.allows(name), true, `${text}: ${name}`);
    }
});
test('device and MCP off switches still exclude all device tools', () => {
    for (const flags of [{ mcp: false, toy_enabled: true }, { mcp: true, toy_enabled: false }]) {
        const selected = setup(flags)(tools, '开启啵啵贝震动', null);
        assert.equal(selected.length, 0);
    }
});
