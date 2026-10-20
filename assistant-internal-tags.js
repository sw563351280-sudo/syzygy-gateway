'use strict';

const PAIRED_TAGS = Object.freeze([
    'SAVE_MEMORY',
    'ADD_TODO',
    'MOOD_SNAPSHOT',
    'CRUMB',
    'RELATIONSHIP_STATE',
    'STATE_UPDATE',
    'ANTICIPATION',
    'NEXT_WAKE',
    'PRIVATE_JOURNAL',
]);
const SELF_CLOSING_TAGS = Object.freeze(['DONE_TODO']);
const ALL_TAGS = Object.freeze([...PAIRED_TAGS, ...SELF_CLOSING_TAGS, 'REACT']);

function lineRecords(text) {
    const source = String(text || '');
    const records = [];
    let start = 0;
    let fenced = false;
    while (start <= source.length) {
        let newline = source.indexOf('\n', start);
        if (newline < 0) newline = source.length;
        const end = newline > start && source[newline - 1] === '\r' ? newline - 1 : newline;
        const raw = source.slice(start, end);
        const trimmed = raw.trim();
        const fenceMarker = trimmed.match(/^(`{3,}|~{3,})/);
        records.push({ start, end, raw, trimmed, fenced, fenceMarker: fenceMarker?.[1]?.[0] || null });
        if (fenceMarker) fenced = !fenced;
        if (newline === source.length) break;
        start = newline + 1;
    }
    return records;
}

function parseProtocolLine(record) {
    if (!record || record.fenced || record.fenceMarker || !record.trimmed || /^(?: {4,}|\t)/.test(record.raw)) return null;
    const line = record.trimmed;
    const reaction = line.match(/^<\s*REACT\s*:\s*([^<>\r\n]+)>$/iu);
    if (reaction) return { name: 'REACT', value: reaction[1], start: record.start, end: record.end, raw: record.raw };

    for (const name of SELF_CLOSING_TAGS) {
        const pattern = new RegExp(`^<\\s*${name}\\b[^<>\\r\\n]*\\/?\\s*>$`, 'iu');
        if (pattern.test(line)) return { name, start: record.start, end: record.end, raw: record.raw };
    }
    for (const name of PAIRED_TAGS) {
        const pattern = new RegExp(`^<\\s*${name}\\b[^>\\r\\n]*>[\\s\\S]*<\\s*\\/\\s*${name}\\s*>$`, 'iu');
        if (pattern.test(line)) return { name, start: record.start, end: record.end, raw: record.raw };
    }
    return null;
}

function parseProtocolToken(text, start) {
    const source = String(text || '').slice(start);
    const reaction = source.match(/^<\s*REACT\s*:\s*([^<>\r\n]+)>/iu);
    if (reaction) return { name: 'REACT', value: reaction[1], start, end: start + reaction[0].length, raw: reaction[0] };

    for (const name of SELF_CLOSING_TAGS) {
        const pattern = new RegExp(`^<\\s*${name}\\b[^<>\\r\\n]*\\/?\\s*>`, 'iu');
        const match = source.match(pattern);
        if (match) return { name, start, end: start + match[0].length, raw: match[0] };
    }
    for (const name of PAIRED_TAGS) {
        const pattern = new RegExp(`^<\\s*${name}\\b[^>\\r\\n]*>[\\s\\S]*?<\\s*\\/\\s*${name}\\s*>`, 'iu');
        const match = source.match(pattern);
        if (match) return { name, start, end: start + match[0].length, raw: match[0] };
    }
    return null;
}

function protocolCandidateAllowed(text, start) {
    const lineStart = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    if (/^(?: {4,}|\t)/.test(text.slice(lineStart, start))) return false;
    const record = lineRecords(text).find(line => line.start <= start && start <= line.end);
    return Boolean(record && !record.fenced && !record.fenceMarker);
}

function compactTerminalZone(text, { partial = false } = {}) {
    for (let start = text.indexOf('<'); start >= 0; start = text.indexOf('<', start + 1)) {
        if (!protocolCandidateAllowed(text, start)) continue;
        const tags = [];
        let position = start;
        let incomplete = false;
        while (position < text.length) {
            while (/\s/u.test(text[position] || '')) position++;
            if (position >= text.length) break;
            const tag = parseProtocolToken(text, position);
            if (tag) {
                tags.push(tag);
                position = tag.end;
                continue;
            }
            if (partial && plausibleProtocolFragment(text.slice(position))) {
                incomplete = true;
                position = text.length;
            }
            break;
        }
        if (position === text.length && (tags.length || incomplete)) return { start, tags, incomplete };
    }
    return null;
}

function splitLineTerminalTags(text) {
    const lines = lineRecords(text);
    const tags = [];
    let index = lines.length - 1;
    while (index >= 0 && !lines[index].trimmed) index--;
    while (index >= 0) {
        const parsed = parseProtocolLine(lines[index]);
        if (!parsed) break;
        tags.unshift(parsed);
        index--;
        while (index >= 0 && !lines[index].trimmed) index--;
    }
    if (!tags.length) {
        return { visibleContent: text, protocolContent: '', tags: [], protocolStart: text.length, visibleEnd: text.length };
    }
    const protocolStart = tags[0].start;
    const visibleRaw = text.slice(0, protocolStart);
    const visibleContent = visibleRaw.trimEnd();
    return {
        visibleContent,
        protocolContent: text.slice(protocolStart).trim(),
        tags,
        protocolStart,
        visibleEnd: visibleContent.length,
    };
}

function splitAssistantTerminalTags(content) {
    const text = String(content || '');
    const lineResult = splitLineTerminalTags(text);
    const compact = compactTerminalZone(text);
    if (!compact) return lineResult;

    const lineStart = text.lastIndexOf('\n', Math.max(0, compact.start - 1)) + 1;
    const startsStandaloneLine = !text.slice(lineStart, compact.start).trim();
    // A single inline tag can be prose or an example. The compatibility path
    // is intentionally limited to two or more adjacent terminal tags, which
    // is the malformed provider shape we need to accept safely.
    if (compact.tags.length < 2 && !startsStandaloneLine) return lineResult;
    if (compact.start >= lineResult.protocolStart) return lineResult;

    const visibleContent = text.slice(0, compact.start).trimEnd();
    return {
        visibleContent,
        protocolContent: text.slice(compact.start).trim(),
        tags: compact.tags,
        protocolStart: compact.start,
        visibleEnd: visibleContent.length,
    };
}

function plausibleProtocolFragment(value) {
    const line = String(value || '').trimStart();
    if (!line.startsWith('<') || /[\r\n]/.test(line)) return false;
    const upper = line.toUpperCase();
    const expected = ALL_TAGS.map(name => name === 'REACT' ? `<REACT:` : `<${name}`);
    if (expected.some(prefix => prefix.startsWith(upper.replace(/\s+/g, '')))) return true;
    return ALL_TAGS.some(name => {
        const opener = name === 'REACT'
            ? /^<\s*REACT(?:\s*:)/iu
            : new RegExp(`^<\\s*${name}(?:\\b|\\s|>)`, 'iu');
        return opener.test(line);
    });
}

function terminalHoldStart(content) {
    const text = String(content || '');
    const compact = compactTerminalZone(text, { partial: true });
    if (compact) return text.slice(0, compact.start).trimEnd().length;
    const lines = lineRecords(text);
    if (!lines.length) return text.length;
    let index = lines.length - 1;
    const tail = lines[index];
    const tailTag = parseProtocolLine(tail);
    const tailCouldBecomeTag = !tail.fenced && !tail.fenceMarker && plausibleProtocolFragment(tail.raw);
    // Keep trailing whitespace until the next non-whitespace character (or
    // finish). Besides giving a following standalone protocol line a clean
    // boundary, this prevents the `\r` half of CRLF from leaking into the
    // visible stream before we know that the newline starts the hidden zone.
    if (!tailTag && !tailCouldBecomeTag && tail.trimmed) return text.trimEnd().length;

    let start = tail.start;
    let found = Boolean(tailTag || tailCouldBecomeTag);
    index--;
    while (index >= 0) {
        const line = lines[index];
        if (!line.trimmed) { start = line.start; index--; continue; }
        if (!parseProtocolLine(line)) break;
        found = true;
        start = line.start;
        index--;
    }
    return found ? text.slice(0, start).trimEnd().length : text.trimEnd().length;
}

function createAssistantStreamFilter(onVisible) {
    if (typeof onVisible !== 'function') throw new TypeError('onVisible must be a function');
    let text = '';
    let emitted = 0;
    let finished = false;

    function flushTo(end) {
        const safeEnd = Math.max(emitted, Math.min(text.length, end));
        if (safeEnd > emitted) onVisible(text.slice(emitted, safeEnd));
        emitted = safeEnd;
    }

    return {
        push(piece) {
            if (finished) throw new Error('assistant stream filter already finished');
            text += String(piece || '');
            flushTo(terminalHoldStart(text));
        },
        finish() {
            if (finished) return splitAssistantTerminalTags(text);
            finished = true;
            const result = splitAssistantTerminalTags(text);
            flushTo(result.visibleEnd);
            return result;
        },
        bufferedLength() { return Math.max(0, text.length - emitted); },
        content() { return text; },
    };
}

module.exports = {
    ALL_TAGS,
    createAssistantStreamFilter,
    parseProtocolLine,
    splitAssistantTerminalTags,
    terminalHoldStart,
};
