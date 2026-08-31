'use strict';

const crypto = require('crypto');
const fs = require('fs');

const PRIVATE_JOURNAL_REGEX = /<PRIVATE_JOURNAL\s*>([\s\S]*?)<\/PRIVATE_JOURNAL>/gi;
const PRIVATE_JOURNAL_MARKER_REGEX = /(?:<|&lt;)\s*PRIVATE_JOURNAL\b/i;
const MAX_READ_COUNT = 5;
const MAX_TOOL_RESULT_CHARS = 12000;

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

function appendEntry(filePath, content, passphrase, now = new Date()) {
    const text = String(content || '').trim();
    if (!text) return false;
    const entry = `${formatJournalTimestamp(now)}\n\n${text}`;
    fs.mkdirSync(require('path').dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${encrypt(entry, passphrase)}\n`, { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(filePath, 0o600); } catch (_) {}
    return true;
}

function readRecentEntries(filePath, passphrase, count = 3) {
    if (!fs.existsSync(filePath)) return [];
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
    const wanted = Math.min(MAX_READ_COUNT, Math.max(1, Number.parseInt(count, 10) || 3));
    const entries = [];
    for (let index = lines.length - 1; index >= 0 && entries.length < wanted; index--) {
        try {
            entries.unshift(decrypt(lines[index], passphrase));
        } catch (_) {
            // A damaged historical line must not prevent newer pages from opening.
            entries.unshift('[这页日记已经无法读取。]');
        }
    }
    return entries;
}

function countEntriesOnDate(filePath, passphrase, now = new Date()) {
    if (!fs.existsSync(filePath)) return 0;
    const datePrefix = formatJournalTimestamp(now).split(' ')[0];
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
    let count = 0;
    for (let index = lines.length - 1; index >= 0; index--) {
        try {
            const entry = decrypt(lines[index], passphrase);
            if (!entry.startsWith(datePrefix)) break;
            count++;
        } catch (_) {
            // A corrupt newest line does not earn an extra write for the day.
            break;
        }
    }
    return count;
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
    appendEntry,
    countEntriesOnDate,
    decrypt,
    encrypt,
    extractPrivateJournalTags,
    formatJournalTimestamp,
    readRecentEntries,
    renderRecentEntries,
};
