'use strict';

const crypto = require('node:crypto');
const { canonical, matchSource } = require('./memory-write-utils');
const { normalizeStore } = require('./relationship-reflections');

const TRANSITIONS = new Set([
    'friction_started',
    'conflict_started',
    'conflict_continues',
    'tentative_contact',
    'repair_started',
    'resolved',
    'paused_unresolved',
    'conflict_reopened',
    'temperature_changed',
]);

const TEMPERATURES = new Set(['warm', 'neutral', 'withdrawn', 'hostile']);
const TEMPERATURE_RANK = { hostile: 0, withdrawn: 1, neutral: 2, warm: 3 };

const STAGE_BY_TRANSITION = {
    friction_started: 'context',
    conflict_started: 'trigger',
    conflict_continues: 'escalation',
    tentative_contact: 'repair',
    repair_started: 'repair',
    resolved: 'resolution',
    paused_unresolved: 'rupture',
    conflict_reopened: 'escalation',
};

function parseJsonObject(raw) {
    const source = String(raw || '').replace(/```(?:json)?\s*/gi, '').replace(/```/g, '');
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

function compact(value, limit) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function matchesCurrentUserEvidence(evidence, userText) {
    const wanted = canonical(evidence);
    const source = canonical(userText);
    if (wanted.length === 1) return source === wanted;
    return Boolean(matchSource(evidence, [userText]));
}

function normalizeSignal(raw, userText) {
    if (!raw || !TRANSITIONS.has(raw.transition)) return null;
    const evidence = compact(raw.evidence_quote, 240);
    if (!evidence || !matchesCurrentUserEvidence(evidence, userText)) return null;
    const confidence = Math.max(0, Math.min(1, Number(raw.confidence) || 0));
    if (confidence < 0.65) return null;
    const userConfirmed = raw.user_confirmed === true;
    const requestedBasis = compact(raw.resolution_basis, 40);
    const resolutionBasis = raw.transition === 'resolved'
        ? (['explicit', 'implicit_reconnection'].includes(requestedBasis) ? requestedBasis : (userConfirmed ? 'explicit' : null))
        : null;
    const temperature = TEMPERATURES.has(raw.temperature) ? raw.temperature : null;
    if (raw.transition === 'temperature_changed' && !temperature) return null;
    return {
        transition: raw.transition,
        title: compact(raw.title || raw.episode_hint, 80) || '一次沟通与磨合',
        summary: compact(raw.summary, 420) || evidence,
        evidence_quote: evidence,
        themes: [...new Set((Array.isArray(raw.themes) ? raw.themes : []).map(item => compact(item, 40)).filter(Boolean))].slice(0, 8),
        confidence,
        user_confirmed: userConfirmed,
        resolution_basis: resolutionBasis,
        temperature,
        temperature_direction: ['up', 'down', 'steady'].includes(raw.temperature_direction) ? raw.temperature_direction : null,
        signal_strength: raw.signal_strength === 'strong' ? 'strong' : 'ordinary',
        support_turns: Math.max(1, Math.min(12, Math.round(Number(raw.support_turns) || 1))),
    };
}

function extractRelationshipStateTags(content, userText) {
    if (typeof content !== 'string') return { cleanContent: content, signals: [], raw: 0, invalid: 0 };
    const signals = [];
    let rawCount = 0; let invalid = 0;
    const cleanContent = content.replace(/<RELATIONSHIP_STATE\b[^>]*>([\s\S]*?)<\/RELATIONSHIP_STATE>/gi, (_, body) => {
        rawCount++;
        const signal = normalizeSignal(parseJsonObject(body), userText);
        if (signal) signals.push(signal); else invalid++;
        return '';
    }).replace(/<RELATIONSHIP_STATE\b[^>]*>[\s\S]*$/gi, () => {
        rawCount++; invalid++; return '';
    }).trim();
    return { cleanContent, signals: signals.slice(0, 1), raw: rawCount, invalid };
}

function makeEpisode(signal, sourceRef, timestamp) {
    const occurredAt = sourceRef?.at || sourceRef?.source_at || timestamp;
    return {
        id: `rel_${new Date(timestamp).getTime().toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
        title: signal.title,
        summary: signal.summary,
        status: 'open',
        themes: signal.themes,
        started_at: occurredAt,
        ended_at: null,
        created_at: timestamp,
        updated_at: timestamp,
        events: [],
    };
}

function applyRelationshipSignal(rawStore, signal, sourceRef = null, now = new Date()) {
    const store = JSON.parse(JSON.stringify(normalizeStore(rawStore)));
    const timestamp = now.toISOString();
    const sourceMessageId = sourceRef?.message_id || sourceRef?.source_message_id || null;
    const eventMemoryId = sourceMessageId ? `turn:${sourceMessageId}` : `turn:${canonical(signal.evidence_quote).slice(0, 80)}`;
    if ((store.episodes || []).some(episode => (episode.events || []).some(event => event.memory_id === eventMemoryId))
        || (store.temperature_events || []).some(event => event.memory_id === eventMemoryId)) {
        return { store, changed: false, accepted: false, reason: 'duplicate_source', episode: null };
    }

    const occurredAt = sourceRef?.at || sourceRef?.source_at || timestamp;
    const previousTemperature = store.temperature_state?.value || null;
    let temperatureChanged = false;
    if (signal.temperature && signal.temperature !== previousTemperature) {
        const direction = previousTemperature
            ? (TEMPERATURE_RANK[signal.temperature] > TEMPERATURE_RANK[previousTemperature] ? 'up' : 'down')
            : (signal.temperature_direction || 'steady');
        const upward = direction === 'up';
        const downward = direction === 'down';
        if (upward && (signal.support_turns < 2 || signal.confidence < 0.8)) {
            return { store, changed: false, accepted: false, reason: 'warming_needs_two_turns', episode: null };
        }
        if (downward && signal.signal_strength !== 'strong' && signal.support_turns < 2) {
            return { store, changed: false, accepted: false, reason: 'cooling_needs_strong_or_repeated_signal', episode: null };
        }
        store.temperature_state = {
            value: signal.temperature,
            confidence: signal.confidence,
            summary: signal.summary,
            source_quote: signal.evidence_quote,
            updated_at: timestamp,
        };
        store.temperature_events = Array.isArray(store.temperature_events) ? store.temperature_events : [];
        store.temperature_events.push({
            id: `rtemp_${crypto.randomBytes(5).toString('hex')}`,
            memory_id: eventMemoryId,
            from: previousTemperature,
            to: signal.temperature,
            direction,
            summary: signal.summary,
            source_quote: signal.evidence_quote,
            occurred_at: occurredAt,
            created_at: timestamp,
        });
        store.temperature_events = store.temperature_events.slice(-100);
        temperatureChanged = true;
    }

    if (signal.transition === 'temperature_changed') {
        if (!temperatureChanged) return { store, changed: false, accepted: false, reason: 'temperature_unchanged', episode: null };
        store.updated_at = timestamp;
        return { store, changed: true, accepted: true, reason: 'accepted', episode: null, temperatureChanged: true };
    }

    let active = store.active_state;
    let episode = active?.episode_id ? store.episodes.find(item => item.id === active.episode_id && item.status === 'open') : null;
    const begins = signal.transition === 'friction_started' || signal.transition === 'conflict_started';
    if (!episode) {
        if (!begins && signal.transition !== 'conflict_reopened') {
            return { store, changed: false, accepted: false, reason: 'no_open_episode', episode: null };
        }
        episode = makeEpisode(signal, sourceRef, timestamp);
        store.episodes.push(episode);
        active = { episode_id: episode.id, phase: 'conflict', opened_at: timestamp, updated_at: timestamp };
    }

    if (signal.transition === 'resolved') {
        const explicitlyResolved = signal.user_confirmed && signal.confidence >= 0.8;
        const priorRepair = active?.phase === 'repair'
            && (episode.events || []).some(event => event.transition === 'repair_started' || event.stage === 'repair');
        const implicitlyResolved = signal.resolution_basis === 'implicit_reconnection'
            && signal.confidence >= 0.85
            && priorRepair;
        if (!explicitlyResolved && !implicitlyResolved) {
            return { store, changed: false, accepted: false, reason: priorRepair ? 'implicit_resolution_not_confident' : 'resolution_without_repair', episode };
        }
    }

    const phaseByTransition = {
        friction_started: 'friction',
        conflict_started: 'conflict', conflict_continues: 'conflict', conflict_reopened: 'conflict',
        tentative_contact: 'contact', repair_started: 'repair', paused_unresolved: 'paused', resolved: 'resolved',
    };
    episode.events = Array.isArray(episode.events) ? episode.events : [];
    episode.events.push({
        id: `revt_${crypto.randomBytes(5).toString('hex')}`,
        memory_id: eventMemoryId,
        stage: STAGE_BY_TRANSITION[signal.transition],
        transition: signal.transition,
        resolution_basis: signal.resolution_basis,
        summary: signal.summary,
        occurred_at: occurredAt,
        source_quote: signal.evidence_quote,
        created_at: timestamp,
        updated_at: timestamp,
    });
    episode.summary = signal.summary || episode.summary;
    episode.title = episode.title || signal.title;
    episode.themes = [...new Set([...(episode.themes || []), ...(signal.themes || [])])].slice(0, 10);
    episode.updated_at = timestamp;

    if (signal.transition === 'resolved') {
        episode.status = 'resolved';
        episode.ended_at = occurredAt;
        store.active_state = null;
    } else {
        store.active_state = { ...active, episode_id: episode.id, phase: phaseByTransition[signal.transition], updated_at: timestamp };
    }
    store.updated_at = timestamp;
    return { store, changed: true, accepted: true, reason: 'accepted', episode, temperatureChanged };
}

function activeRelationshipContext(store) {
    const normalized = normalizeStore(store);
    const parts = [];
    if (normalized.temperature_state?.value) {
        const label = { warm: '亲密', neutral: '正常', withdrawn: '疏离回避', hostile: '讽刺敌意' }[normalized.temperature_state.value];
        parts.push(`【当前关系温度】${label}。最近依据：${normalized.temperature_state.summary || '未记录'}。温度与事件是否结束是两条独立轴；已解决但仍疏离是合法状态。`);
    }
    const active = normalized.active_state;
    if (!active?.episode_id) return parts.join('\n');
    const episode = normalized.episodes.find(item => item.id === active.episode_id && item.status === 'open');
    if (!episode) return parts.join('\n');
    const phaseName = { friction: '已经出现摩擦', conflict: '仍在冲突中', paused: '暂时停下但尚未解决', contact: '正在试探接触', repair: '正在尝试修复' }[active.phase] || '仍在发展';
    const latest = (episode.events || []).at(-1);
    parts.push(`【当前关系过程】${phaseName}：${episode.title}。最近进展：${latest?.summary || episode.summary || '尚未整理'}。这是一段尚未结束的过程；结合完整对话判断本轮是否发生状态转折。冷战后第一次重新靠近只算试探接触；后续新的恢复行为才能进入修复，再出现持续恢复才可判断隐性和好。不要因为自己道歉或对方停止回复就擅自结案。`);
    return parts.join('\n');
}

module.exports = {
    TRANSITIONS,
    TEMPERATURES,
    activeRelationshipContext,
    applyRelationshipSignal,
    extractRelationshipStateTags,
    matchesCurrentUserEvidence,
    normalizeSignal,
    parseJsonObject,
};
