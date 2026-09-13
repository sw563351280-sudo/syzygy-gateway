'use strict';

const { normalizeCrumbs } = require('./crumb-curator');

function parseJsonObject(raw) {
    const text = String(raw || '').replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
    let depth = 0; let start = -1; let quoted = false; let escaped = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quoted) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') quoted = false;
            continue;
        }
        if (ch === '"') { quoted = true; continue; }
        if (ch === '{') { if (depth === 0) start = i; depth++; }
        else if (ch === '}') {
            depth--;
            if (depth === 0 && start >= 0) {
                const candidate = text.slice(start, i + 1);
                try { return JSON.parse(candidate); } catch (_) {
                    // Some models emit an otherwise valid object with literal
                    // line breaks inside a string. Repair only those control
                    // characters, then make one conservative parse retry.
                    let repaired = ''; let inString = false; let escapedChar = false;
                    for (const char of candidate) {
                        if (inString && (char === '\n' || char === '\r')) { repaired += char === '\n' ? '\\n' : '\\r'; continue; }
                        repaired += char;
                        if (inString) {
                            if (escapedChar) escapedChar = false;
                            else if (char === '\\') escapedChar = true;
                            else if (char === '"') inString = false;
                        } else if (char === '"') inString = true;
                    }
                    try { return JSON.parse(repaired.replace(/,\s*([}\]])/g, '$1')); } catch (_) { start = -1; }
                }
            }
        }
    }
    return null;
}

// The conversation model supplies the tag; this module only validates that it
// is grounded in the current user message before the server stores anything.
function extractDialogueCrumbTags(content, userText) {
    if (!content || typeof content !== 'string') return { cleanContent: content, crumbs: [], tagCount: 0, rawTagCount: 0, invalidTagCount: 0 };
    const payloads = []; let rawTagCount = 0; let invalidTagCount = 0;
    const cleanContent = content.replace(/<CRUMB>([\s\S]*?)<\/CRUMB>/gi, (_, raw) => {
        rawTagCount++;
        const payload = parseJsonObject(raw);
        if (payload) payloads.push(payload);
        else invalidTagCount++;
        return '';
    }).trim();
    // One independent detail is the hard per-response limit. normalizeCrumbs
    // also verifies source_quote against userText and constrains every field.
    const crumbs = normalizeCrumbs({ crumbs: payloads.slice(0, 1) }, userText);
    return { cleanContent, crumbs, tagCount: payloads.length, rawTagCount, invalidTagCount };
}

module.exports = { extractDialogueCrumbTags, parseJsonObject };
