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
function selectMemoryMergeCandidate(content, tags, memories) {
    let winner = null;
    for (const memory of memories || []) {
        if (!memory || memory.pinned || memory.source === 'manual' || !memory.content) continue;
        const overlap = tagOverlap(tags, memory.tags);
        const similarity = bigramSimilarity(content, memory.content);
        if (!(overlap >= 2 || (overlap >= 1 && similarity >= 0.12) || similarity >= 0.48)) continue;
        const score = overlap * 0.5 + similarity;
        if (!winner || score > winner.score) winner = { memory, score, overlap, similarity };
    }
    return winner;
}
function mergeMemoryRevision(memory, input) {
    const now = input.now || new Date().toISOString(); const nextContent = String(input.content || '').trim();
    const previousVersions = Array.isArray(memory.previous_versions) ? memory.previous_versions.slice(-3) : [];
    if (nextContent && nextContent !== memory.content) previousVersions.push({ content: memory.content, tags: memory.tags || [], updated_at: memory.updated_at || memory.created_at || now });
    return { ...memory, content: nextContent || memory.content, tags: uniqueTags(memory.tags, input.tags), ttl: input.ttl || memory.ttl, expires_at: input.expires_at === undefined ? memory.expires_at : input.expires_at, arousal: Math.max(Number(memory.arousal || 0), Number(input.arousal || 0)), heat: Math.max(Number(memory.heat || 0), Number(input.arousal || 0)), emotional_weight: Math.max(Number(memory.emotional_weight || 0), Number(input.emotional_weight || 0)), last_accessed: Date.now(), updated_at: now, revision_count: Number(memory.revision_count || 0) + 1, previous_versions: previousVersions.slice(-4), last_source: input.source || memory.source };
}

module.exports = { bigramSimilarity, mergeMemoryRevision, selectMemoryMergeCandidate, tagOverlap, uniqueTags };
