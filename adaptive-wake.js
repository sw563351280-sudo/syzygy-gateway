'use strict';

const { extractNextWakeTag } = require('./public/assistant-artifacts');

const MINUTE_MS = 60 * 1000;
const LIMITS = Object.freeze({
    minIntervalMinutes: 15,
    criticalMinIntervalMinutes: 3,
    maxIntervalMinutes: 12 * 60,
    maxUnanswered: 5,
    criticalMaxUnanswered: 8,
    cooldownAfterMaxMinutes: 3 * 60,
    jitterRatio: 0.10,
});

const URGENCIES = new Set(['low', 'medium', 'high', 'critical']);

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function beijingHour(now = new Date()) {
    return Number(new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Shanghai', hour: '2-digit', hourCycle: 'h23'
    }).format(now));
}

function normalizeUrgency(value) {
    const urgency = String(value || '').trim().toLowerCase();
    return URGENCIES.has(urgency) ? urgency : 'low';
}

function parseAfterMinutes(value) {
    if (Number.isFinite(Number(value))) return Number(value);
    const match = String(value || '').trim().match(/^(\d+(?:\.\d+)?)\s*([mh])$/i);
    if (!match) return null;
    const amount = Number(match[1]);
    return match[2].toLowerCase() === 'h' ? amount * 60 : amount;
}

function criticalIntervalMinutes(unansweredCount) {
    const count = Math.max(0, Number(unansweredCount) || 0);
    if (count <= 0) return 3;
    if (count === 1) return 10;
    if (count === 2) return 30;
    if (count === 3) return 60;
    return 120;
}

function fallbackAfterMinutes({ now = new Date(), lastMoodSeverity = 'low' } = {}) {
    const hour = beijingHour(now);
    if (hour >= 1 && hour <= 8) return 4 * 60;
    if (lastMoodSeverity === 'high' || lastMoodSeverity === 'critical') return 15;
    return 60;
}

function normalizePlan(rawPlan, options = {}) {
    const urgency = normalizeUrgency(rawPlan?.urgency || options.lastMoodSeverity);
    const unansweredCount = Math.max(0, Number(options.unansweredCount) || 0);
    const fallback = fallbackAfterMinutes({ now: options.now, lastMoodSeverity: options.lastMoodSeverity || urgency });
    let minutes = parseAfterMinutes(rawPlan?.after_minutes ?? rawPlan?.after);
    if (!Number.isFinite(minutes) || minutes <= 0) minutes = fallback;
    if (urgency === 'critical') minutes = criticalIntervalMinutes(unansweredCount);
    const minimum = urgency === 'critical' ? LIMITS.criticalMinIntervalMinutes : LIMITS.minIntervalMinutes;
    minutes = clamp(minutes, minimum, LIMITS.maxIntervalMinutes);
    const random = typeof options.random === 'function' ? options.random : Math.random;
    const jitter = 1 + (clamp(Number(random()), 0, 1) * 2 - 1) * LIMITS.jitterRatio;
    minutes = clamp(Math.round(minutes * jitter), minimum, LIMITS.maxIntervalMinutes);
    return {
        after_minutes: minutes,
        urgency,
        reason: String(rawPlan?.reason || options.fallbackReason || '模型未提供调度理由').replace(/\s+/g, ' ').trim().slice(0, 240),
    };
}

function freshState(now = new Date()) {
    return {
        wake_generation: 1,
        status: 'idle',
        due_at: null,
        after_minutes: null,
        urgency: 'low',
        reason: '',
        unanswered_count: 0,
        cooldown_probe_used: false,
        source_user_message_id: null,
        last_user_msg_time: null,
        last_my_msg_time: null,
        last_mood_severity: 'low',
        last_topic: '',
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
    };
}

function normalizeState(raw, now = new Date()) {
    const state = { ...freshState(now), ...(raw && typeof raw === 'object' ? raw : {}) };
    state.wake_generation = Math.max(1, Number(state.wake_generation) || 1);
    state.status = ['idle', 'scheduled', 'running', 'cooldown_probe', 'stopped'].includes(state.status) ? state.status : 'idle';
    state.due_at = state.due_at && Number.isFinite(new Date(state.due_at).getTime()) ? new Date(state.due_at).toISOString() : null;
    state.after_minutes = Number.isFinite(Number(state.after_minutes)) ? Number(state.after_minutes) : null;
    state.urgency = normalizeUrgency(state.urgency);
    state.unanswered_count = Math.max(0, Number(state.unanswered_count) || 0);
    state.cooldown_probe_used = Boolean(state.cooldown_probe_used);
    return state;
}

