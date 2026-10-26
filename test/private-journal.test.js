'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const journal = require('../private-journal');

test('private journal encrypts raw text, strips tags, and reads recent pages', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'syzygy-private-journal-'));
    const file = path.join(root, 'private_journal.enc');
    const key = 'test-private-journal-key';
    try {
        const parsed = journal.extractPrivateJournalTags('正文<PRIVATE_JOURNAL>第一篇</PRIVATE_JOURNAL>尾巴');
        assert.equal(parsed.cleanText, '正文尾巴');
        assert.deepEqual(parsed.entries, ['第一篇']);
        const malformed = journal.extractPrivateJournalTags('安全的前半句<PRIVATE_JOURNAL>这页不该展示');
        assert.equal(malformed.cleanText, '安全的前半句');
        assert.deepEqual(malformed.entries, []);
        const first = journal.appendEntry(file, parsed.entries[0], key, new Date('2026-08-29T00:00:00Z'), {
            title: '第一把锁',
            trigger_id: 'quiet_first',
            generation_context: {
                model: 'journal-model',
                prompt_version: 'A:2026-08-29',
                history_source: 'zep+web_config(main)',
                history_count: 24,
                context_sources: ['shared_persona', 'memory_recall', 'workroom_brief', 'not-allowed'],
                private_text: 'must not persist',
            },
        });
        const second = journal.appendEntry(file, '第二篇', key, new Date('2026-08-29T01:00:00Z'), { title: '<第二把锁>' });
        const encrypted = fs.readFileSync(file, 'utf8');
        assert.equal(encrypted.includes('第一篇'), false);
        assert.equal(encrypted.includes('第二篇'), false);
        const pages = journal.readRecentEntries(file, key, 3);
        assert.equal(pages.length, 2);
        assert.match(pages[0], new RegExp(first.id));
        assert.match(pages[0], /第一把锁/);
        assert.match(pages[0], /第一篇/);
        assert.match(pages[1], /第二篇/);
        assert.equal(second.title, '第二把锁');
        assert.equal(journal.countEntriesOnDate(file, key, new Date('2026-08-29T02:00:00Z')), 2);
        assert.equal(journal.countEntriesOnDate(file, key, new Date('2026-08-30T02:00:00Z')), 0);
        assert.equal(journal.hasTriggerId(file, key, 'quiet_first'), true);
        const diagnostic = journal.readEntryById(file, key, first.id).generation_context;
        assert.deepEqual(diagnostic, {
            model: 'journal-model',
            prompt_version: 'A:2026-08-29',
            history_source: 'zep+web_config(main)',
            history_count: 24,
            context_sources: ['shared_persona', 'memory_recall', 'workroom_brief'],
        });
        assert.equal(Object.hasOwn(diagnostic, 'private_text'), false);
        const beforeReveal = journal.listEntries(file, key);
        assert.equal(beforeReveal.total, 2);
        assert.equal(beforeReveal.entries[0].id, second.id);
        assert.equal(beforeReveal.entries[0].content, null);
        assert.equal(beforeReveal.entries[0].visibility, 'sealed');
        assert.throws(() => journal.revealEntry(file, key, second.id), /还没有请求/);
        journal.requestReveal(file, key, second.id, new Date('2026-08-29T02:10:00Z'));
        assert.equal(journal.listEntries(file, key).entries[0].request_status, 'requested');
        journal.revealEntry(file, key, second.id, new Date('2026-08-29T02:20:00Z'));
        const afterReveal = journal.listEntries(file, key).entries[0];
        assert.equal(afterReveal.visibility, 'revealed');
        assert.equal(afterReveal.content, '第二篇');
        assert.equal(afterReveal.request_status, 'revealed');
        assert.throws(() => journal.decrypt(encrypted.trim().split(/\r?\n/)[0], 'wrong-key'));
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('legacy encrypted pages gain stable ids and can be requested without exposing sealed content', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'syzygy-private-journal-legacy-'));
    const file = path.join(root, 'private_journal.enc');
    const key = 'legacy-key';
    try {
        const plaintext = '2026.8.28 23:40\n\n这是一页旧日记';
        fs.writeFileSync(file, journal.encrypt(plaintext, key) + '\n', 'utf8');
        const firstList = journal.listEntries(file, key);
        const secondList = journal.listEntries(file, key);
        const legacy = firstList.entries[0];
        assert.match(legacy.id, /^journal_legacy_/);
        assert.equal(legacy.id, secondList.entries[0].id);
        assert.equal(legacy.content, null);
        assert.equal(legacy.title, '未启封的一页');
        journal.requestReveal(file, key, legacy.id);
        journal.keepEntrySealed(file, key, legacy.id);
        const kept = journal.listEntries(file, key).entries[0];
        assert.equal(kept.visibility, 'sealed');
        assert.equal(kept.request_status, 'kept_sealed');
        assert.equal(kept.content, null);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('private journal key is generated once outside the prompt', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'syzygy-private-journal-key-'));
    const keyFile = path.join(root, '.private_journal_key');
    const journalFile = path.join(root, 'private_journal.enc');
    try {
        const first = journal.readOrCreateKey(keyFile, journalFile);
        const second = journal.readOrCreateKey(keyFile, journalFile);
        assert.match(first, /^[a-f0-9]{64}$/);
        assert.equal(second, first);
        assert.equal(fs.readFileSync(keyFile, 'utf8').trim(), first);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('private journal refuses to replace a missing key for existing pages', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'syzygy-private-journal-missing-key-'));
    const keyFile = path.join(root, '.private_journal_key');
    const journalFile = path.join(root, 'private_journal.enc');
    try {
        fs.writeFileSync(journalFile, 'existing encrypted page\n');
        assert.throws(
            () => journal.readOrCreateKey(keyFile, journalFile),
            /已有内容但密钥文件不存在/
        );
        assert.equal(fs.existsSync(keyFile), false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
