'use strict';

const crypto = require('node:crypto');
const { bigramSimilarity } = require('./memory-merge');
const { memorySignature } = require('./relationship-reflections');

const STAGES = new Set(['beginning', 'context', 'progress', 'setback', 'decision', 'milestone', 'completion']);
const STATUSES = new Set(['active', 'paused', 'completed']);

function compact(value, limit = 500) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function unique(values, limit = 20) {
    return [...new Set((values || []).map(value => compact(value, 80)).filter(Boolean))].slice(0, limit);
}

function emptyRealityStore() {
    return { version: 1, events: [], processed: {}, updated_at: null };
}

function normalizeStore(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
        version: 1,
        events: Array.isArray(source.events) ? source.events : [],
        processed: source.processed && typeof source.processed === 'object' ? source.processed : {},
        updated_at: source.updated_at || null,
    };
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

function eventCandidates(store, memory) {
    const query = [memory?.content, ...(memory?.tags || [])].filter(Boolean).join(' ');
    return (store.events || []).map(event => {
        const haystack = [event.title, event.summary, event.kind, ...(event.subjects || [])].filter(Boolean).join(' ');
        const recency = event.status === 'active' ? 0.08 : event.status === 'paused' ? 0.03 : 0;
        return { event, score: bigramSimilarity(query, haystack) + recency };
    }).sort((a, b) => b.score - a.score)
        .filter((item, index) => item.score >= 0.04 || (item.event.status !== 'completed' && index < 6))
        .slice(0, 12).map(item => item.event);
}

function normalizeDecision(payload, memory, candidates) {
    if (payload?.eligible !== true) return { eligible: false, reason: compact(payload?.reason, 180) || '不是可发展的现实事件' };
    const candidateIds = new Set((candidates || []).map(item => item.id));
    let action = ['create', 'attach', 'none'].includes(payload.event_action) ? payload.event_action : 'create';
    let eventId = candidateIds.has(payload.event_id) ? payload.event_id : null;
    if (action === 'attach' && !eventId) action = 'create';
    if (action !== 'attach') eventId = null;
    return {
        eligible: true,
        reason: compact(payload.reason, 180),
        event_action: action,
        event_id: eventId,
        event: {
            title: compact(payload.event?.title, 90) || '一段现实经历',
            kind: compact(payload.event?.kind, 40) || 'life',
            summary: compact(payload.event?.summary, 600) || compact(memory?.content, 600),
            status: STATUSES.has(payload.event?.status) ? payload.event.status : 'active',
            subjects: unique(payload.event?.subjects, 10),
        },
        milestone: {
            stage: STAGES.has(payload.milestone?.stage) ? payload.milestone.stage : 'context',
            summary: compact(payload.milestone?.summary, 500) || compact(memory?.content, 500),
            occurred_at: payload.milestone?.occurred_at || memory?.source_at || memory?.created_at || new Date().toISOString(),
        },
    };
}