function invalidateForUserMessage(raw, input = {}) {
    const now = input.now || new Date();
    const state = normalizeState(raw, now);
    return {
        ...state,
        wake_generation: state.wake_generation + 1,
        status: 'idle',
        due_at: null,
        after_minutes: null,
        urgency: 'low',
        reason: '用户发来新消息，旧计划作废',
        unanswered_count: 0,
        cooldown_probe_used: false,
        source_user_message_id: input.sourceUserMessageId || null,
        last_user_msg_time: now.toISOString(),
        last_mood_severity: normalizeUrgency(input.lastMoodSeverity),
        last_topic: String(input.lastTopic || '').replace(/\s+/g, ' ').trim().slice(0, 180),
        updated_at: now.toISOString(),
    };
}

function schedulePlan(raw, rawPlan, input = {}) {
    const now = input.now || new Date();
    const state = normalizeState(raw, now);
    const plan = normalizePlan(rawPlan, {
        now,
        lastMoodSeverity: input.lastMoodSeverity || state.last_mood_severity,
        unansweredCount: state.unanswered_count,
        fallbackReason: input.fallbackReason,
        random: input.random,
    });
    const maxUnanswered = plan.urgency === 'critical' ? LIMITS.criticalMaxUnanswered : LIMITS.maxUnanswered;
    if (state.unanswered_count >= maxUnanswered) {
        if (plan.urgency !== 'critical' && !state.cooldown_probe_used) {
            const afterMinutes = LIMITS.cooldownAfterMaxMinutes;
            return {
                ...state,
                wake_generation: state.wake_generation + 1,
                status: 'cooldown_probe',
                due_at: new Date(now.getTime() + afterMinutes * MINUTE_MS).toISOString(),
                after_minutes: afterMinutes,
                urgency: plan.urgency,
                reason: '连续未回复达到上限，冷却后最后确认一次',
                cooldown_probe_used: true,
                updated_at: now.toISOString(),
            };
        }
        return {
            ...state,
            wake_generation: state.wake_generation + 1,
            status: 'stopped',
            due_at: null,
            after_minutes: null,
            reason: '连续未回复达到上限，停止自适应唤醒',
            updated_at: now.toISOString(),
        };
    }
    return {
        ...state,
        wake_generation: state.wake_generation + 1,
        status: 'scheduled',
        due_at: new Date(now.getTime() + plan.after_minutes * MINUTE_MS).toISOString(),
        after_minutes: plan.after_minutes,
        urgency: plan.urgency,
        reason: plan.reason,
        source_user_message_id: input.sourceUserMessageId || state.source_user_message_id,
        last_mood_severity: normalizeUrgency(input.lastMoodSeverity || plan.urgency),
        last_topic: String(input.lastTopic || state.last_topic || '').replace(/\s+/g, ' ').trim().slice(0, 180),
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
    };
}

function markDelivered(raw, now = new Date()) {
    const state = normalizeState(raw, now);
    return {
        ...state,
        unanswered_count: state.unanswered_count + 1,
        last_my_msg_time: now.toISOString(),
        updated_at: now.toISOString(),
    };
}

function calculateSleepProbability(lastActiveTime, now = new Date()) {
    const lastMs = new Date(lastActiveTime || 0).getTime();
    const hoursSinceActive = Number.isFinite(lastMs) ? Math.max(0, (now.getTime() - lastMs) / 3600000) : 24;
    const hour = beijingHour(now);
    if (hour >= 1 && hour <= 9 && hoursSinceActive > 0.5) return Math.min(0.95, 0.5 + hoursSinceActive * 0.15);
    if (hoursSinceActive > 2) return 0.3;
    return 0.1;
}

module.exports = {
    LIMITS,
    beijingHour,
    calculateSleepProbability,
    extractNextWakeTag,
    fallbackAfterMinutes,
    freshState,
    invalidateForUserMessage,
    markDelivered,
    normalizePlan,
    normalizeState,
    schedulePlan,
};
