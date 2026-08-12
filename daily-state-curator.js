'use strict';

const DEFAULT_MODEL = 'gemini-3.1-pro-preview';

function stripCodeFences(text) {
    return String(text || '').replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
}

function findFirstJsonObject(text) {
    const source = stripCodeFences(text);
    let depth = 0;
    let start = -1;
    let inString = false;
    let escaped = false;
    for (let i = 0; i < source.length; i++) {
        const ch = source[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') { inString = true; continue; }
        if (ch === '{') { if (depth === 0) start = i; depth++; }
        else if (ch === '}') {
            depth--;
            if (depth === 0 && start >= 0) {
                try { return JSON.parse(source.slice(start, i + 1)); }
                catch (_) { start = -1; }
            }
        }
    }
    return null;
}

function normalizeUpdates(payload) {
    const candidates = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.updates)
            ? payload.updates
            : (payload && payload.key ? [payload] : []);

    const seen = new Set();
    const updates = [];
    for (const item of candidates.slice(0, 5)) {
        if (!item || typeof item !== 'object') continue;
        const key = String(item.key || '').trim().slice(0, 24);
        const value = String(item.value == null ? '' : item.value).trim().slice(0, 180);
        // 日常细节已交给 crumbs：状态槽只保留会被新值覆盖的 persistent 状态。
        const mode = item.mode;
        const confidence = Number(item.confidence);
        if (!key || !value || mode !== 'persistent') continue;
        if (Number.isFinite(confidence) && confidence < 0.72) continue;
        const signature = `${mode}:${key}:${value}`;
        if (seen.has(signature)) continue;
        seen.add(signature);
        const normalized = { key, value, mode, confidence: Number.isFinite(confidence) ? confidence : 0.8 };
        if (mode === 'persistent') {
            const days = Number(item.life_days);
            normalized.life_days = Number.isFinite(days) ? Math.min(30, Math.max(1, Math.round(days))) : 7;
        }
        updates.push(normalized);
    }
    return updates.slice(0, 3);
}

function isStateUpdateObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value)
        && typeof value.key === 'string'
        && Object.prototype.hasOwnProperty.call(value, 'value')
        && (value.mode === 'daily' || value.mode === 'persistent'));
}

function stripLeakedStateUpdates(content) {
    if (!content || typeof content !== 'string') return content || '';
    let clean = content.replace(/<STATE_UPDATE>[\s\S]*?<\/STATE_UPDATE>/gi, '');
    clean = clean.replace(/```(?:json)?\s*([\s\S]*?)```/gi, (block, raw) => {
        try { return isStateUpdateObject(JSON.parse(raw.trim())) ? '' : block; }
        catch (_) { return block; }
    });
    clean = clean.split(/\r?\n/).filter(line => {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return true;
        try { return !isStateUpdateObject(JSON.parse(trimmed)); }
        catch (_) { return true; }
    }).join('\n');
    // 某些渠道会剥掉标签和换行，把内部 JSON 直接粘在正文末尾。
    for (let idx = clean.lastIndexOf('{'); idx >= 0; idx = clean.lastIndexOf('{', idx - 1)) {
        const suffix = clean.slice(idx).trim();
        try {
            if (isStateUpdateObject(JSON.parse(suffix))) {
                clean = clean.slice(0, idx);
                break;
            }
        } catch (_) {}
    }
    return clean.replace(/\n{3,}/g, '\n\n').trim();
}

function shouldCurateMessage(userText) {
    const text = String(userText || '').trim();
    if (text.length < 2) return false;
    if (/^(?:嗯+|哦+|好+|行+|哈哈+|嘿+|hi|hello|test|测试)[~～!！。,.， ]*$/i.test(text)) return false;
    return true;
}

