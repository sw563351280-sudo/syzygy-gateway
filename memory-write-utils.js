'use strict';

// Match typography only; never discard words, numbers, or negation.
function canonical(text) {
    return String(text || '').normalize('NFKC').replace(/[，]/g, ',').replace(/[。]/g, '.')
        .replace(/[！]/g, '!').replace(/[？]/g, '?').replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'").replace(/\s+/g, '').replace(/[.!?]+$/g, '');
}

function matchSource(quote, sources) {
    const wanted = canonical(quote);
    if (wanted.length < 2) return null;
    for (const source of Array.isArray(sources) ? sources : [sources]) {
        const original = String(source || '');
        if (original.includes(quote)) return quote;
        // Keep original source evidence, even when typography was normalized.
        if (canonical(original).includes(wanted)) return original;
    }
    return null;
}

function isRecentCrumbDuplicate(existing, crumb, now) {
    const age = now.getTime() - new Date(existing?.created_at || 0).getTime();
    if (existing?.status === 'archived' || !Number.isFinite(age) || age < 0 || age > 8 * 3600000) return false;
    return canonical(existing?.source_quote) === canonical(crumb.source_quote)
        && canonical(existing?.fact) === canonical(crumb.fact);
}

function extractSaveMemoryTag(text) {
    const memories = [];
    let raw = 0;
    const cleanText = String(text || '').replace(/<\s*SAVE_MEMORY\b([^>]*)>([\s\S]*?)<\s*\/\s*SAVE_MEMORY\s*>/gi, (_, attrs, body) => {
        raw++;
        const match = attrs.match(/\btags\s*=\s*(?:"([^"]*)"|'([^']*)'|“([^”]*)”|([^\s>]+))/i);
        const tags = (match ? match.slice(1).find(x => x !== undefined) : '').split(/[,，;；、|]/).map(x => x.trim()).filter(Boolean);
        if (body.trim()) memories.push({ content: body.trim(), tags: tags.length ? tags : ['对话记忆'], ttl: 'perm' });
        return '';
    }).trim();
    return { cleanText, memories, rawTagCount: raw };
}

module.exports = { canonical, matchSource, isRecentCrumbDuplicate, extractSaveMemoryTag };
