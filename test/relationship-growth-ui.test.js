'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require.resolve('../public/relationship-growth.html'), 'utf8');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
function element() { return { textContent: '', innerHTML: '', value: '20', classList: { toggle() {} }, style: {} }; }
async function setup() {
    const nodes = Object.fromEntries(['backLink','temperatureState','realityCount','episodeCount','insightCount','notice','content','relationshipOrganizeBtn','realityOrganizeBtn','organizeStatus','limitInput','toast','realityTab','episodeTab','temperatureTab','insightTab'].map(id => [id, element()]));
    const data = {
        reality_events: [
            { title: '旧卡片', updated_at: '2026-01-01', status: 'completed', milestones: [] },
            { title: '新卡片', updated_at: '2026-03-01', status: 'active', milestones: [
                { summary: '旧进展', occurred_at: '2026-01-01', stage: 'beginning' },
                { summary: '新进展', occurred_at: '2026-02-01', stage: 'progress' }
            ] }
        ],
        episodes: [
            { title: '旧相处', updated_at: '2026-01-01', status: 'resolved', events: [] },
            { title: '新相处', updated_at: '2026-04-01', status: 'open', events: [
                { summary: '先前', occurred_at: '2026-02-01' }, { summary: '最近', occurred_at: '2026-03-01' }
            ] }
        ], insights: [], temperature_events: [], stats: {}, backfill: {}, reality_backfill: {}
    };
    const context = vm.createContext({ ...nodes, console, URLSearchParams, confirm: () => false,
        location: { search: '' }, localStorage: { getItem: () => '' }, setTimeout: fn => { fn(); return 1; }, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
        fetch: async () => ({ ok: true, json: async () => data }) });
    vm.runInContext(script, context);
    await new Promise(resolve => setImmediate(resolve));
    return { context, nodes };
}
test('reality and relationship cards collapse and render newest first', async () => {
    const { context, nodes } = await setup();
    let output = nodes.content.innerHTML;
    assert.ok(output.indexOf('新卡片') < output.indexOf('旧卡片'));
    assert.match(output, /<details class="episode" open>/);
    assert.equal((output.match(/<details class="episode" open>/g) || []).length, 1);
    assert.ok(output.indexOf('新进展') < output.indexOf('旧进展'));
    context.setView('episodes');
    output = nodes.content.innerHTML;
    assert.ok(output.indexOf('新相处') < output.indexOf('旧相处'));
    assert.ok(output.indexOf('最近') < output.indexOf('先前'));
});
test('growth page exposes an explicit expand and collapse affordance', () => {
    assert.match(html, /\.episode-head:after\{content:"展开"/);
    assert.match(html, /\.episode\[open\] \.episode-head:after\{content:"收起"/);
});
