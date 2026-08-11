'use strict';

function normalizeTag(value) { return String(value || '').trim().toLowerCase().replace(/\s+/g, ''); }
const GENERIC_TAGS = new Set(['江鱼', '沈望', '用户', '她', '我们', '关系', 'ai', 'gpt', '系统']);
function uniqueTags(...groups) {
    const seen = new Set(); const tags = [];
    for (const group of groups) for (const raw of (group || [])) {
        const tag = String(raw || '').trim(); const key = normalizeTag(tag);
        if (key && !seen.has(key)) { seen.add(key); tags.push(tag); }
    }
    return tags.slice(0, 10);
}
function cjkBigrams(value) {
    const compact = String(value || '').replace(/\d{4}[年\-/.]\d{1,2}[月\-/.]\d{1,2}[日号]?/g, '').replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, '').toLowerCase();
    const grams = new Set();
    for (let i = 0; i < compact.length - 1; i++) grams.add(compact.slice(i, i + 2));
    return grams;
}
function bigramSimilarity(left, right) {
    const a = cjkBigrams(left); const b = cjkBigrams(right);
    if (!a.size || !b.size) return 0;
    let intersection = 0; for (const gram of a) if (b.has(gram)) intersection++;
    return intersection / (a.size + b.size - intersection);
}
function tagOverlap(left, right) {
    const a = new Set((left || []).map(normalizeTag).filter(tag => tag && !GENERIC_TAGS.has(tag)));
    return (right || []).map(normalizeTag).filter(tag => tag && !GENERIC_TAGS.has(tag) && a.has(tag)).length;
}
function mergeMemoryRevision(memory, input) {
    const now = input.now || new Date().toISOString(); const nextContent = String(input.content || '').trim();
    const history = Array.isArray(memory.history) ? [...memory.history] : (Array.isArray(memory.previous_versions) ? memory.previous_versions.map(item => ({ at: item.updated_at, snapshot: item.content, tags: item.tags || [], kind: 'legacy' })) : []);
    if (!history.length) history.push({ at: memory.created_at || now, snapshot: memory.content, tags: memory.tags || [], kind: 'created' });
    if (nextContent && nextContent !== memory.content) history.push({ at: now, snapshot: nextContent, tags: uniqueTags(memory.tags, input.tags), kind: 'updated' });
    return { ...memory, content: nextContent || memory.content, tags: uniqueTags(memory.tags, input.tags), ttl: input.ttl || memory.ttl, expires_at: input.expires_at === undefined ? memory.expires_at : input.expires_at, arousal: Math.max(Number(memory.arousal || 0), Number(input.arousal || 0)), heat: Math.max(Number(memory.heat || 0), Number(input.arousal || 0)), emotional_weight: Math.max(Number(memory.emotional_weight || 0), Number(input.emotional_weight || 0)), last_accessed: Date.now(), updated_at: now, revision_count: Number(memory.revision_count || 0) + 1, history, last_source: input.source || memory.source };
}

module.exports = { bigramSimilarity, mergeMemoryRevision, tagOverlap, uniqueTags };
