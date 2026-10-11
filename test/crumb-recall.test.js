'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { CRUMB_SEARCH_TOOL, formatCrumbRecall, isExplicitCrumbQuery, readCrumbsFile, searchCrumbs } = require('../crumb-recall');
const { createCachedToolPolicy, executeAllowedTool } = require('../cached-tool-policy');
const { keepRequestedReadTools } = require('../tool-policy');
const now = new Date('2026-10-11T03:00:00Z');
const crumb = (id, extra = {}) => ({ id, fact: '猫吐了，后来喝了一点水。', source_quote: '猫吐了', entities: ['猫'], tags: [], status: 'active', created_at: '2026-10-10T10:00:00Z', ...extra });

test('single-character entities and body/original-quote queries are retrievable without tags or embeddings', () => {
    const items = [crumb('cat'), crumb('old', { fact: '在花店买了一束花', source_quote: '买了向日葵', entities: [], tags: [], status: undefined })];
    for (const query of ['猫怎么样', '小猫怎么样', '猫吐了', '喝了一点水']) assert.equal(searchCrumbs(items, { keyword: query, passive: true, now }).results[0]?.id, 'cat', query);
    assert.equal(searchCrumbs([crumb('untagged', { entities: [], tags: [] })], { keyword: '猫', now }).results[0].id, 'untagged');
    assert.equal(searchCrumbs(items, { keyword: '向日葵', passive: true, now }).results[0].id, 'old');
    assert.equal(searchCrumbs(items, { keyword: '抱抱我', passive: true, now }).returned, 0);
});

test('age is not a read barrier: late-active, quiet and legacy states stay searchable; archives require explicit inclusion', () => {
    const items = [crumb('late', { created_at: '2026-09-01' }), crumb('quiet', { status: 'quiet' }), crumb('archive', { status: 'archived' }), crumb('wrong', { status: 'retracted' })];
    assert.deepEqual(new Set(searchCrumbs(items, { keyword: '猫', now }).results.map(x => x.id)), new Set(['late', 'quiet']));
    assert.equal(searchCrumbs(items, { keyword: '猫', include_archived: true, now }).returned, 3);
});

test('specific evidence outranks newer generic matches; recall does not mutate counters or store', () => {
    const items = [crumb('specific', { fact: '在花店买了向日葵', source_quote: '买了向日葵', entities: [], tags: [], created_at: '2026-09-01' }),
        crumb('new', { fact: '下次想看看别的花', source_quote: '', entities: ['花'], tags: ['花店'], created_at: now.toISOString(), surface_count: 999 })];
    const before = JSON.stringify(items);
    assert.equal(searchCrumbs(items, { keyword: '花店买了向日葵', passive: true, now }).results[0].id, 'specific');
    assert.equal(JSON.stringify(items), before);
});

test('explicit browsing uses China dates, supports pagination, and distinguishes no match from no stored memories', () => {
    const items = [crumb('today', { created_at: '2026-10-10T18:00:00Z' }), crumb('yesterday'), crumb('older', { created_at: '2026-09-01' })];
    assert.deepEqual(searchCrumbs(items, { keyword: '看看今天的碎屑', now }).results.map(x => x.id), ['today']);
    assert.equal(searchCrumbs(items, { keyword: '昨天', now }).results[0].id, 'yesterday');
    assert.equal(searchCrumbs(items, { date: '2026-10-11', now }).results[0].id, 'today');
    assert.throws(() => searchCrumbs(items, { date: '2026-02-30', now }), /日期/);
    const first = searchCrumbs(items, { limit: 1, now });
    assert.equal(first.matched, 3); assert.equal(first.next_offset, 1);
    assert.equal(searchCrumbs(items, { keyword: '星尘里有什么', now }).matched, 3);
    assert.equal(searchCrumbs(items, { offset: first.next_offset, limit: 1, now }).results[0].id, 'yesterday');
    const missing = searchCrumbs(items, { keyword: '火星', now });
    assert.equal(missing.available, 3); assert.equal(missing.returned, 0);
    assert.match(formatCrumbRecall(missing, true), /不代表/);
});

test('read failures are not disguised as an empty memory store', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syzygy-crumb-read-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'crumbs.json');
    assert.deepEqual(readCrumbsFile(file), []);
    fs.writeFileSync(file, '{'); assert.throws(() => readCrumbsFile(file), /暂时无法读取/);
    fs.writeFileSync(file, '{}'); assert.throws(() => readCrumbsFile(file), /暂时无法读取/);
    fs.writeFileSync(file, JSON.stringify([crumb('saved')]));
    assert.equal(readCrumbsFile(file)[0].id, 'saved');
});

test('both chat endpoints use the repaired read-only injection, which includes saved evidence', async () => {
    const source = fs.readFileSync(require.resolve('../server'), 'utf8');
    const fn = source.slice(source.indexOf('async function buildCrumbRecallContext('), source.indexOf('function archiveStaleCrumbs('));
    const context = vm.createContext({ readCrumbsFile: () => [crumb('saved')], searchCrumbs, formatCrumbRecall, isExplicitCrumbQuery, CRUMBS_FILE: 'fixture', console: { log() {}, warn() {} } });
    vm.runInContext(fn, context);
    assert.match(await context.buildCrumbRecallContext('猫怎么样', now), /saved.*2026-10-10/);
    context.readCrumbsFile = () => { throw new Error('fixture read error'); };
    assert.match(await context.buildCrumbRecallContext('生活碎屑', now), /读取失败/);
    assert.match(source, /await buildCrumbRecallContext\(currentUserMsgText\)/);
    assert.match(source, /await buildCrumbRecallContext\(text\)/);
});

test('crumb search remains allowed in explicit requests and cached tool policy, and reads the same store as passive recall', async () => {
    const kept = keepRequestedReadTools([CRUMB_SEARCH_TOOL], '页面里有星尘，你再查一下');
    assert.equal(kept.length, 1);
    const policy = createCachedToolPolicy([CRUMB_SEARCH_TOOL], kept);
    assert.equal(await executeAllowedTool(policy, 'search_crumbs', () => 'saved evidence'), 'saved evidence');
    const source = fs.readFileSync(require.resolve('../server'), 'utf8');
    const handler = source.match(/case 'search_crumbs': \{([\s\S]*?)\n            \}/)[1];
    const output = new Function('searchCrumbs', 'readCrumbsFile', 'CRUMBS_FILE', 'args', handler)(searchCrumbs, () => [crumb('saved')], 'fixture', { keyword: '猫', now });
    assert.equal(JSON.parse(output).results[0].id, 'saved');
});
