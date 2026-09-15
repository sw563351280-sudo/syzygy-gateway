'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { extractDialogueCrumbTags } = require('../dialogue-crumbs');
const { extractSaveMemoryTag, isRecentCrumbDuplicate } = require('../memory-write-utils');
const { decideMemoryWrite } = require('../memory-merge-curator');
const crumb = { fact: '我记着她说猫吐了。', source_quote: '猫吐了。', entities: ['猫'], tags: ['身体'] };
const wrap = value => '<CRUMB >' + JSON.stringify(value) + '</CRUMB >';

test('crumb tolerates single-character entities, punctuation and whitespace while retaining source evidence', () => {
    const result = extractDialogueCrumbTags(wrap(crumb), '猫吐了');
    assert.equal(result.cleanContent, '');
    assert.equal(result.crumbs.length, 1);
    assert.equal(result.crumbs[0].source_quote, '猫吐了');
    assert.deepEqual(result.crumbs[0].entities, ['猫']);
});
test('missing metadata does not discard a grounded fact; invented and cross-message quotes are rejected', () => {
    assert.equal(extractDialogueCrumbTags(wrap({ ...crumb, entities: [] }), '猫吐了').crumbs.length, 1);
    const bad = extractDialogueCrumbTags(wrap({ ...crumb, source_quote: '猫没有吐' }), '猫吐了');
    assert.equal(bad.crumbs.length, 0);
    assert.deepEqual(bad.rejected, ['source_quote_mismatch']);
    assert.equal(extractDialogueCrumbTags(wrap({ ...crumb, source_quote: '猫吐了' }), ['猫', '吐了']).crumbs.length, 0);
});
test('distinct health events survive, exact repeated crumbs do not', () => {
    const now = new Date();
    const old = { ...crumb, created_at: now.toISOString() };
    assert.equal(isRecentCrumbDuplicate(old, crumb, now), true);
    assert.equal(isRecentCrumbDuplicate(old, { ...crumb, fact: '我记着她后来发烧了。', source_quote: '我发烧了' }, now), false);
    assert.equal(isRecentCrumbDuplicate({ ...old, status: 'archived' }, crumb, now), false);
});
test('long term tags accept reordered attributes, single tags, typography and missing tags', () => {
    for (const tag of [
        '<save_memory ttl="perm" tags = "猫">我记着她决定以后一直养猫。</save_memory >',
        '<SAVE_MEMORY tags=“猫”>我记着她决定以后一直养猫。</SAVE_MEMORY>',
        '<SAVE_MEMORY>我记着她决定以后一直养猫。</SAVE_MEMORY>'
    ]) {
        const result = extractSaveMemoryTag(tag);
        assert.equal(result.cleanText, '');
        assert.equal(result.memories.length, 1);
        assert.ok(result.memories[0].tags.length);
    }
});
test('review reads a structured decision in reasoning and reports malformed results', async () => {
    const incoming = { content: '我记着她决定以后一直养猫。', tags: ['猫'] };
    const options = { apiKey: 'fake', endpoint: 'unused', incoming, candidates: [],
        fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: {
            content: '正在整理', reasoning_content: JSON.stringify({ action: 'new', ...incoming })
        } }] }) }) };
    assert.equal((await decideMemoryWrite(options)).action, 'new');
    await assert.rejects(decideMemoryWrite({ ...options, fetchImpl: async () => ({ ok: true, json: async () => ({}) }) }), /no valid decision/);
});
test('long term persistence precedes review; review failure cannot undo saved memory', async () => {
    const source = fs.readFileSync(require.resolve('../server'), 'utf8');
    const fn = source.slice(source.indexOf('async function smartMemoryWrite('), source.indexOf('// 🚨 AI 的专属情感面具'));
    const saved = [], deferred = [];
    const context = { console: { log() {} }, normalizeMemorySource: () => ({}), detectEmotion: () => 0,
        addLongTermMemory: (content, source, tags) => { const entry = { id: 'new', content, source, tags }; saved.push(entry); return entry; },
        setImmediate: callback => deferred.push(callback), suggestSavedMemoryMerge: async () => { throw new Error('offline'); },
        traceEvent() {}, wsBroadcast() {}, loadDiaries: () => [], saveDiaries() {}, Date };
    vm.createContext(context);
    vm.runInContext(fn, context);
    const result = await context.smartMemoryWrite('我记着她决定以后一直养猫。', ['猫'], 'ai_active');
    assert.equal(result.id, 'new');
    assert.equal(saved.length, 1);
    await deferred[0]();
    assert.equal(saved.length, 1);
});
