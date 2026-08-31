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
        journal.appendEntry(file, parsed.entries[0], key, new Date('2026-08-29T00:00:00Z'));
        journal.appendEntry(file, '第二篇', key, new Date('2026-08-29T01:00:00Z'));
        const encrypted = fs.readFileSync(file, 'utf8');
        assert.equal(encrypted.includes('第一篇'), false);
        assert.equal(encrypted.includes('第二篇'), false);
        const pages = journal.readRecentEntries(file, key, 3);
        assert.equal(pages.length, 2);
        assert.match(pages[0], /2026\.8\.29 08:00\n\n第一篇/);
        assert.match(pages[1], /第二篇/);
        assert.equal(journal.countEntriesOnDate(file, key, new Date('2026-08-29T02:00:00Z')), 2);
        assert.equal(journal.countEntriesOnDate(file, key, new Date('2026-08-30T02:00:00Z')), 0);
        assert.throws(() => journal.decrypt(encrypted.trim().split(/\r?\n/)[0], 'wrong-key'));
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
