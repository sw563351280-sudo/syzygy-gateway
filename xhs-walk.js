'use strict';

const { parseInitialState } = require('./xhs-reader');

const DAY_MS = 24 * 60 * 60 * 1000;

function beijingDateKey(now = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now);
}

function beijingHour(now = new Date()) {
    return Number(new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Shanghai', hour: '2-digit', hourCycle: 'h23',
    }).format(now));
}

function parseDiscoveryCandidates(html) {
    const state = parseInitialState(html);
    const feeds = Array.isArray(state?.feed?.feeds) ? state.feed.feeds : [];
    const seen = new Set();
    return feeds.map(feed => {
        const card = feed?.noteCard || {};
        const id = String(feed?.id || feed?.trackId || '').trim();
        const token = String(feed?.xsecToken || '').trim();
        if (!id || feed?.modelType !== 'note' || seen.has(id)) return null;
        seen.add(id);
        const params = new URLSearchParams({ xsec_source: 'pc_feed' });
        if (token) params.set('xsec_token', token);
        return {
            id,
            url: `https://www.xiaohongshu.com/explore/${encodeURIComponent(id)}?${params}`,
            title: String(card.displayTitle || card.title || '').trim(),
            author: String(card.user?.nickname || card.user?.nickName || '').trim(),
            type: card.type === 'video' ? 'video' : 'image',
            liked_count: String(card.interactInfo?.likedCount || '').trim(),
        };
    }).filter(candidate => candidate && candidate.title);
}

function normalizeWalkState(raw, now = new Date()) {
    const date = beijingDateKey(now);
    const state = raw && typeof raw === 'object' ? { ...raw } : {};
    if (state.date !== date) {
        state.date = date;
        state.scans_today = 0;
        state.shares_today = 0;
    }
    state.seen_ids = Array.isArray(state.seen_ids) ? state.seen_ids.slice(-300) : [];
    state.scans_today = Number(state.scans_today || 0);
    state.shares_today = Number(state.shares_today || 0);
    state.next_check_at = Number(state.next_check_at || 0);
    return state;
}

function canWalk(state, now = new Date(), options = {}) {
    const cfg = { maxScansPerDay: 3, maxSharesPerDay: 1, ...options };
    if (beijingHour(now) < 8 || beijingHour(now) >= 23) return false;
    if (state.scans_today >= cfg.maxScansPerDay || state.shares_today >= cfg.maxSharesPerDay) return false;
    return !state.next_check_at || now.getTime() >= state.next_check_at;
}

function scheduleNextWalk(state, now = new Date(), random = Math.random) {
    // Four to seven hours keeps this a quiet stroll, not a polling crawler.
    state.next_check_at = now.getTime() + (4 + random() * 3) * 60 * 60 * 1000;
    return state;
}

function parseWalkDecision(raw) {
    const text = String(raw || '').replace(/```json|```/gi, '').trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return { share: false, message: '' };
    try {
        const value = JSON.parse(text.slice(start, end + 1));
        return {
            share: value.share === true,
            note_id: String(value.note_id || '').trim(),
            message: String(value.message || '').trim(),
        };
    } catch (_) {
        return { share: false, message: '' };
    }
}

function chooseUnseen(candidates, seenIds, limit = 5, random = Math.random) {
    const seen = new Set(seenIds || []);
    const pool = candidates.filter(candidate => !seen.has(candidate.id));
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, limit);
}

module.exports = {
    DAY_MS,
    beijingDateKey,
    beijingHour,
    canWalk,
    chooseUnseen,
    normalizeWalkState,
    parseDiscoveryCandidates,
    parseWalkDecision,
    scheduleNextWalk,
};