// A conservative local gate before using Pro. A missed transient detail stays
// in crumbs, while a false positive would cost an unnecessary model call.
function shouldCuratePersistentState(userText) {
    const text = String(userText || '').trim();
    if (!shouldCurateMessage(text) || text.length < 5) return false;
    if (/(?:codex|github|\bapi\b|\bbug\b|代码|编程|程序|模型|提示词|prompt|记忆库|界面|前端|后端|部署|服务器|数据库)/i.test(text)) return false;
    // Only open the Pro curator for facts that can replace a current slot.
    // Include phase changes such as holidays: “假期已经开始了” must be
    // able to overwrite an earlier work schedule, even without saying “上班”.
    const stateSubject = /(?:吃药|服药|用药|药物|维生素|保健品|过敏|复诊|治疗|诊断|美甲|甲油|染发|发色|护肤|隐形眼镜|眼镜|追剧|在看|在追|课程|上课|开学|放学|健身|减肥|忌口|作息|搬家|住在|工作安排|上班|加班|排班|请假|放假|休假|假期|高温假|停工|返工|复工)/;
    const continuity = /(?:正在|开始|刚开始|已经|已|最近|目前|现在|这阵子|这几天|接下来|改成|改了|换成|换了|调整|变成|停了|暂停|结束|不再|一直|持续|每天|以后|恢复|回去|延期|提前|推迟)/;
    return stateSubject.test(text) && continuity.test(text);
}

function buildCuratorMessages(userText, assistantText) {
    return [
        {
            role: 'system',
            content: `你是“溯星小屋”的后台近况管家。你的唯一任务是从江鱼本轮亲口说出的内容里提取需要暂存的生活近况，供后续对话使用。

只记录明确事实，不猜测，不把沈望的建议、推断、复述当成新事实。
daily：仅当天有用，例如吃了什么、穿了什么、去了哪里、当天安排、天气、临时身体状态。
persistent：未来几天仍有用且会被新值覆盖，例如正在吃的药、近期在追的剧、美甲颜色、短期计划。life_days 为1到30。
不要记录：单纯情绪宣泄、观点讨论、技术问题、角色扮演剧情、永久价值观、承诺、关系结论；这些属于其他记忆系统。
key 要稳定简短，例如“晚餐”“午餐”“当前位置”“身体状态”“近期用药”。同一事实不要拆成多条。
没有值得记录的内容时 updates 必须是空数组。
只输出 JSON：{"updates":[{"key":"晚餐","value":"妈妈做的韭菜馅饼","mode":"daily","confidence":0.95}]}`
        },
        {
            role: 'user',
            content: `【江鱼本轮原话】\n${String(userText || '').slice(0, 1800)}\n\n【沈望回复（仅用于消歧，不可作为事实来源）】\n${String(assistantText || '').slice(0, 1800)}`
        }
    ];
}

async function extractDailyStateUpdates(options) {
    const {
        fetchImpl,
        apiKey,
        endpoint = 'https://www.msuicode.com/v1/chat/completions',
        model = DEFAULT_MODEL,
        userText,
        assistantText,
        timeoutMs = 20000
    } = options || {};
    if (!shouldCurateMessage(userText) || !apiKey || typeof fetchImpl !== 'function') return [];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const requestBody = {
        model,
        messages: buildCuratorMessages(userText, assistantText),
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 500
    };
    const request = body => fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${String(apiKey).replace(/^Bearer\s+/i, '')}` },
        body: JSON.stringify(body),
        signal: controller.signal
    });
    let response;
    try {
        response = await request(requestBody);
        // 部分兼容 OpenAI 的中转不接受 response_format；只在参数错误时无格式重试一次。
        if (!response.ok && (response.status === 400 || response.status === 422)) {
            const fallbackBody = { ...requestBody };
            delete fallbackBody.response_format;
            response = await request(fallbackBody);
        }
    } finally {
        clearTimeout(timeout);
    }
    if (!response.ok) throw new Error(`daily curator API ${response.status}`);
    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content || '';
    const payload = findFirstJsonObject(raw);
    if (!payload) throw new Error('daily curator returned invalid JSON');
    return normalizeUpdates(payload);
}

module.exports = {
    DEFAULT_MODEL,
    buildCuratorMessages,
    extractDailyStateUpdates,
    findFirstJsonObject,
    normalizeUpdates,
    shouldCurateMessage,
    shouldCuratePersistentState,
    stripLeakedStateUpdates,
};
