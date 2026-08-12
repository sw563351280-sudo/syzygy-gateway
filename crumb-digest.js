'use strict';

function findJson(text) {
    const source = String(text || '').replace(/```(?:json)?\s*/gi, '').replace(/```/g, '');
    const start = source.indexOf('{');
    const end = source.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try { return JSON.parse(source.slice(start, end + 1)); }
    catch (_) { return null; }
}

function normalizeDigest(payload, sourceCount) {
    const summary = String(payload?.summary || '').trim().slice(0, 500);
    const themes = (Array.isArray(payload?.themes) ? payload.themes : [])
        .map(value => String(value || '').trim().slice(0, 24)).filter(Boolean).slice(0, 5);
    const memoryCandidates = (Array.isArray(payload?.memory_candidates) ? payload.memory_candidates : [])
        .slice(0, 1).map(item => ({
            content: String(item?.content || '').trim().slice(0, 300),
            tags: (Array.isArray(item?.tags) ? item.tags : []).map(value => String(value || '').trim().slice(0, 20)).filter(value => value.length >= 2).slice(0, 3),
            reason: String(item?.reason || '').trim().slice(0, 120),
        })).filter(item => item.content.length >= 10 && item.tags.length > 0);
    return { summary, themes, memory_candidates: memoryCandidates, source_count: Number(sourceCount || 0) };
}

function buildDigestMessages(date, crumbs) {
    const facts = crumbs.map((crumb, index) => ({
        index: index + 1,
        fact: String(crumb.fact || '').slice(0, 200),
        entities: Array.isArray(crumb.entities) ? crumb.entities.slice(0, 4) : [],
        tags: Array.isArray(crumb.tags) ? crumb.tags.slice(0, 4) : [],
    }));
    return [{ role: 'system', content: [
        '你是生活碎屑的昨日整理员。只依据提供的事实，不补写、不猜测。',
        '先把同一件事的多条进展合并成简短、自然的一段昨日小结。小结不是长期记忆，只用于日后回看。',
        '只有已经形成稳定结论、持续状态、重要事件结果，或明确规则/认知的“句号”，才给 memory_candidates；过程、计划、中间进展、普通生活细节一律不升级。',
        'memory_candidates 最多1条。拿不准就给空数组。',
        '只输出JSON：{"summary":"","themes":[],"memory_candidates":[{"content":"","tags":[],"reason":""}]}',
    ].join('\n') }, { role: 'user', content: `${date} 的生活碎屑：\n${JSON.stringify(facts, null, 2)}` }];
}

async function createCrumbDigest(options) {
    const { fetchImpl, apiKey, endpoint, model, date, crumbs, timeoutMs = 30000 } = options || {};
    if (!fetchImpl || !apiKey || !Array.isArray(crumbs) || crumbs.length === 0) return normalizeDigest({}, crumbs?.length || 0);
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${String(apiKey).replace(/^Bearer\s+/i, '')}` };
    const body = { model, messages: buildDigestMessages(date, crumbs), response_format: { type: 'json_object' }, temperature: 0.1, max_tokens: 900 };
    const request = () => fetchImpl(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    let response = await request();
    if (!response.ok && (response.status === 400 || response.status === 422)) { delete body.response_format; response = await request(); }
    if (!response.ok) throw new Error(`crumb digest API ${response.status}`);
    return normalizeDigest(findJson((await response.json())?.choices?.[0]?.message?.content || ''), crumbs.length);
}

module.exports = { buildDigestMessages, createCrumbDigest, findJson, normalizeDigest };
