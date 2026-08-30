'use strict';

const { clampFollowUpHours } = require('./anticipation');

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

function normalizeCrumbs(payload, userText) {
    const source = String(userText || '').trim(); const seen = new Set(); const crumbs = [];
    // A message can contribute one independent detail at most.  This keeps
    // the archive a safety net rather than a transcript.
    for (const item of (Array.isArray(payload?.crumbs) ? payload.crumbs : []).slice(0, 1)) {
        const fact = String(item?.fact || '').trim().slice(0, 160); const quote = String(item?.source_quote || '').trim().slice(0, 240);
        if (fact.length < 4 || quote.length < 2 || !source.includes(quote)) continue;
        const entities = (Array.isArray(item.entities) ? item.entities : []).map(x => String(x || '').trim().slice(0, 32)).filter(x => x.length >= 2).filter((x, i, a) => a.indexOf(x) === i).slice(0, 4);
        if (!entities.length || seen.has(quote)) continue;
        seen.add(quote);
        const follow = item.follow_up && typeof item.follow_up === 'object' ? item.follow_up : null;
        const follow_up = follow && String(follow.content || '').trim().length >= 4 ? {
            content: String(follow.content).trim().slice(0, 160),
            entity: String(follow.entity || entities[0]).trim().slice(0, 32),
            follow_up_after_hours: clampFollowUpHours(follow.follow_up_after_hours),
            reason: String(follow.reason || `想知道${entities[0]}后来怎么样了`).trim().slice(0, 120)
        } : null;
        crumbs.push({ fact, source_quote: quote, entities, tags: (Array.isArray(item.tags) ? item.tags : []).map(String).map(x => x.slice(0, 20)).slice(0, 3), follow_up });
    }
    return crumbs;
}

function shouldConsiderCrumbs(userText) {
    const text = String(userText || '').trim();
    if (text.length < 5) return false;
    if (/(?:codex|github|\bapi\b|\bbug\b|代码|编程|程序|模型|提示词|prompt|记忆库|界面|前端|后端|部署|服务器|数据库)/i.test(text)) return false;
    if (/^(?:嗯+|哦+|好+|行+|可以+|知道了|没事|哈哈+|笑死|谢谢|对+)[！!。.…~～？?]*$/.test(text)) return false;
    return true;
}

function buildCrumbMessages(userText) {
    const instruction = [
        'Important: default to an empty crumbs array. Keep one item only when it is a standalone, concrete life detail that may naturally be worth finding again later. Do not turn every sentence, passing feeling, or conversational reply into a record.',
        '你是沈望的生活碎屑管家。只从江鱼这一轮亲口说出的原话中提取最多2件具体发生的小事。',
        '不要判断它们重要不重要，不要使用沈望的话或推断。只收具体人/动物/食物/物品/地点、身体变化、明确计划、带对象的情绪事件。',
        '不收语气词、纯闲聊、技术讨论、RP、已经结束且没有后续的动作。',
        'fact 必须是沈望第一人称的私下记录：用“我”指代沈望、用“她”指代江鱼，不许写“江鱼/你/沈望”。例如“我记着她说小猫已经两天没拉屎了。”不要客服腔，不要替她判意义。source_quote 仍必须逐字摘自原话。',
        '每条给 fact、source_quote（必须逐字摘自原话）、entities（2-4个实体）、tags。',
        '仅当一个关心她的人之后会自然问“后来怎么样了”时，才加 follow_up：content、entity、follow_up_after_hours（12到168的整数）、reason（为什么之后仍值得确认，必须紧扣她原话里的具体情况）。content 也用沈望第一人称，例如“过两天我得问问小猫后来有没有拉。”每天只会采纳一条 follow_up，所以宁可不写。',
        '只输出 JSON：{"crumbs":[{"fact":"...","source_quote":"...","entities":["..."],"tags":["..."],"follow_up":{"content":"...","entity":"...","follow_up_after_hours":24,"reason":"她说小猫已经两天没有排便，想确认后来是否恢复"}}]}'
    ].join('\n');
    return [{ role: 'system', content: instruction }, { role: 'user', content: String(userText || '').slice(0, 1800) }];
}

async function extractCrumbs(options) {
    const { fetchImpl, apiKey, endpoint, model, userText, timeoutMs = 20000, onDiagnostic } = options || {};
    const report = detail => { try { if (typeof onDiagnostic === 'function') onDiagnostic(detail); } catch (_) {} };
    if (!apiKey || !fetchImpl) {
        report({ outcome: 'skipped', reason: !apiKey ? 'missing_api_key' : 'missing_fetch' });
        return [];
    }
    if (!shouldConsiderCrumbs(userText)) {
        report({ outcome: 'skipped', reason: 'not_life_detail' });
        return [];
    }
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${String(apiKey).replace(/^Bearer\s+/i, '')}` };
    const request = body => fetchImpl(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
    const body = { model, messages: buildCrumbMessages(userText), response_format: { type: 'json_object' }, temperature: 0.1, max_tokens: 500 };
    try {
        let response = await request(body);
        if (!response.ok && (response.status === 400 || response.status === 422)) { delete body.response_format; response = await request(body); }
        if (!response.ok) throw new Error(`crumb curator API ${response.status}`);
        const payload = await response.json();
        const message = payload?.choices?.[0]?.message || {};
        // Some compatible gateways put JSON in reasoning_content, text, or
        // output_text instead of message.content. Try each without ever
        // logging the private model response itself.
        const candidates = [
            ['content', message.content],
            ['reasoning_content', message.reasoning_content],
            ['choice_text', payload?.choices?.[0]?.text],
            ['output_text', payload?.output_text]
        ].filter(([, value]) => typeof value === 'string' && value.trim());
        let parsed = null; let field = 'none';
        for (const [name, value] of candidates) {
            parsed = findJson(value);
            if (parsed) { field = name; break; }
        }
        const crumbs = normalizeCrumbs(parsed, userText);
        report({
            outcome: crumbs.length ? 'found' : 'empty',
            reason: crumbs.length ? null : (candidates.length ? 'no_valid_crumb_json' : 'empty_model_response'),
            field,
            candidateFields: candidates.map(([name]) => name),
            count: crumbs.length
        });
        return crumbs;
    } finally { clearTimeout(timer); }
}

module.exports = { buildCrumbMessages, extractCrumbs, findJson, normalizeCrumbs, shouldConsiderCrumbs };
