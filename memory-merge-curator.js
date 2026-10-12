'use strict';

function jsonObjects(text) {
    const source = String(text || '').replace(/```(?:json)?\s*/gi, '').replace(/```/g, '');
    const objects = [];
    for (let start = source.indexOf('{'); start >= 0; start = source.indexOf('{', start + 1)) {
    let depth = 0, quoted = false, escaped = false, closed = false;
    for (let i = start; i < source.length; i++) {
        const ch = source[i];
        if (quoted) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') quoted = false; continue; }
        if (ch === '"') quoted = true;
        else if (ch === '{') depth++;
        else if (ch === '}' && --depth === 0) {
            try { objects.push(JSON.parse(source.slice(start, i + 1))); } catch (_) {}
            start = i; closed = true;
            break;
        }
    }
    if (!closed) break;
    }
    return objects;
}
function findJson(text) { return jsonObjects(text)[0] || null; }
function textParts(value) {
    if (typeof value === 'string') return [value];
    if (!Array.isArray(value)) return [];
    const text = value.filter(block => block?.thought !== true).map(block => typeof block?.text === 'string' ? block.text : typeof block?.text?.value === 'string' ? block.text.value : '').join('');
    return text ? [text] : [];
}
function invalidDecision(data, texts, detail) {
    const shape = data?.choices ? 'openai' : data?.candidates ? 'gemini' : data?.type === 'message' ? 'anthropic' : data?.output ? 'responses' : 'unknown';
    const reason = detail || (texts.some(text => text.trim()) ? '输出不是有效审核 JSON' : '没有返回审核正文');
    const error = new Error(`memory merge curator returned no valid decision：${reason}（格式 ${shape}，文本 ${texts.reduce((sum, text) => sum + text.length, 0)} 字符）。自动重试已停止，正文已保留，请人工确认。`);
    error.code = 'MEMORY_INVALID_DECISION';
    error.retryable = false;
    return error;
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
        if (!response.ok && (response.status === 400 || response.status === 422)) {
            const detail = await response.clone?.().text().catch(() => '') || '';
            if (/response_format|json_object/i.test(detail) && /unsupported|not supported|not allowed|不支持|unknown|unrecognized/i.test(detail)) {
                delete body.response_format; response = await request(body);
            }
        }
        if (!response.ok) {
            const error = new Error(`memory merge curator API ${response.status}`);
            error.retryable = response.status === 429 || response.status >= 500;
            throw error;
        }
        let data;
        try { data = await response.json(); } catch { throw invalidDecision(null, [], '返回体不是有效 JSON'); }
        const message = data?.choices?.[0]?.message || {};
        const finalTexts = [...textParts(message.content), ...textParts(data?.choices?.[0]?.text), ...textParts(data?.output_text),
            ...textParts(data?.content), ...(data?.candidates || []).flatMap(candidate => textParts(candidate?.content?.parts)),
            ...(data?.output || []).filter(item => item.type === 'message').flatMap(item => textParts(item.content))];
        const texts = [...finalTexts, ...textParts(message.reasoning_content)];
        const finish = data?.choices?.[0]?.finish_reason || data?.stop_reason || data?.candidates?.[0]?.finishReason;
        if (['length', 'max_tokens', 'MAX_TOKENS'].includes(finish) || data?.status === 'incomplete') throw invalidDecision(data, texts, '输出达到上限或被截断');
        if (message.refusal || data?.error) throw invalidDecision(data, texts, '上游返回拒绝或接口错误');
        for (const parsed of texts.flatMap(jsonObjects)) {
            if (parsed && ['new', 'create', 'same', 'update', 'supersede', 'conflict', 'review', 'skip'].includes(parsed.action)) {
                return normalizeDecision(parsed, incoming, candidates);
            }
        }
        throw invalidDecision(data, texts);
    } finally { clearTimeout(timer); }
}

module.exports = { buildMessages, decideMemoryWrite, findJson, normalizeDecision };
