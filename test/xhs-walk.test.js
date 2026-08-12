'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    canWalk, chooseUnseen, normalizeWalkState, parseDiscoveryCandidates, parseWalkDecision, scheduleNextWalk,
} = require('../xhs-walk');

test('parses public discovery cards into readable note links', () => {
    const state = { feed: { feeds: [{ id: 'note-1', modelType: 'note', xsecToken: 'abc=', noteCard: { displayTitle: '猫猫打哈欠', type: 'video', user: { nickname: '小猫家' }, interactInfo: { likedCount: '12' } } }] } };
    const html = `<script>window.__INITIAL_STATE__=${JSON.stringify(state)}</script>`;
    const [candidate] = parseDiscoveryCandidates(html);
    assert.equal(candidate.id, 'note-1');
    assert.equal(candidate.title, '猫猫打哈欠');
    assert.match(candidate.url, /xsec_token=abc%3D/);
});

test('walk stays in daytime and respects daily caps', () => {
    const daytime = new Date('2026-08-12T04:00:00.000Z'); // 12:00 Beijing
    const night = new Date('2026-08-12T16:00:00.000Z'); // 00:00 Beijing
    assert.equal(canWalk(normalizeWalkState({}, daytime), daytime), true);
    assert.equal(canWalk(normalizeWalkState({}, night), night), false);
    assert.equal(canWalk({ scans_today: 3, shares_today: 0, next_check_at: 0 }, daytime), false);
    assert.equal(canWalk({ scans_today: 0, shares_today: 1, next_check_at: 0 }, daytime), false);
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
