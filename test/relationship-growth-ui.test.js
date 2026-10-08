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
test('temperature journeys group complete returns without hiding historical events', async () => {
    const { context } = await setup();
    const events = [
        { id: 'initial', from: null, to: 'warm', occurred_at: '2026-10-01T00:00:00Z' },
        { id: 'leave-one', from: 'warm', to: 'withdrawn', occurred_at: '2026-10-02T00:00:00Z' },
        { id: 'middle-one', from: 'withdrawn', to: 'neutral', occurred_at: '2026-10-03T00:00:00Z' },
        { id: 'return-one', from: 'neutral', to: 'warm', occurred_at: '2026-10-04T00:00:00Z' },
        { id: 'leave-two', from: 'warm', to: 'hostile', occurred_at: '2026-10-05T00:00:00Z' },
        { id: 'legacy', from: null, to: 'neutral', occurred_at: '2026-10-06T00:00:00Z' }
    ];
    const journeys = context.deriveTemperatureJourneys([...events].reverse());
    const complete = journeys.find(item => item.kind === 'journey' && item.status === 'complete');
    const open = journeys.find(item => item.kind === 'journey' && item.status === 'open');
    const fallback = journeys.find(item => item.kind === 'event' && item.event.id === 'legacy');
    assert.deepEqual([...complete.events].map(event => event.id), ['leave-one', 'middle-one', 'return-one']);
    assert.deepEqual([...open.events].map(event => event.id), ['leave-two']);
    assert.equal(fallback.event.id, 'legacy');
    const displayed = journeys.flatMap(item => item.kind === 'journey' ? [...item.events] : [item.event]).map(item => item.id);
    assert.deepEqual([...displayed].sort(), ['initial', 'leave-one', 'middle-one', 'return-one', 'leave-two', 'legacy'].sort());
});
test('temperature journeys keep invalid, duplicate warm, and unclosed history visible', async () => {
    const { context } = await setup();
    const events = [
        { id: 'warm-warm', from: 'warm', to: 'warm', occurred_at: '2026-10-01T00:00:00Z' },
        { id: 'unknown', from: 'warm', to: 'mystery', occurred_at: '2026-10-02T00:00:00Z' },
        { id: 'open', from: 'warm', to: 'withdrawn', occurred_at: '2026-10-03T00:00:00Z' },
        { id: 'no-date', from: 'withdrawn', to: 'neutral' }
    ];
    const journeys = context.deriveTemperatureJourneys(events);
    assert.equal(journeys.filter(item => item.kind === 'event').length, 2);
    const open = journeys.find(item => item.kind === 'journey');
    assert.equal(open.status, 'open');
    assert.deepEqual([...open.events].map(event => event.id), ['open', 'no-date']);
    const shown = journeys.flatMap(item => item.kind === 'journey' ? [...item.events] : [item.event]).map(item => item.id);
    assert.deepEqual([...shown].sort(), events.map(item => item.id).sort());
});
test('production sea theme keeps the approved growth structure', () => {
    const seaScript = fs.readFileSync(require.resolve('../public/growth-sea.js'), 'utf8');
    const seaCss = fs.readFileSync(require.resolve('../public/growth-sea.css'), 'utf8');
    assert.match(seaScript, /正在连起来的线/);
    assert.match(seaCss, /\.episode::before.*left:16px/);
    assert.match(seaCss, /grid-template-columns:minmax\(240px,.92fr\) minmax\(0,1.55fr\)/);
    assert.match(seaCss, /\.temperature-journey/);
    assert.match(html, /deriveTemperatureJourneys/);
    assert.match(html, /尚未命名的经历/);
});
