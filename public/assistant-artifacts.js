(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else if (root) root.AssistantArtifacts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const URGENCIES = new Set(['low', 'medium', 'high', 'critical']);
    const WAKE_KEYS = ['after_minutes', 'reason', 'urgency'];

    function isSingleEmoji(value) {
        const emoji = String(value || '').trim();
        if (!emoji || emoji.length > 40) return false;
        const segments = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(emoji)];
        if (segments.length !== 1 || segments[0].segment !== emoji) return false;
        return /\p{Extended_Pictographic}/u.test(emoji)
            || /^(?:\p{Regional_Indicator}){2}$/u.test(emoji)
            || /^[0-9#*]\uFE0F?\u20E3$/u.test(emoji);
    }

    function reactionLineValue(line) {
        const raw = String(line || '');
        if (/^(?: {4,}|\t)/.test(raw)) return null;
        const trimmed = raw.trim();
        const standard = trimmed.match(/^<\s*REACT\s*:\s*([^<>\r\n]+)>$/iu);
        const bare = trimmed.match(/^REACT\s*[:：]\s*([^<>\r\n]+)$/iu);
        const value = standard?.[1] ?? bare?.[1];
        return isSingleEmoji(value) ? String(value).trim() : null;
    }

    function plausibleReactionFragment(line) {
        const compact = String(line || '').trim().toUpperCase().replace(/\s+/g, '');
        if (!compact) return false;
        if ('REACT:'.startsWith(compact) || 'REACT：'.startsWith(compact) || '<REACT:'.startsWith(compact)) return true;
        const open = compact.match(/^<?REACT[:：](.*)$/u);
        if (!open) return false;
        const value = open[1].replace(/>$/u, '');
        return !value || isSingleEmoji(value);
    }

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
            const marker = raw.trim().match(/^(`{3,}|~{3,})/);
            records.push({ start, end, raw, trimmed: raw.trim(), fenced, marker: Boolean(marker) });
            if (marker) fenced = !fenced;
            if (newline === source.length) break;
            start = newline + 1;
        }
        return records;
    }

    function lineEndWithNewline(source, end) {
        let offset = end;
        if (source[offset] === '\r') offset++;
        if (source[offset] === '\n') offset++;
        return offset;
    }

    // Display-only safety net for replies saved before server-side protocol
    // filtering existed, and for a malformed provider stream that slips past it.
    // Only standalone first/last boundary lines are eligible; prose and code
    // examples remain untouched.
    function extractReactionTag(content, { partial = false } = {}) {
        const source = String(content || '');
        let start = 0;
        let end = source.length;
        let reaction = null;
        let hadTag = false;
        let pending = false;
        const records = lineRecords(source);

        for (const record of records) {
            if (!record.trimmed) continue;
            if (record.fenced || record.marker || /^(?: {4,}|\t)/.test(record.raw)) break;
            const value = reactionLineValue(record.raw);
            if (value) {
                reaction = value;
                hadTag = true;
                start = lineEndWithNewline(source, record.end);
            } else if (partial && record.end === source.length && plausibleReactionFragment(record.raw)) {
                start = source.length;
                pending = true;
            }
            break;
        }

        const remaining = source.slice(start);
        const tailRecords = lineRecords(remaining);
        for (let index = tailRecords.length - 1; index >= 0; index--) {
            const record = tailRecords[index];
            if (!record.trimmed) continue;
            if (record.fenced || record.marker || /^(?: {4,}|\t)/.test(record.raw)) break;
            const value = reactionLineValue(record.raw);
            if (value) {
                reaction = value;
                hadTag = true;
                end = start + record.start;
            } else if (partial && record.end === remaining.length && plausibleReactionFragment(record.raw)) {
                end = start + record.start;
                pending = true;
            }
            break;
        }

        const cleanText = source.slice(start, Math.max(start, end)).trimEnd();
        return { cleanText, reaction, hadTag, pending };
    }

    function parseJsonBody(raw) {
        try {
            return JSON.parse(String(raw || '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim());
        } catch (_) {
            return null;
        }
    }

    function isWakePlan(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
        const keys = Object.keys(value).sort();
        if (keys.length !== WAKE_KEYS.length || keys.some((key, index) => key !== WAKE_KEYS[index])) return false;
        const after = value.after_minutes;
        const validAfter = Number.isFinite(Number(after)) || /^\d+(?:\.\d+)?\s*[mh]$/i.test(String(after || '').trim());
        return validAfter
            && URGENCIES.has(String(value.urgency || '').trim().toLowerCase())
            && typeof value.reason === 'string'
            && Boolean(value.reason.trim());
    }

    function trailingWakePlan(source) {
        // A provider occasionally drops either side of the wrapper. Ignore only
        // a closing fragment adjacent to the end while looking for the JSON;
        // it is removed permanently only after the body passes the strict schema.
        const candidateSource = String(source || '').replace(/\s*(?:<\s*\/?\s*NEXT_WAKE\s*>?|\/?\s*NEXT_WAKE\s*>?)\s*$/i, '').trimEnd();
        for (let index = candidateSource.lastIndexOf('{'); index >= 0; index = candidateSource.lastIndexOf('{', index - 1)) {
            const raw = candidateSource.slice(index).trim();
            let parsed;
            try { parsed = JSON.parse(raw); } catch (_) { continue; }
            if (!isWakePlan(parsed)) continue;
            const prefix = candidateSource.slice(0, index).replace(/\s*(?:<\s*)?NEXT_WAKE\b[^>\n]*(?:>\s*)?$/i, '').trimEnd();
            return { cleanText: prefix, plan: parsed };
        }
        return null;
    }

    function extractNextWakeTag(content) {
        const source = String(content || '');
        const plans = [];
        let cleanText = source.replace(/<NEXT_WAKE\s*>([\s\S]*?)<\/NEXT_WAKE\s*>/gi, (_match, raw) => {
            const parsed = parseJsonBody(raw);
            // Explicitly wrapped legacy plans keep their historical permissive
            // parsing; only wrapper-less JSON needs the strict schema guard.
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) plans.push(parsed);
            return '';
        });
        cleanText = cleanText.replace(/<NEXT_WAKE\b[^>]*\/>/gi, '');

        const trailing = trailingWakePlan(cleanText);
        if (trailing) {
            cleanText = trailing.cleanText;
            plans.push(trailing.plan);
        }

        // Old drafts and genuinely truncated wrappers must never leak. Without
        // valid complete JSON they deliberately fall back to the scheduler.
        cleanText = cleanText.replace(/<NEXT_WAKE\b[\s\S]*$/i, '').trim();
        return { cleanText, plan: plans.length ? plans[plans.length - 1] : null, tagCount: plans.length };
    }

    return Object.freeze({ extractNextWakeTag, extractReactionTag, isWakePlan });
});
