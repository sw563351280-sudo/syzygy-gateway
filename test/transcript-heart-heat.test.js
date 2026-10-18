'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { aggregateTranscriptSources, createTranscriptHeatStore, missingArchiveMonths } = require('../transcript-heart-heat');

function pair(user, assistant, userTime, assistantTime = userTime) {
    return [
        { role: 'user', content: user, time: userTime },
        { role: 'assistant', content: assistant, time: assistantTime }
    ];
}

test('historical heat anchors a completed round to the user time and safely fills a missing reply time', () => {
    const result = aggregateTranscriptSources([{ name: '2026-03.json', data: [{
        timestamp: '2026-03-01T15:55:00.000Z',
        messages: [
            ...pair('睡前说说话', '我在。', '2026-03-01T15:59:00.000Z', '2026-10-18T00:05:00.000Z'),
            ...pair('已经过零点了', '那也陪你。', '2026-03-01T16:01:00.000Z', null)
        ]
    }] }]);
    assert.deepEqual(result.days.map(day => [day.date, day.rounds]), [['2026-03-01', 1], ['2026-03-02', 1]]);
    assert.equal(result.archive.audit.completeRounds, 2);
    assert.equal(JSON.stringify(result).includes('睡前说说话'), false, 'aggregate API data never contains transcript text');
});

test('historical heat removes exact cross-file duplicates and workroom conversations', () => {
    const ordinary = pair('今天散步了', '走了多远？', '2026-09-30T12:00:00.000Z');
    const workroom = pair('【溯星小屋三方共创工作区 · 讨论】\n江鱼：改一下页面', '我来看看。', '2026-09-30T13:00:00.000Z');
    const result = aggregateTranscriptSources([
        { name: '2026-09.json', data: [{ messages: [...ordinary, ...workroom] }] },
        { name: '2026-10.json', data: [{ messages: ordinary }] }
    ]);
    assert.equal(result.days[0].rounds, 1);
    assert.equal(result.archive.audit.completeRounds, 1);
    assert.equal(result.archive.audit.duplicateRounds, 1);
    assert.equal(result.archive.audit.workroomRounds, 1);
});

test('archive month gaps are derived from the source inventory, not mistaken for quiet chat', () => {
    assert.deepEqual(missingArchiveMonths(['2025-11.json', '2025-12.json', '2026-01.json', '2026-03.json']), ['2026-02']);
    assert.deepEqual(missingArchiveMonths(['2026-04.json']), []);
});

test('file metadata cache reuses an aggregate and invalidates when a transcript changes', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'heart-transcripts-'));
    const bufferFile = path.join(directory, 'buffer.json');
    try {
        const january = path.join(directory, '2026-01.json');
        const cacheFile = path.join(directory, 'heart-cache.json');
        fs.writeFileSync(january, JSON.stringify([{ messages: pair('一月', '在。', '2026-01-01T08:00:00.000Z') }]));
        const store = createTranscriptHeatStore({ transcriptsDir: directory, bufferFile, cacheFile });
        assert.equal(store.get(2026).days[0].rounds, 1);
        assert.equal(fs.existsSync(cacheFile), true);
        assert.equal(fs.readFileSync(cacheFile, 'utf8').includes('一月'), false, 'persistent cache contains hashes and aggregates, never transcript text');
        assert.equal(createTranscriptHeatStore({ transcriptsDir: directory, bufferFile, cacheFile }).get(2026).days[0].rounds, 1, 'a new process-compatible store restores the metadata cache');
        const signature = store.diagnostics().signature;
        assert.equal(store.get(2025).days.length, 0);
        assert.equal(store.diagnostics().signature, signature, 'unchanged metadata keeps the cached aggregate');
        fs.writeFileSync(january, JSON.stringify([{ messages: [...pair('一月', '在。', '2026-01-01T08:00:00.000Z'), ...pair('又说了一轮', '还在。', '2026-01-01T09:00:00.000Z')] }]));
        assert.equal(store.get(2026).days[0].rounds, 2);
        assert.notEqual(store.diagnostics().signature, signature);
        fs.writeFileSync(bufferFile, JSON.stringify({ started_at: '2026-01-01T10:00:00.000Z', messages: pair('缓冲区的新一轮', '接住了。', '2026-01-01T10:00:00.000Z') }));
        assert.equal(store.get(2026).days[0].rounds, 3, 'a buffer update overlays the cached monthly archive');
        fs.writeFileSync(bufferFile, JSON.stringify({ started_at: '2026-01-01T08:00:00.000Z', messages: pair('一月', '在。', '2026-01-01T08:00:00.000Z') }));
        assert.equal(store.get(2026).days[0].rounds, 2, 'buffer content already archived is not counted twice');
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
