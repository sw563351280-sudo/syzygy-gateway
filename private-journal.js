'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PRIVATE_JOURNAL_REGEX = /<PRIVATE_JOURNAL\s*>([\s\S]*?)<\/PRIVATE_JOURNAL>/gi;
const PRIVATE_JOURNAL_MARKER_REGEX = /(?:<|&lt;)\s*PRIVATE_JOURNAL\b/i;
const RECORD_VERSION = 2;
const MAX_READ_COUNT = 5;
const MAX_LIST_COUNT = 50;
const MAX_TOOL_RESULT_CHARS = 12000;
const MAX_TITLE_CHARS = 80;
const MAX_CONTENT_CHARS = 6000;

function readOrCreateKey(keyFilePath, journalFilePath) {
    try {
        const existing = fs.readFileSync(keyFilePath, 'utf8').trim();
        if (!existing) throw new Error('私密日记密钥文件为空');
        try { fs.chmodSync(keyFilePath, 0o600); } catch (_) {}
        return existing;
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }

    if (journalFilePath && fs.existsSync(journalFilePath) && fs.statSync(journalFilePath).size > 0) {
        throw new Error('私密日记已有内容但密钥文件不存在，已拒绝生成新密钥');
    }

    fs.mkdirSync(path.dirname(keyFilePath), { recursive: true });
    const generated = crypto.randomBytes(32).toString('hex');
    try {
        fs.writeFileSync(keyFilePath, `${generated}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    } catch (error) {
        // Another request may have created the key between our read and write.
        if (error.code === 'EEXIST') return readOrCreateKey(keyFilePath, journalFilePath);
        throw error;
    }
    try { fs.chmodSync(keyFilePath, 0o600); } catch (_) {}
    return generated;
}

function deriveKey(passphrase) {
    if (typeof passphrase !== 'string' || !passphrase.trim()) {
        throw new Error('私密日记密钥不可用');
    }
    return crypto.createHash('sha256').update(passphrase).digest();
}

function encrypt(plaintext, passphrase) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(passphrase), iv);
    const data = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    return JSON.stringify({
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        data: data.toString('base64'),
    });
}

function decrypt(record, passphrase) {
    const { iv, tag, data } = JSON.parse(record);
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(passphrase), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

function formatJournalTimestamp(now = new Date()) {
    const parts = new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric', month: 'numeric', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now).reduce((result, part) => {
        if (part.type !== 'literal') result[part.type] = part.value;
        return result;
    }, {});
    return `${parts.year}.${Number(parts.month)}.${Number(parts.day)} ${parts.hour}:${parts.minute}`;
}

function journalDateKey(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return formatJournalTimestamp(date).split(' ')[0];
}

function cleanTitle(value) {
    const title = String(value || '').replace(/[<>]/g, '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    return (title || '未启封的一页').slice(0, MAX_TITLE_CHARS);
}

function cleanContent(value) {
    return String(value || '').trim().slice(0, MAX_CONTENT_CHARS);
}

function legacyTimestampToIso(timestamp) {
    const matched = String(timestamp || '').match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})\s+(\d{2}):(\d{2})$/);
    if (!matched) return null;
    const [, year, month, day, hour, minute] = matched.map(Number);
    return new Date(Date.UTC(year, month - 1, day, hour - 8, minute)).toISOString();
}

function legacyEntry(plaintext) {
    const source = String(plaintext || '');
    const splitAt = source.indexOf('\n\n');
    const timestamp = splitAt >= 0 ? source.slice(0, splitAt).trim() : '';
    const content = splitAt >= 0 ? source.slice(splitAt + 2).trim() : source.trim();
    return {
        version: RECORD_VERSION,
        id: `journal_legacy_${crypto.createHash('sha256').update(source).digest('hex').slice(0, 20)}`,
        title: '未启封的一页',
        content,
        visibility: 'sealed',
        created_at: legacyTimestampToIso(timestamp) || new Date(0).toISOString(),
        revealed_at: null,
        reveal_requested_at: null,
        reveal_decided_at: null,
        reveal_decision: null,
        trigger_id: null,
        generated_by: 'legacy',
    };
}

function normalizeEntry(value) {
    if (!value || typeof value !== 'object') return null;
    // Existing pages must never be shortened during a metadata-only update
    // such as request/reveal. Length limits apply only when a new page enters.
    const content = String(value.content || '').trim();
    if (!content) return null;
    const created = new Date(value.created_at || Date.now());
    const visibility = value.visibility === 'revealed' ? 'revealed' : 'sealed';
    return {
        version: RECORD_VERSION,
        id: /^journal_[a-zA-Z0-9_-]+$/.test(String(value.id || '')) ? String(value.id) : `journal_${crypto.randomUUID()}`,
        title: cleanTitle(value.title),
        content,
        visibility,
        created_at: Number.isNaN(created.getTime()) ? new Date().toISOString() : created.toISOString(),
        revealed_at: visibility === 'revealed' && value.revealed_at ? String(value.revealed_at) : null,
        reveal_requested_at: visibility === 'sealed' && value.reveal_requested_at ? String(value.reveal_requested_at) : null,
        reveal_decided_at: value.reveal_decided_at ? String(value.reveal_decided_at) : null,
        reveal_decision: value.reveal_decision === 'kept_sealed' ? 'kept_sealed' : (visibility === 'revealed' ? 'revealed' : null),
        trigger_id: value.trigger_id ? String(value.trigger_id).slice(0, 160) : null,
        generated_by: value.generated_by ? String(value.generated_by).slice(0, 80) : 'private_journal',
    };
}

function decodeEntryPlaintext(plaintext) {
    try {
        const parsed = JSON.parse(String(plaintext || ''));
        if (parsed && Number(parsed.version) >= RECORD_VERSION) {
            const normalized = normalizeEntry(parsed);
            if (normalized) return normalized;
        }
    } catch (_) {}
    return legacyEntry(plaintext);
}

function encodeEntryPlaintext(entry) {
    const normalized = normalizeEntry(entry);
    if (!normalized) throw new Error('私密日记正文为空');
    return JSON.stringify(normalized);
}

function newEntry(content, now = new Date(), metadata = {}) {
    return normalizeEntry({
        version: RECORD_VERSION,
        id: metadata.id || `journal_${crypto.randomUUID()}`,
        title: metadata.title,
        content: cleanContent(content),
        visibility: metadata.visibility,
        created_at: metadata.created_at || now.toISOString(),
        revealed_at: metadata.revealed_at,
        reveal_requested_at: metadata.reveal_requested_at,
        reveal_decided_at: metadata.reveal_decided_at,
        reveal_decision: metadata.reveal_decision,
        trigger_id: metadata.trigger_id,
        generated_by: metadata.generated_by,
    });
}

function readRecords(filePath, passphrase) {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).map(raw => {
        try {
            return { raw, entry: decodeEntryPlaintext(decrypt(raw, passphrase)), error: null };
        } catch (error) {
            return { raw, entry: null, error };
        }
    });
}

function writeRecords(filePath, records) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    try {
        const serialized = records.map(record => record.raw).join('\n') + (records.length ? '\n' : '');
        fs.writeFileSync(temporary, serialized, { encoding: 'utf8', mode: 0o600 });
        fs.renameSync(temporary, filePath);
        try { fs.chmodSync(filePath, 0o600); } catch (_) {}
    } finally {
        try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch (_) {}
    }
}

function mutateEntry(filePath, passphrase, id, mutate) {
    const records = readRecords(filePath, passphrase);
    const index = records.findIndex(record => record.entry?.id === id);
    if (index === -1) {
        const error = new Error('没有找到这页日记');
        error.code = 'JOURNAL_NOT_FOUND';
        throw error;
    }
    const next = normalizeEntry(mutate({ ...records[index].entry }));
    if (!next) throw new Error('私密日记更新无效');
    records[index] = { raw: encrypt(encodeEntryPlaintext(next), passphrase), entry: next, error: null };
    writeRecords(filePath, records);
    return next;
}

function extractPrivateJournalTags(text) {
    const entries = [];
    let cleanText = String(text || '').replace(PRIVATE_JOURNAL_REGEX, (_match, raw) => {
        const content = String(raw || '').trim();
        if (content) entries.push(content);
        return '';
    });
    // A malformed or HTML-escaped opening tag must never turn the remainder
    // of a streamed response into visible prose. Drop it conservatively; the
    // valid paired form above is still written before this fallback runs.
    const orphanedMarker = cleanText.search(PRIVATE_JOURNAL_MARKER_REGEX);
    if (orphanedMarker !== -1) cleanText = cleanText.slice(0, orphanedMarker);
    cleanText = cleanText.trim();
    return { cleanText, entries };
}

function appendEntry(filePath, content, passphrase, now = new Date(), metadata = {}) {
    const entry = newEntry(content, now, metadata);
    if (!entry) return false;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${encrypt(encodeEntryPlaintext(entry), passphrase)}\n`, { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(filePath, 0o600); } catch (_) {}
    return entry;
}

function entryForTool(entry) {
    return `[日记 ID：${entry.id}]\n标题：${entry.title}\n写于：${formatJournalTimestamp(new Date(entry.created_at))}\n状态：${entry.visibility === 'revealed' ? '已经打开' : '仍然封存'}\n\n${entry.content}`;
}

function readRecentEntries(filePath, passphrase, count = 3) {
    const records = readRecords(filePath, passphrase);
    const wanted = Math.min(MAX_READ_COUNT, Math.max(1, Number.parseInt(count, 10) || 3));
    const entries = [];
    for (let index = records.length - 1; index >= 0 && entries.length < wanted; index--) {
        entries.unshift(records[index].entry ? entryForTool(records[index].entry) : '[这页日记已经无法读取。]');
    }
    return entries;
}

function readEntryById(filePath, passphrase, id) {
    const found = readRecords(filePath, passphrase).find(record => record.entry?.id === id);
    return found?.entry || null;
}

function countEntriesOnDate(filePath, passphrase, now = new Date()) {
    const dateKey = journalDateKey(now);
    return readRecords(filePath, passphrase).filter(record => record.entry && journalDateKey(record.entry.created_at) === dateKey).length;
}

function hasTriggerId(filePath, passphrase, triggerId) {
    if (!triggerId) return false;
    return readRecords(filePath, passphrase).some(record => record.entry?.trigger_id === triggerId);
}

function publicEntry(entry) {
    const revealed = entry.visibility === 'revealed';
    return {
        id: entry.id,
        title: entry.title,
        visibility: revealed ? 'revealed' : 'sealed',
        created_at: entry.created_at,
        revealed_at: revealed ? entry.revealed_at : null,
        request_status: revealed ? 'revealed' : (entry.reveal_requested_at ? 'requested' : (entry.reveal_decision === 'kept_sealed' ? 'kept_sealed' : null)),
        content: revealed ? entry.content : null,
    };
}

function listEntries(filePath, passphrase, { page = 1, limit = 20 } = {}) {
    const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
    const safeLimit = Math.min(MAX_LIST_COUNT, Math.max(1, Number.parseInt(limit, 10) || 20));
    const all = readRecords(filePath, passphrase).filter(record => record.entry).map(record => record.entry).reverse();
    const start = (safePage - 1) * safeLimit;
    return {
        entries: all.slice(start, start + safeLimit).map(publicEntry),
        total: all.length,
        page: safePage,
        limit: safeLimit,
    };
}

function listEntriesForTool(filePath, passphrase, count = 10) {
    const wanted = Math.min(20, Math.max(1, Number.parseInt(count, 10) || 10));
    const entries = readRecords(filePath, passphrase).filter(record => record.entry).map(record => record.entry).slice(-wanted).reverse();
    if (!entries.length) return '【私密日记】抽屉里还是空的。';
    return entries.map(entry => {
        const request = entry.reveal_requested_at ? ' · 江鱼正在请求查看' : '';
        return `${entry.id} | ${formatJournalTimestamp(new Date(entry.created_at))} | ${entry.title} | ${entry.visibility === 'revealed' ? '已打开' : '封存'}${request}`;
    }).join('\n');
}

function requestReveal(filePath, passphrase, id, now = new Date()) {
    return mutateEntry(filePath, passphrase, id, entry => {
        if (entry.visibility === 'revealed') return entry;
        entry.reveal_requested_at = now.toISOString();
        entry.reveal_decided_at = null;
        entry.reveal_decision = null;
        return entry;
    });
}

function revealEntry(filePath, passphrase, id, now = new Date()) {
    return mutateEntry(filePath, passphrase, id, entry => {
        if (entry.visibility === 'revealed') return entry;
        if (!entry.reveal_requested_at) {
            const error = new Error('江鱼还没有请求查看这一页');
            error.code = 'JOURNAL_REVEAL_NOT_REQUESTED';
            throw error;
        }
        entry.visibility = 'revealed';
        entry.revealed_at = now.toISOString();
        entry.reveal_requested_at = null;
        entry.reveal_decided_at = now.toISOString();
        entry.reveal_decision = 'revealed';
        return entry;
    });
}

function keepEntrySealed(filePath, passphrase, id, now = new Date()) {
    return mutateEntry(filePath, passphrase, id, entry => {
        if (entry.visibility === 'revealed') {
            const error = new Error('这一页已经打开，不能重新封存');
            error.code = 'JOURNAL_ALREADY_REVEALED';
            throw error;
        }
        if (!entry.reveal_requested_at) {
            const error = new Error('江鱼还没有请求查看这一页');
            error.code = 'JOURNAL_REVEAL_NOT_REQUESTED';
            throw error;
        }
        entry.reveal_requested_at = null;
        entry.reveal_decided_at = now.toISOString();
        entry.reveal_decision = 'kept_sealed';
        return entry;
    });
}

function renderRecentEntries(entries, maxChars = MAX_TOOL_RESULT_CHARS) {
    if (!entries.length) return '【私密日记】抽屉里还是空的。';
    const chosen = [];
    let used = '【私密日记 · 最近几篇】'.length;
    for (let index = entries.length - 1; index >= 0; index--) {
        const entry = entries[index];
        if (chosen.length && used + entry.length + 4 > maxChars) continue;
        if (!chosen.length && entry.length + used > maxChars) {
            chosen.unshift(`${entry.slice(0, Math.max(0, maxChars - used - 40))}\n\n[这一页过长，已在此处收住。]`);
            break;
        }
        chosen.unshift(entry);
        used += entry.length + 4;
    }
    return `【私密日记 · 最近${chosen.length}篇】\n\n${chosen.join('\n\n---\n\n')}`;
}

module.exports = {
    MAX_READ_COUNT,
    RECORD_VERSION,
    appendEntry,
    countEntriesOnDate,
    decodeEntryPlaintext,
    decrypt,
    encrypt,
    extractPrivateJournalTags,
    formatJournalTimestamp,
    hasTriggerId,
    keepEntrySealed,
    listEntries,
    listEntriesForTool,
    publicEntry,
    readEntryById,
    readOrCreateKey,
    readRecentEntries,
    renderRecentEntries,
    requestReveal,
    revealEntry,
};
