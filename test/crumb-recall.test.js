'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { CRUMB_SEARCH_TOOL, formatCrumbRecall, formatPassiveCrumbRecall, isExplicitCrumbQuery, readCrumbsFile, recallCrumbs, searchCrumbs } = require('../crumb-recall');
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
    const items = [crumb('late', { created_at: '2026-09-01' }), crumb('quiet', { status: 'quiet' }), crumb('archive', { status: 'archived' }), crumb('wrong', { status: 'retracted' }), crumb('deleted', { status: 'deleted' })];
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

test('passive recall merges current-user and recent-user vector lanes, keeps two bands, and drops weak guesses', () => {
    const items = [
        crumb('current', { fact: '第一件旧事', source_quote: '', entities: [], source_message_id: 'one' }),
        crumb('recent', { fact: '第二件旧事', source_quote: '', entities: [], source_message_id: 'two' }),
        crumb('weak', { fact: '不相干的旧事', source_quote: '', entities: [], source_message_id: 'three' })
    ];
    const result = recallCrumbs(items, {
        currentText: '脑海里动了一下', recentUserTexts: ['前一轮也是很泛的一句话'],
        currentEmbedding: [1, 0], recentEmbedding: [0, 1],
        embeddings: { current: [0.8, 0.6], recent: [-0.8, 0.6], weak: [-1, 0] }
    });
    assert.deepEqual(result.results.map(item => item.id), ['current', 'recent']);
    assert.deepEqual(result.results.map(item => item.band), ['clear', 'light']);
    assert.deepEqual(result.results.map(item => item.matched_on), ['current', 'recent']);
});

test('literal matches remain a first-class lane and duplicate events only occupy one slot', () => {
    const items = [
        crumb('exact', { fact: '我记着她买了向日葵', source_quote: '买了向日葵', entities: ['向日葵'], source_message_id: 'same' }),
        crumb('duplicate', { fact: '我记着她从花店带回向日葵', source_quote: '带回向日葵', entities: ['向日葵'], source_message_id: 'same' }),
        crumb('other', { fact: '我记着她买了茉莉香水', source_quote: '买了茉莉香水', entities: ['香水'], source_message_id: 'other' })
    ];
    const result = recallCrumbs(items, { currentText: '那束向日葵', embeddings: {}, limit: 2 });
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].band, 'clear');
    assert.ok(['exact', 'duplicate'].includes(result.results[0].id));
});

test('weak words from separate recent turns do not accumulate past a current literal match', () => {
    const items = [
        crumb('bill', { fact: '我记着她记了今天的账单', source_quote: '今天的账单', entities: ['账单'] }),
        crumb('identity', { fact: '我记着她对模型切换很焦虑', source_quote: '', entities: ['模型切换'], tags: ['焦虑'] })
    ];
    const result = recallCrumbs(items, {
        currentText: '我想记一下今天的账单',
        recentUserTexts: ['刚才在说模型', '切换时有点焦虑', '还聊到了别的事'],
        embeddings: {}
    });
    assert.equal(result.results[0].id, 'bill');
    assert.equal(result.results[0].matched_on, 'current');
});

test('production recall stays capped at two while diagnostic calibration may inspect five', () => {
    const items = Array.from({ length: 6 }, (_, index) => crumb(`item-${index}`, {
        fact: `共同关键词 第${index}件事`, source_quote: '', entities: ['共同关键词'], source_message_id: `source-${index}`
    }));
    assert.equal(recallCrumbs(items, { currentText: '共同关键词', limit: 5 }).results.length, 2);
    assert.equal(recallCrumbs(items, { currentText: '共同关键词', limit: 5, diagnostic: true }).results.length, 5);
});

test('passive formatting adds dynamic relative time and leaves the speaking decision to Shen', () => {
    const result = { results: [{ ...crumb('dated', { happened_at: '2026-09-29T05:00:00Z' }), band: 'light' }] };
    const text = formatPassiveCrumbRecall(result, new Date('2026-10-21T05:00:00Z'));
    assert.match(text, /2026-09-29（约3周前）/);
    assert.match(text, /轻轻浮现/);
    assert.match(text, /想起来和说出口是两件事/);
    assert.doesNotMatch(text, /严禁/);
});

test('both chat endpoints use the repaired read-only injection, which includes saved evidence', async () => {
    const source = fs.readFileSync(require.resolve('../server'), 'utf8');
    const fn = source.slice(source.indexOf('async function buildCrumbRecallContext('), source.indexOf('function archiveStaleCrumbs('));
    const context = vm.createContext({ readCrumbsFile: () => [crumb('saved')], searchCrumbs, recallCrumbs, formatCrumbRecall, formatPassiveCrumbRecall,
        isExplicitCrumbQuery, CRUMBS_FILE: 'fixture', getEmbedding: async () => null, loadCrumbEmbeddingsCache: () => ({}), process: { env: {} }, console: { log() {}, warn() {} } });
    vm.runInContext(fn, context);
    assert.match(await context.buildCrumbRecallContext('猫怎么样', now), /2026-10-10[\s\S]*猫吐了/);
    context.readCrumbsFile = () => { throw new Error('fixture read error'); };
    assert.match(await context.buildCrumbRecallContext('生活碎屑', now), /读取失败/);
    assert.match(source, /await buildCrumbRecallContext\(currentUserMsgText,/);
    assert.match(source, /await buildCrumbRecallContext\(text,/);
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
