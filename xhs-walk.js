'use strict';

const { parseInitialState } = require('./xhs-reader');

const DAY_MS = 24 * 60 * 60 * 1000;
const FEED_ITEM_TTL_MS = 48 * 60 * 60 * 1000;
const MAX_FEED_ITEMS = 100;

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
    return feeds.map((feed, rank) => {
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
            cover: String(card.cover?.urlDefault || card.cover?.urlPre || card.cover?.url || '').trim() || null,
            rank,
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
    state.next_collect_at = Number(state.next_collect_at || 0);
    return state;
}

function canWalk(state, now = new Date(), options = {}) {
    const cfg = { maxScansPerDay: 3, ...options };
    if (beijingHour(now) < 8 || beijingHour(now) >= 23) return false;
    if (state.scans_today >= cfg.maxScansPerDay) return false;
    return !state.next_check_at || now.getTime() >= state.next_check_at;
}

function scheduleNextWalk(state, now = new Date(), random = Math.random) {
    state.next_check_at = now.getTime() + (4 + random() * 3) * 60 * 60 * 1000;
    return state;
}

function scheduleNextCollection(state, now = new Date(), random = Math.random) {
    state.next_collect_at = now.getTime() + (2 + random() * 2) * 60 * 60 * 1000;
    return state;
}

function normalizeFeedInbox(raw, now = new Date()) {
    const inbox = raw && typeof raw === 'object' ? { ...raw } : {};
    const cutoff = now.getTime() - FEED_ITEM_TTL_MS;
    const seen = new Set();
    inbox.items = (Array.isArray(inbox.items) ? inbox.items : []).filter(item => {
        const id = String(item?.id || '').trim();
        const capturedAt = new Date(item?.captured_at || 0).getTime();
        if (!id || seen.has(id) || !Number.isFinite(capturedAt) || capturedAt < cutoff) return false;
        seen.add(id);
        return true;
    }).slice(-MAX_FEED_ITEMS);
    inbox.updated_at = inbox.updated_at || null;
    return inbox;
}

function mergeFeedCandidates(rawInbox, candidates = [], now = new Date()) {
    const inbox = normalizeFeedInbox(rawInbox, now);
    const byId = new Map(inbox.items.map(item => [item.id, item]));
    candidates.forEach((candidate, rank) => {
        const id = String(candidate?.id || '').trim();
        if (!id) return;
        const previous = byId.get(id) || {};
        byId.set(id, {
            ...previous,
            ...candidate,
            id,
            rank: Number.isFinite(candidate.rank) ? candidate.rank : rank,
            captured_at: now.toISOString(),
            status: previous.status || 'unseen',
        });
    });
    inbox.items = [...byId.values()]
        .sort((a, b) => new Date(a.captured_at) - new Date(b.captured_at))
        .slice(-MAX_FEED_ITEMS);
    inbox.updated_at = now.toISOString();
    return inbox;
}

function takeUnseenFeedCandidates(rawInbox, limit = 20, now = new Date()) {
    const inbox = normalizeFeedInbox(rawInbox, now);
    return inbox.items
        .filter(item => item.status === 'unseen')
        .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999) || new Date(b.captured_at) - new Date(a.captured_at))
        .slice(0, Math.max(0, Number(limit) || 0));
}

function parseWalkDecision(raw) {
    const text = String(raw || '').replace(/```json|```/gi, '').trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return { keep: [], share_ids: [] };
    try {
        const value = JSON.parse(text.slice(start, end + 1));
        const keep = Array.isArray(value.keep) ? value.keep.map(item => ({
            note_id: String(item?.note_id || '').trim(),
            tags: Array.isArray(item?.tags) ? item.tags.map(tag => String(tag || '').trim()).filter(Boolean).slice(0, 8) : [],
        })).filter(item => item.note_id).slice(0, 5) : [];
        return {
            keep,
            share_ids: Array.isArray(value.share_ids) ? value.share_ids.map(id => String(id || '').trim()).filter(Boolean).slice(0, 3) : [],
        };
    } catch (_) {
        return { keep: [], share_ids: [] };
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
    FEED_ITEM_TTL_MS,
    MAX_FEED_ITEMS,
    beijingDateKey,
    beijingHour,
    canWalk,
    chooseUnseen,
    normalizeWalkState,
    parseDiscoveryCandidates,
    parseWalkDecision,
    mergeFeedCandidates,
    normalizeFeedInbox,
    scheduleNextWalk,
    scheduleNextCollection,
    takeUnseenFeedCandidates,
};
