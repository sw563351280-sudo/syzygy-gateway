'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    canWalk, chooseUnseen, mergeFeedCandidates, normalizeFeedInbox, normalizeWalkState,
    parseDiscoveryCandidates, parseWalkDecision, scheduleNextCollection, scheduleNextWalk, takeUnseenFeedCandidates,
} = require('../xhs-walk');

test('parses public discovery cards into readable note links', () => {
    const state = { feed: { feeds: [{ id: 'note-1', modelType: 'note', xsecToken: 'abc=', noteCard: { displayTitle: '猫猫打哈欠', type: 'video', user: { nickname: '小猫家' }, interactInfo: { likedCount: '12' } } }] } };
    const html = `<script>window.__INITIAL_STATE__=${JSON.stringify(state)}</script>`;
    const [candidate] = parseDiscoveryCandidates(html);
    assert.equal(candidate.id, 'note-1');
    assert.equal(candidate.title, '猫猫打哈欠');
    assert.match(candidate.url, /xsec_token=abc%3D/);
});

test('walk stays in daytime, caps scans, and does not cap shares', () => {
    const daytime = new Date('2026-08-12T04:00:00.000Z'); // 12:00 Beijing
    const night = new Date('2026-08-12T16:00:00.000Z'); // 00:00 Beijing
    assert.equal(canWalk(normalizeWalkState({}, daytime), daytime), true);
    assert.equal(canWalk(normalizeWalkState({}, night), night), false);
    assert.equal(canWalk({ scans_today: 3, shares_today: 0, next_check_at: 0 }, daytime), false);
    assert.equal(canWalk({ scans_today: 0, shares_today: 99, next_check_at: 0 }, daytime), true);
    assert.equal(normalizeWalkState({ next_collect_at: '123' }, daytime).next_collect_at, 123);
});

test('feed inbox deduplicates, expires and keeps unseen recommendations ordered by rank', () => {
    const now = new Date('2026-08-12T04:00:00.000Z');
    const old = new Date(now.getTime() - 49 * 60 * 60 * 1000).toISOString();
    const inbox = mergeFeedCandidates({ items: [
        { id: 'expired', captured_at: old, status: 'unseen' },
        { id: 'kept', captured_at: now.toISOString(), status: 'kept', rank: 0 },
    ] }, [
        { id: 'b', title: '第二', rank: 1 },
        { id: 'a', title: '第一', rank: 0 },
        { id: 'a', title: '第一更新', rank: 0 },
    ], now);
    assert.equal(normalizeFeedInbox(inbox, now).items.some(item => item.id === 'expired'), false);
    assert.deepEqual(takeUnseenFeedCandidates(inbox, 10, now).map(item => item.id), ['a', 'b']);
    const state = scheduleNextCollection({}, now, () => 0.5);
    assert.equal(state.next_collect_at, now.getTime() + 3 * 60 * 60 * 1000);
});

test('walk schedules a quiet four-to-seven-hour interval', () => {
    const now = new Date('2026-08-12T04:00:00.000Z');
    const state = scheduleNextWalk({}, now, () => 0.5);
    assert.equal(state.next_check_at, now.getTime() + 5.5 * 60 * 60 * 1000);
});

test('unseen selection and strict JSON decision are safe', () => {
    const candidates = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    assert.deepEqual(chooseUnseen(candidates, ['a'], 2, () => 0).map(x => x.id).sort(), ['b', 'c']);
    assert.deepEqual(parseWalkDecision('```json\n{"keep":[{"note_id":"b","tags":["猫"]}],"share_ids":["b"]}\n```'), { keep: [{ note_id: 'b', tags: ['猫'] }], share_ids: ['b'] });
    assert.deepEqual(parseWalkDecision('not json'), { keep: [], share_ids: [] });
});