function applyDecision(rawStore, memory, decision, now = new Date()) {
    const store = JSON.parse(JSON.stringify(normalizeStore(rawStore)));
    const timestamp = now.toISOString();
    const signature = memorySignature(memory);
    if (store.processed[memory.id]?.signature === signature) return { store, changed: false, event: null };
    if (!decision?.eligible || decision.event_action === 'none') {
        store.processed[memory.id] = { signature, eligible: false, reason: compact(decision?.reason, 180), processed_at: timestamp };
        store.updated_at = timestamp;
        return { store, changed: true, event: null };
    }

    let event = decision.event_action === 'attach' ? store.events.find(item => item.id === decision.event_id) : null;
    if (!event) {
        event = {
            id: `life_${now.getTime().toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
            title: decision.event.title,
            kind: decision.event.kind,
            summary: decision.event.summary,
            status: decision.event.status,
            subjects: decision.event.subjects,
            started_at: decision.milestone.occurred_at,
            ended_at: decision.event.status === 'completed' ? decision.milestone.occurred_at : null,
            created_at: timestamp,
            updated_at: timestamp,
            milestones: [],
        };
        store.events.push(event);
    }

    const existing = (event.milestones || []).find(item => item.memory_id === memory.id);
    const milestone = {
        id: existing?.id || `lifept_${compact(memory.id, 60)}`,
        memory_id: memory.id,
        stage: decision.milestone.stage,
        summary: decision.milestone.summary,
        occurred_at: decision.milestone.occurred_at,
        source_quote: compact(memory.source_quote, 500),
        created_at: existing?.created_at || timestamp,
        updated_at: timestamp,
    };
    event.milestones = (event.milestones || []).filter(item => item.memory_id !== memory.id);
    event.milestones.push(milestone);
    event.milestones.sort((a, b) => new Date(a.occurred_at || 0) - new Date(b.occurred_at || 0));
    event.title = decision.event.title || event.title;
    event.kind = decision.event.kind || event.kind;
    event.summary = decision.event.summary || event.summary;
    event.subjects = unique([...(event.subjects || []), ...(decision.event.subjects || [])], 12);
    event.status = decision.event.status;
    event.started_at = event.milestones[0]?.occurred_at || event.started_at;
    event.ended_at = event.status === 'completed' ? (decision.milestone.occurred_at || timestamp) : null;
    event.updated_at = timestamp;
    store.processed[memory.id] = { signature, eligible: true, event_id: event.id, processed_at: timestamp };
    store.updated_at = timestamp;
    return { store, changed: true, event };
}

function buildMessages(memory, store) {
    const candidates = eventCandidates(store, memory);
    const compactCandidates = candidates.map(event => ({
        id: event.id, title: event.title, kind: event.kind, status: event.status,
        subjects: event.subjects, summary: event.summary,
        started_at: event.started_at, ended_at: event.ended_at,
        milestones: (event.milestones || []).slice(-8).map(item => ({ memory_id: item.memory_id, stage: item.stage, occurred_at: item.occurred_at, summary: item.summary })),
    }));
    const schema = {
        eligible: true,
        reason: '为什么是或不是现实事件的一部分',
        event_action: 'create|attach|none',
        event_id: 'attach 时只能使用候选 id，否则为 null',
        event: { title: '中性事件标题', kind: 'pet|learning|work|health|family|project|travel|life', summary: '截至当前的事件摘要', status: 'active|paused|completed', subjects: ['关键对象'] },
        milestone: { stage: 'beginning|context|progress|setback|decision|milestone|completion', summary: '这条记忆带来的新进展', occurred_at: 'ISO 时间' },
    };
    return {
        candidates,
        messages: [
            { role: 'system', content: `你是“现实事件脉络整理器”。把长期记忆组织成有时间顺序、会发展的现实事件，不负责关系争吵复盘。\n\n规则：\n1. 可归类：持续存在的人或动物、学习成长、工作经历、健康过程、家庭事项、旅行、长期项目等具有开始/进展/转折/结束的现实经历。\n2. 不可归类：单独情绪、人格评价、偏好、抽象认知、一次性闲聊、纯粹的沈望与江鱼争吵修复、RP、没有后续价值的技术元讨论。\n3. 同一对象也可能有多段事件。第一份工作结束后，第二份工作必须 create；不同起因、不同时间段不能因关键词相似而硬 attach。\n4. “妹妹这只猫”可作为长期 active 事件；“练车”从开始到学会属于一段事件。\n5. attach 时 event_id 只能来自候选。原始记忆不可修改。严格输出一个 JSON 对象，不要解释或 Markdown。结构：${JSON.stringify(schema)}` },
            { role: 'user', content: `【新记忆】\n${JSON.stringify({ id: memory.id, content: memory.content, tags: memory.tags || [], source_quote: memory.source_quote || '', occurred_at: memory.source_at || memory.created_at })}\n\n【候选现实事件】\n${JSON.stringify(compactCandidates)}` },
        ],
    };
}

async function curateRealityMemory(options) {
    const { fetchImpl, apiKey, endpoint, model, memory, store, timeoutMs = 30000 } = options || {};
    if (!fetchImpl || !apiKey) throw new Error('缺少现实事件整理模型配置');
    const normalizedStore = normalizeStore(store);
    const built = buildMessages(memory, normalizedStore);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${String(apiKey).replace(/^Bearer\s+/i, '')}` };
    const body = { model, messages: built.messages, response_format: { type: 'json_object' }, temperature: 0, max_tokens: 1100 };
    const request = value => fetchImpl(endpoint, { method: 'POST', headers, body: JSON.stringify(value), signal: controller.signal });
    try {
        let response = await request(body);
        if (!response.ok && (response.status === 400 || response.status === 422)) {
            delete body.response_format;
            response = await request(body);
        }
        if (!response.ok) throw new Error(`reality event curator API ${response.status}`);
        const data = await response.json();
        const message = data?.choices?.[0]?.message || {};
        for (const raw of [message.content, message.reasoning_content, data?.choices?.[0]?.text, data?.output_text]) {
            const parsed = typeof raw === 'string' ? findJson(raw) : null;
            if (parsed && typeof parsed.eligible === 'boolean') return normalizeDecision(parsed, memory, built.candidates);
        }
        throw new Error('reality event curator returned no valid decision');
    } finally {
        clearTimeout(timer);
    }
}

module.exports = { applyDecision, buildMessages, curateRealityMemory, emptyRealityStore, eventCandidates, findJson, normalizeDecision, normalizeStore };
