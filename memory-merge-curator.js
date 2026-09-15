'use strict';

function findJson(text) {
    const source = String(text || '').replace(/```(?:json)?\s*/gi, '').replace(/```/g, '');
    const start = source.indexOf('{'); if (start < 0) return null;
    let depth = 0, quoted = false, escaped = false;
    for (let i = start; i < source.length; i++) {
        const ch = source[i];
        if (quoted) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') quoted = false; continue; }
        if (ch === '"') quoted = true;
        else if (ch === '{') depth++;
        else if (ch === '}' && --depth === 0) { try { return JSON.parse(source.slice(start, i + 1)); } catch (_) { return null; } }
    }
    return null;
}

function normalizeDecision(payload, incoming, candidates) {
    const actions = new Set(['new', 'update', 'review', 'skip']);
    const action = actions.has(payload?.action) ? payload.action : 'review';
    const ids = new Set((candidates || []).map(item => item.id));
    const target_id = ids.has(payload?.target_id) ? payload.target_id : null;
    const content = String(payload?.content || incoming.content || '').trim().slice(0, 500);
    const tags = (Array.isArray(payload?.tags) ? payload.tags : incoming.tags || []).map(x => String(x || '').trim()).filter(x => x.length >= 2).slice(0, 10);
    if (action === 'update' && !target_id) return { action: 'review', target_id: null, content, tags, reason: '更新目标不明确', confidence: 0 };
    return { action, target_id, content, tags, reason: String(payload?.reason || '').trim().slice(0, 120), confidence: Math.max(0, Math.min(1, Number(payload?.confidence) || 0)) };
}

function buildMessages(incoming, candidates) {
    const compactCandidates = (candidates || []).map(item => ({ id: item.id, similarity: Number(item.similarity || 0).toFixed(3), shared_tags: item.shared_tags || [], content: item.content, tags: item.tags || [], updated_at: item.updated_at || item.created_at || null }));
    return [
        { role: 'system', content: '你是长期记忆写入前的审稿人。长期记忆只存“句号”：稳定的核心认知、最终规则、重大事件结论或用户明确要留下的内容；讨论中的中间过程应 action=skip。候选只来自向量检索，不能猜测其他记忆。输出 JSON：{"action":"new|update|review|skip","target_id":"候选id或null","content":"最新且完整的结论","tags":["..."],"reason":"...","confidence":0-1}。content 必须是沈望第一人称的记录：我=沈望、她=江鱼，像“我记着她最后决定……”，禁止“江鱼/你/沈望”与客观报告腔。update 仅限新内容与某个候选确为同一件持续事项；相关但不同事项用 new；不确定用 review。绝不更新手动或固定记忆。' },
        { role: 'user', content: `【准备写入】\n${JSON.stringify(incoming)}\n\n【向量候选（最多3条）】\n${JSON.stringify(compactCandidates)}` }
    ];
}

async function decideMemoryWrite(options) {
    const { fetchImpl, apiKey, endpoint, model, incoming, candidates, timeoutMs = 20000 } = options || {};
    if (!fetchImpl || !apiKey) return { action: 'review', target_id: null, content: incoming.content, tags: incoming.tags, reason: '缺少审稿模型配置', confidence: 0 };
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${String(apiKey).replace(/^Bearer\s+/i, '')}` };
    const body = { model, messages: buildMessages(incoming, candidates), response_format: { type: 'json_object' }, temperature: 0, max_tokens: 500 };
    const request = value => fetchImpl(endpoint, { method: 'POST', headers, body: JSON.stringify(value), signal: controller.signal });
    try {
        let response = await request(body);
        if (!response.ok && (response.status === 400 || response.status === 422)) { delete body.response_format; response = await request(body); }
        if (!response.ok) throw new Error(`memory merge curator API ${response.status}`);
        const data = await response.json();
        const message = data?.choices?.[0]?.message || {};
        for (const raw of [message.content, message.reasoning_content, data?.choices?.[0]?.text, data?.output_text]) {
            const parsed = typeof raw === 'string' ? findJson(raw) : null;
            if (parsed && ['new', 'update', 'review', 'skip'].includes(parsed.action)) {
                return normalizeDecision(parsed, incoming, candidates);
            }
        }
        throw new Error('memory merge curator returned no valid decision');
    } finally { clearTimeout(timer); }
}

module.exports = { buildMessages, decideMemoryWrite, findJson, normalizeDecision };
