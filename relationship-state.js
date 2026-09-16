'use strict';

const crypto = require('node:crypto');
const { canonical, matchSource } = require('./memory-write-utils');
const { normalizeStore } = require('./relationship-reflections');

const TRANSITIONS = new Set([
    'conflict_started',
    'conflict_continues',
    'repair_started',
    'resolved',
    'paused_unresolved',
    'conflict_reopened',
]);

const STAGE_BY_TRANSITION = {
    conflict_started: 'trigger',
    conflict_continues: 'escalation',
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

function normalizeSignal(raw, userText) {
    if (!raw || !TRANSITIONS.has(raw.transition)) return null;
    const evidence = compact(raw.evidence_quote, 240);
    if (!evidence || !matchSource(evidence, [userText])) return null;
    const confidence = Math.max(0, Math.min(1, Number(raw.confidence) || 0));
    if (confidence < 0.65) return null;
    const userConfirmed = raw.user_confirmed === true;
    const requestedBasis = compact(raw.resolution_basis, 40);
    const resolutionBasis = raw.transition === 'resolved'
        ? (['explicit', 'implicit_reconnection'].includes(requestedBasis) ? requestedBasis : (userConfirmed ? 'explicit' : null))
        : null;
    return {
        transition: raw.transition,
        title: compact(raw.title || raw.episode_hint, 80) || '一次沟通与磨合',
        summary: compact(raw.summary, 420) || evidence,
        evidence_quote: evidence,
        themes: [...new Set((Array.isArray(raw.themes) ? raw.themes : []).map(item => compact(item, 40)).filter(Boolean))].slice(0, 8),
        confidence,
        user_confirmed: userConfirmed,
        resolution_basis: resolutionBasis,
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
    if ((store.episodes || []).some(episode => (episode.events || []).some(event => event.memory_id === eventMemoryId))) {
        return { store, changed: false, accepted: false, reason: 'duplicate_source', episode: null };
    }

    let active = store.active_state;
    let episode = active?.episode_id ? store.episodes.find(item => item.id === active.episode_id && item.status === 'open') : null;
    const begins = signal.transition === 'conflict_started';
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
        conflict_started: 'conflict', conflict_continues: 'conflict', conflict_reopened: 'conflict',
        repair_started: 'repair', paused_unresolved: 'paused', resolved: 'resolved',
    };
    const occurredAt = sourceRef?.at || sourceRef?.source_at || timestamp;
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
    return { store, changed: true, accepted: true, reason: 'accepted', episode };
}

function activeRelationshipContext(store) {
    const normalized = normalizeStore(store);
    const active = normalized.active_state;
    if (!active?.episode_id) return '';
    const episode = normalized.episodes.find(item => item.id === active.episode_id && item.status === 'open');
    if (!episode) return '';
    const phaseName = { conflict: '仍在冲突中', repair: '正在尝试修复', paused: '暂时停下但尚未解决' }[active.phase] || '仍在发展';
    const latest = (episode.events || []).at(-1);
    return `【当前关系过程】${phaseName}：${episode.title}。最近进展：${latest?.summary || episode.summary || '尚未整理'}。这是一段尚未结束的过程；结合完整对话判断本轮是否发生状态转折。冷战后第一次重新靠近只算开始修复；之后又出现一轮有意义的主动分享、玩笑、亲近、依赖或共同计划，且冲突没有重燃，才可判断为隐性和好。不要因为自己道歉、对方停止回复、单独一个“嗯”或只恢复事务交流就擅自结案。`;
}

module.exports = {
    TRANSITIONS,
    activeRelationshipContext,
    applyRelationshipSignal,
    extractRelationshipStateTags,
    normalizeSignal,
    parseJsonObject,
};
