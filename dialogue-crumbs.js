'use strict';

const { normalizeCrumbs } = require('./crumb-curator');

function parseJsonObject(raw) {
    const text = String(raw || '').replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
    let depth = 0; let start = -1;
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '{') { if (depth === 0) start = i; depth++; }
        else if (text[i] === '}') {
            depth--;
            if (depth === 0 && start >= 0) {
                try { return JSON.parse(text.slice(start, i + 1)); } catch (_) { start = -1; }
            }
        }
    }
    return null;
}

// The conversation model supplies the tag; this module only validates that it
// is grounded in the current user message before the server stores anything.
function extractDialogueCrumbTags(content, userText) {
    if (!content || typeof content !== 'string') return { cleanContent: content, crumbs: [], tagCount: 0 };
    const payloads = [];
    const cleanContent = content.replace(/<CRUMB>([\s\S]*?)<\/CRUMB>/gi, (_, raw) => {
        const payload = parseJsonObject(raw);
        if (payload) payloads.push(payload);
        return '';
    }).trim();
    // One independent detail is the hard per-response limit. normalizeCrumbs
    // also verifies source_quote against userText and constrains every field.
    const crumbs = normalizeCrumbs({ crumbs: payloads.slice(0, 1) }, userText);
    return { cleanContent, crumbs, tagCount: payloads.length };
}

module.exports = { extractDialogueCrumbTags, parseJsonObject };
