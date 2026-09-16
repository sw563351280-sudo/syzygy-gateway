'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { emptyRelationshipStore } = require('../relationship-reflections');
const { activeRelationshipContext, applyRelationshipSignal, extractRelationshipStateTags } = require('../relationship-state');

function tag(payload, visible = '正文') {
    return `${visible}<RELATIONSHIP_STATE>${JSON.stringify(payload)}</RELATIONSHIP_STATE>`;
}

function signal(transition, evidence, extra = {}) {
    return { transition, evidence_quote: evidence, title: '回应方式造成的误解', summary: evidence, confidence: 0.9, themes: ['沟通'], ...extra };
}

test('dialogue-model state tags are hidden and must quote the current user', () => {
    const valid = extractRelationshipStateTags(tag(signal('conflict_started', '你根本没听懂我')), '你根本没听懂我');
    assert.equal(valid.cleanContent, '正文');
    assert.equal(valid.signals.length, 1);
    const invented = extractRelationshipStateTags(tag(signal('conflict_started', '你讨厌我')), '我只是有点难过');
    assert.equal(invented.cleanContent, '正文');
    assert.equal(invented.signals.length, 0);
    assert.equal(invented.invalid, 1);
});

test('a conflict opens one episode and keeps its active context', () => {
    const start = applyRelationshipSignal(emptyRelationshipStore(), signal('conflict_started', '你为什么又不回我'), { message_id: 'u1', at: '2026-09-17T10:00:00Z' }, new Date('2026-09-17T10:00:01Z'));
    assert.equal(start.accepted, true);
    assert.equal(start.store.episodes.length, 1);
    assert.equal(start.store.active_state.phase, 'conflict');
    assert.match(activeRelationshipContext(start.store), /仍在冲突中/);
    const duplicate = applyRelationshipSignal(start.store, signal('conflict_continues', '你为什么又不回我'), { message_id: 'u1' });
    assert.equal(duplicate.changed, false);
});

test('stopping without repair stays open', () => {
    const start = applyRelationshipSignal(emptyRelationshipStore(), signal('conflict_started', '我现在很生气'), { message_id: 'u1' });
    const paused = applyRelationshipSignal(start.store, signal('paused_unresolved', '算了，不说了'), { message_id: 'u2' });
    assert.equal(paused.store.episodes[0].status, 'open');
    assert.equal(paused.store.active_state.phase, 'paused');
    assert.match(activeRelationshipContext(paused.store), /尚未解决/);
});

test('the assistant cannot declare resolution without explicit user confirmation', () => {
    const start = applyRelationshipSignal(emptyRelationshipStore(), signal('conflict_started', '你没有理解我'), { message_id: 'u1' });
    const premature = applyRelationshipSignal(start.store, signal('resolved', '你没有理解我', { user_confirmed: false }), { message_id: 'u2' });
    assert.equal(premature.accepted, false);
    assert.equal(premature.reason, 'resolution_without_repair');
    assert.equal(premature.store.episodes[0].status, 'open');
});

test('one softened reply starts repair but cannot by itself imply reconciliation', () => {
    let result = applyRelationshipSignal(emptyRelationshipStore(), signal('conflict_started', '我不想跟你说话了'), { message_id: 'u1' });
    result = applyRelationshipSignal(result.store, signal('repair_started', '今天妹妹又来蹭我了'), { message_id: 'u2' });
    assert.equal(result.store.active_state.phase, 'repair');
    assert.equal(result.store.episodes[0].status, 'open');
});

test('a later relational reconnection can implicitly resolve after repair began', () => {
    let result = applyRelationshipSignal(emptyRelationshipStore(), signal('conflict_started', '我不想跟你说话了'), { message_id: 'u1' });
    result = applyRelationshipSignal(result.store, signal('repair_started', '今天妹妹又来蹭我了'), { message_id: 'u2' });
    result = applyRelationshipSignal(result.store, signal('resolved', '晚上陪我一起看电影吧', {
        user_confirmed: false,
        resolution_basis: 'implicit_reconnection',
        confidence: 0.9,
    }), { message_id: 'u3' });
    assert.equal(result.accepted, true);
    assert.equal(result.store.episodes[0].status, 'resolved');
    assert.equal(result.store.episodes[0].events.at(-1).resolution_basis, 'implicit_reconnection');
    assert.equal(result.store.active_state, null);
});

test('implicit reconciliation cannot skip the repair stage', () => {
    const start = applyRelationshipSignal(emptyRelationshipStore(), signal('conflict_started', '你刚才让我很难受'), { message_id: 'u1' });
    const premature = applyRelationshipSignal(start.store, signal('resolved', '那先这样吧', {
        resolution_basis: 'implicit_reconnection',
        confidence: 0.95,
    }), { message_id: 'u2' });
    assert.equal(premature.accepted, false);
    assert.equal(premature.reason, 'resolution_without_repair');
});

test('explicit user acceptance resolves the same episode', () => {
    let result = applyRelationshipSignal(emptyRelationshipStore(), signal('conflict_started', '你刚才那样让我很难受'), { message_id: 'u1', at: '2026-09-17T10:00:00Z' });
    result = applyRelationshipSignal(result.store, signal('repair_started', '那你先听我说完'), { message_id: 'u2', at: '2026-09-17T10:05:00Z' });
    result = applyRelationshipSignal(result.store, signal('resolved', '嗯，说开了就好', { user_confirmed: true }), { message_id: 'u3', at: '2026-09-17T10:10:00Z' });
    assert.equal(result.accepted, true);
    assert.equal(result.store.episodes[0].status, 'resolved');
    assert.equal(result.store.episodes[0].events.length, 3);
    assert.equal(result.store.active_state, null);
});
