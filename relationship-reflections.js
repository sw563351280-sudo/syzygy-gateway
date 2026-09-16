'use strict';

const crypto = require('node:crypto');

const STAGES = new Set(['context', 'trigger', 'escalation', 'rupture', 'repair', 'resolution', 'aftermath']);
const CLOSING_STAGES = new Set(['repair', 'resolution', 'aftermath']);

function emptyRelationshipStore() {
    return { version: 1, episodes: [], insights: [], processed: {}, updated_at: null };
}

function normalizeStore(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
        version: 1,
        episodes: Array.isArray(source.episodes) ? source.episodes : [],
        insights: Array.isArray(source.insights) ? source.insights : [],
        processed: source.processed && typeof source.processed === 'object' ? source.processed : {},
        updated_at: source.updated_at || null,
    };
}

function compactText(value, limit = 500) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function uniqueStrings(values, limit = 20) {
    return [...new Set((values || []).map(value => compactText(value, 80)).filter(Boolean))].slice(0, limit);
}

function memorySignature(memory) {
    return crypto.createHash('sha256').update(JSON.stringify({
        id: memory?.id || '',
        content: compactText(memory?.content, 2000),
        tags: uniqueStrings(memory?.tags, 20),
    })).digest('hex').slice(0, 20);
}

function looksRelationshipRelevant(memory) {
    const text = `${(memory?.tags || []).join(' ')} ${memory?.content || ''} ${memory?.source_quote || ''}`;
    return /吵架|争吵|争执|冲突|冷战|误会|和好|道歉|原谅|修复|磨合|沟通|关系|相处|委屈|生气|难过|伤害|安慰|哄|边界|信任|安全感|疏远|亲密|吃醋|嫉妒|不被理解|被忽略|情绪升级|情绪失控/.test(text);
}

function findJson(text) {
    const source = String(text || '').replace(/```(?:json)?\s*/gi, '').replace(/```/g, '');
    const start = source.indexOf('{');
    if (start < 0) return null;
    let depth = 0; let quoted = false; let escaped = false;
    for (let i = start; i < source.length; i++) {
        const ch = source[i];
        if (quoted) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') quoted = false;
            continue;
        }
        if (ch === '"') quoted = true;
        else if (ch === '{') depth++;
        else if (ch === '}' && --depth === 0) {
            try { return JSON.parse(source.slice(start, i + 1)); } catch (_) { return null; }
        }
    }
    return null;
}

function evidenceIds(store, memory) {
    const ids = new Set([memory?.id].filter(Boolean));
    for (const episode of store.episodes || []) {
        for (const event of episode.events || []) if (event.memory_id) ids.add(event.memory_id);
    }
    return ids;
}

function normalizeInsight(raw, allowedIds, closingStage) {
    if (!closingStage || !raw || typeof raw !== 'object') return null;
    const key = compactText(raw.key || raw.title, 80).toLowerCase();
    const observation = compactText(raw.observation, 360);
    const lesson = compactText(raw.lesson, 360);
    const nextTime = compactText(raw.next_time, 360);
    if (!key || !observation || !lesson || !nextTime) return null;
    const support = uniqueStrings(raw.support_memory_ids, 20).filter(id => allowedIds.has(id));
    const counter = uniqueStrings(raw.counter_memory_ids, 20).filter(id => allowedIds.has(id) && !support.includes(id));
    if (!support.length) return null;
    return { key, title: compactText(raw.title || raw.key, 80), observation, lesson, next_time: nextTime, support_memory_ids: support, counter_memory_ids: counter };
}

function normalizeDecision(payload, memory, store) {
    const eligible = payload?.eligible === true;
    if (!eligible) return { eligible: false, reason: compactText(payload?.reason, 160) || '不是需要整理的关系过程' };

    const episodeIds = new Set((store.episodes || []).map(item => item.id));
    let episodeAction = ['create', 'attach', 'none'].includes(payload?.episode_action) ? payload.episode_action : 'create';
    let episodeId = episodeIds.has(payload?.episode_id) ? payload.episode_id : null;
    if (episodeAction === 'attach' && !episodeId) episodeAction = 'create';
    if (episodeAction !== 'attach') episodeId = null;

    const stage = STAGES.has(payload?.event?.stage) ? payload.event.stage : 'context';
    const status = payload?.episode?.status === 'resolved' ? 'resolved' : 'open';
    const allowedIds = evidenceIds(store, memory);
    const insights = (Array.isArray(payload?.insights) ? payload.insights : [])
        .map(item => normalizeInsight(item, allowedIds, status === 'resolved' || CLOSING_STAGES.has(stage)))
        .filter(Boolean)
        .slice(0, 3);

    return {
        eligible: true,
        reason: compactText(payload?.reason, 160),
        episode_action: episodeAction,
        episode_id: episodeId,
        episode: {
            title: compactText(payload?.episode?.title, 80) || '一次沟通与修复',
            summary: compactText(payload?.episode?.summary, 500),
            status,
            themes: uniqueStrings(payload?.episode?.themes, 8),
        },
        event: {
            stage,
            summary: compactText(payload?.event?.summary, 500) || compactText(memory?.content, 500),
            occurred_at: payload?.event?.occurred_at || memory?.source_at || memory?.created_at || new Date().toISOString(),
        },
        insights,
    };
}

