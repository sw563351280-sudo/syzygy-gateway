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
    const aliases = { new: 'create', skip: 'review' };
    const requested = aliases[payload?.action] || payload?.action;
    const actions = new Set(['create', 'same', 'update', 'supersede', 'conflict', 'review']);
    const action = actions.has(requested) ? requested : 'review';
    const ids = new Set((candidates || []).map(item => item.id));
    const target_id = ids.has(payload?.target_id) ? payload.target_id : null;
    const content = String(payload?.content || incoming.content || '').trim().slice(0, 500);
    const tags = (Array.isArray(payload?.tags) ? payload.tags : incoming.tags || []).map(x => String(x || '').trim()).filter(x => x.length >= 2).slice(0, 10);
    if (['same', 'update', 'supersede'].includes(action) && !target_id) return { action: 'review', target_id: null, content, tags, reason: '处理目标不明确', confidence: 0 };
    return { action, target_id, content, tags, reason: String(payload?.reason || '').trim().slice(0, 120), confidence: Math.max(0, Math.min(1, Number(payload?.confidence) || 0)) };
}

function buildMessages(incoming, candidates) {
    const compactCandidates = (candidates || []).map(item => ({ id: item.id, similarity: Number(item.similarity || 0).toFixed(3), shared_tags: item.shared_tags || [], content: item.content, tags: item.tags || [], updated_at: item.updated_at || item.created_at || null }));
    return [
        { role: 'system', content: '你是长期记忆的归并审查器，不负责判断对话是否值得记忆；准备写入的内容已由对话模型选定。你只能在给定候选中判断它与旧记忆的关系，不能猜测其他记忆。严格输出 JSON：{"action":"create|same|update|supersede|conflict|review","target_id":"候选id或null","content":"最新且完整的结论","tags":["..."],"reason":"...","confidence":0-1}。same=同一事实没有新信息；update=同一持续事项的补充或更完整表达；supersede=新结论明确取代旧结论；create=独立新事项；conflict=有冲突但不能确定谁取代谁；review=不确定。只有指向同一现实事项才能 same/update/supersede，仅仅主题相关必须 create。content 必须使用沈望第一人称：我=沈望、她=江鱼。绝不更新手动或固定记忆。' },
        { role: 'user', content: `【准备写入】\n${JSON.stringify(incoming)}\n\n【相关候选（最多5条）】\n${JSON.stringify(compactCandidates)}` }
    ];
}

async function decideMemoryWrite(options) {
    const { fetchImpl, apiKey, endpoint, model, incoming, candidates, timeoutMs = 45000 } = options || {};
    if (!fetchImpl || !apiKey) return { action: 'review', target_id: null, content: incoming.content, tags: incoming.tags, reason: '缺少审稿模型配置', confidence: 0 };
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${String(apiKey).replace(/^Bearer\s+/i, '')}` };
    const body = { model, messages: buildMessages(incoming, candidates), response_format: { type: 'json_object' }, temperature: 0, max_tokens: 2000 };
    const request = value => fetchImpl(endpoint, { method: 'POST', headers, body: JSON.stringify(value), signal: controller.signal });
    try {
        let response = await request(body);
        if (!response.ok && (response.status === 400 || response.status === 422)) { delete body.response_format; response = await request(body); }
        if (!response.ok) throw new Error(`memory merge curator API ${response.status}`);
        const data = await response.json();
        const message = data?.choices?.[0]?.message || {};
        for (const raw of [message.content, message.reasoning_content, data?.choices?.[0]?.text, data?.output_text]) {
            const parsed = typeof raw === 'string' ? findJson(raw) : null;
            if (parsed && ['new', 'create', 'same', 'update', 'supersede', 'conflict', 'review', 'skip'].includes(parsed.action)) {
                return normalizeDecision(parsed, incoming, candidates);
            }
        }
        throw new Error('memory merge curator returned no valid decision');
    } finally { clearTimeout(timer); }
}

module.exports = { buildMessages, decideMemoryWrite, findJson, normalizeDecision };