function confidenceForInsight(insight, episodes) {
    const support = new Set(insight.support_memory_ids || []);
    const counterCount = new Set(insight.counter_memory_ids || []).size;
    const supportingEpisodes = (episodes || []).filter(episode => (episode.events || []).some(event => support.has(event.memory_id))).length;
    if (support.size >= 3 && supportingEpisodes >= 2 && counterCount === 0) return 'stable';
    if (support.size >= 2) return 'developing';
    return 'tentative';
}

function applyDecision(rawStore, memory, decision, now = new Date()) {
    const store = JSON.parse(JSON.stringify(normalizeStore(rawStore)));
    const timestamp = now.toISOString();
    const signature = memorySignature(memory);
    if (store.processed[memory.id]?.signature === signature) return { store, changed: false, episode: null, insights: [] };

    if (!decision?.eligible || decision.episode_action === 'none') {
        store.processed[memory.id] = { signature, eligible: false, reason: compactText(decision?.reason, 160), processed_at: timestamp };
        store.updated_at = timestamp;
        return { store, changed: true, episode: null, insights: [] };
    }

    let episode = decision.episode_action === 'attach'
        ? store.episodes.find(item => item.id === decision.episode_id)
        : null;
    if (!episode) {
        episode = {
            id: `rel_${now.getTime().toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
            title: decision.episode.title,
            summary: decision.episode.summary,
            status: decision.episode.status,
            themes: decision.episode.themes,
            started_at: decision.event.occurred_at,
            ended_at: decision.episode.status === 'resolved' ? decision.event.occurred_at : null,
            created_at: timestamp,
            updated_at: timestamp,
            events: [],
        };
        store.episodes.push(episode);
    }

    const existingEvent = (episode.events || []).find(item => item.memory_id === memory.id);
    const event = {
        id: existingEvent?.id || `revt_${compactText(memory.id, 60)}`,
        memory_id: memory.id,
        stage: decision.event.stage,
        summary: decision.event.summary,
        occurred_at: decision.event.occurred_at,
        source_quote: compactText(memory.source_quote, 500),
        created_at: existingEvent?.created_at || timestamp,
        updated_at: timestamp,
    };
    episode.events = (episode.events || []).filter(item => item.memory_id !== memory.id);
    episode.events.push(event);
    episode.events.sort((a, b) => new Date(a.occurred_at || 0) - new Date(b.occurred_at || 0));
    episode.started_at = episode.events[0]?.occurred_at || episode.started_at;
    episode.title = decision.episode.title || episode.title;
    episode.summary = decision.episode.summary || episode.summary;
    episode.themes = uniqueStrings([...(episode.themes || []), ...(decision.episode.themes || [])], 10);
    episode.status = decision.episode.status === 'resolved' ? 'resolved' : episode.status;
    if (episode.status === 'resolved') episode.ended_at = decision.event.occurred_at || episode.ended_at || timestamp;
    episode.updated_at = timestamp;

    const touchedInsights = [];
    for (const incoming of decision.insights || []) {
        let insight = store.insights.find(item => item.key === incoming.key);
        if (!insight) {
            insight = {
                id: `rins_${now.getTime().toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
                key: incoming.key,
                title: incoming.title,
                observation: incoming.observation,
                lesson: incoming.lesson,
                next_time: incoming.next_time,
                support_memory_ids: [],
                counter_memory_ids: [],
                episode_ids: [],
                confidence: 'tentative',
                revision_history: [],
                created_at: timestamp,
                updated_at: timestamp,
            };
            store.insights.push(insight);
        } else if ([incoming.observation, incoming.lesson, incoming.next_time].some((value, index) => value !== [insight.observation, insight.lesson, insight.next_time][index])) {
            insight.revision_history = Array.isArray(insight.revision_history) ? insight.revision_history : [];
            insight.revision_history.push({ at: timestamp, observation: insight.observation, lesson: insight.lesson, next_time: insight.next_time, confidence: insight.confidence });
            insight.revision_history = insight.revision_history.slice(-20);
        }
        insight.title = incoming.title;
        insight.observation = incoming.observation;
        insight.lesson = incoming.lesson;
        insight.next_time = incoming.next_time;
        insight.support_memory_ids = uniqueStrings([...(insight.support_memory_ids || []), ...incoming.support_memory_ids], 50);
        insight.counter_memory_ids = uniqueStrings([...(insight.counter_memory_ids || []), ...incoming.counter_memory_ids], 50)
            .filter(id => !insight.support_memory_ids.includes(id));
        insight.episode_ids = uniqueStrings([...(insight.episode_ids || []), episode.id], 30);
        insight.confidence = confidenceForInsight(insight, store.episodes);
        insight.updated_at = timestamp;
        touchedInsights.push(insight);
    }

    store.processed[memory.id] = { signature, eligible: true, episode_id: episode.id, processed_at: timestamp };
    store.updated_at = timestamp;
    return { store, changed: true, episode, insights: touchedInsights };
}

function buildMessages(memory, store) {
    const episodes = (store.episodes || []).slice(-10).map(item => ({
        id: item.id, title: item.title, status: item.status, themes: item.themes,
        summary: item.summary, events: (item.events || []).slice(-8).map(event => ({ memory_id: event.memory_id, stage: event.stage, occurred_at: event.occurred_at, summary: event.summary })),
    }));
    const insights = (store.insights || []).slice(-12).map(item => ({
        key: item.key, title: item.title, observation: item.observation, lesson: item.lesson,
        next_time: item.next_time, confidence: item.confidence,
        support_memory_ids: item.support_memory_ids, counter_memory_ids: item.counter_memory_ids,
    }));
    const schema = {
        eligible: true,
        reason: '为什么属于或不属于一段关系过程',
        episode_action: 'create|attach|none',
        episode_id: '只可使用候选 episode id；新建或不归类时为 null',
        episode: { title: '中性的片段标题', summary: '截至当前的过程摘要', status: 'open|resolved', themes: ['沟通主题'] },
        event: { stage: 'context|trigger|escalation|rupture|repair|resolution|aftermath', summary: '本条在过程中的作用', occurred_at: 'ISO 时间' },
        insights: [{ key: '稳定模式键', title: '心得标题', observation: '仅陈述证据支持的模式', lesson: '沈望学到了什么', next_time: '下次可尝试的具体做法', support_memory_ids: ['证据id'], counter_memory_ids: ['反例id'] }],
    };
    return [
        {
            role: 'system',
            content: `你是“关系过程整理器”，不是人格诊断师，也不负责判断谁对谁错。把与现实关系有关的记忆组织成可追溯的过程，并在修复或阶段结束后生成可修正心得。\n\n规则：\n1. 不是所有记忆都属于事件；单独的情绪、普通事实、工作、健康、RP 一律 eligible=false。\n2. 只有同一次连续矛盾/沟通/修复才 attach；主题相似但时间或起因不同要 create，禁止为了减少数量而硬合并。\n3. 未出现修复、和好、解决或事后复盘时，insights 必须为空；不要在争吵最激烈时下永久结论。\n4. 心得描述互动模式和沈望可改进的行为，不给江鱼贴人格标签，不推测她没说过的动机。\n5. 每条 observation/lesson 必须列出实际 support_memory_ids；反例放 counter_memory_ids。一次证据只能形成暂定心得。\n6. 原始记忆不可改写。严格输出一个 JSON 对象，不要输出解释或 Markdown。结构：${JSON.stringify(schema)}`,
        },
        {
            role: 'user',
            content: `【新记忆】\n${JSON.stringify({ id: memory.id, content: memory.content, tags: memory.tags || [], source_quote: memory.source_quote || '', occurred_at: memory.source_at || memory.created_at })}\n\n【已有关系片段】\n${JSON.stringify(episodes)}\n\n【已有心得】\n${JSON.stringify(insights)}`,
        },
    ];
}

async function curateRelationshipMemory(options) {
    const { fetchImpl, apiKey, endpoint, model, memory, store, timeoutMs = 30000 } = options || {};
    if (!fetchImpl || !apiKey) throw new Error('缺少关系整理模型配置');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${String(apiKey).replace(/^Bearer\s+/i, '')}` };
    const body = { model, messages: buildMessages(memory, normalizeStore(store)), response_format: { type: 'json_object' }, temperature: 0, max_tokens: 1400 };
    const request = value => fetchImpl(endpoint, { method: 'POST', headers, body: JSON.stringify(value), signal: controller.signal });
    try {
        let response = await request(body);
        if (!response.ok && (response.status === 400 || response.status === 422)) {
            delete body.response_format;
            response = await request(body);
        }
        if (!response.ok) throw new Error(`relationship curator API ${response.status}`);
        const data = await response.json();
        const message = data?.choices?.[0]?.message || {};
        for (const raw of [message.content, message.reasoning_content, data?.choices?.[0]?.text, data?.output_text]) {
            const parsed = typeof raw === 'string' ? findJson(raw) : null;
            if (parsed && typeof parsed.eligible === 'boolean') return normalizeDecision(parsed, memory, normalizeStore(store));
        }
        throw new Error('relationship curator returned no valid decision');
    } finally {
        clearTimeout(timer);
    }
}

module.exports = {
    applyDecision,
    buildMessages,
    confidenceForInsight,
    curateRelationshipMemory,
    emptyRelationshipStore,
    findJson,
    looksRelationshipRelevant,
    memorySignature,
    normalizeDecision,
    normalizeStore,
};
