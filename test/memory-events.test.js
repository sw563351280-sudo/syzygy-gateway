'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { activeMemoryEvents, readMemoryEvents, receiveMemoryEvent, updateMemoryEvent } = require('../memory-events');

test('same source message is one durable memory event', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syzygy-memory-events-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'events.jsonl');
    const payload = { content: '我记着她喜欢蓝色。', source_message_id: 'msg-1', tags: ['偏好'] };
    const first = receiveMemoryEvent(file, 'long_term', payload);
    const second = receiveMemoryEvent(file, 'long_term', { ...payload, content: '换一种排版也不应重复' });
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.event.id, first.event.id);
    assert.equal(readMemoryEvents(file).length, 1);
});

test('event snapshots recover state and tolerate an interrupted trailing append', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syzygy-memory-events-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'events.jsonl');
    const { event } = receiveMemoryEvent(file, 'long_term', { content: '一条记忆' });
    updateMemoryEvent(file, event, { status: 'pending', error: '模型离线' });
    fs.appendFileSync(file, '{"id":"broken"', 'utf8');
    const restored = readMemoryEvents(file);
    assert.equal(restored.length, 1);
    assert.equal(restored[0].status, 'pending');
    assert.equal(activeMemoryEvents(restored).length, 1);
});

test('crumb fallback key deduplicates one day but permits a later-day event', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syzygy-memory-events-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'events.jsonl');
    const crumb = { fact: '我记着她吃了火锅', source_quote: '今天吃了火锅' };
    assert.equal(receiveMemoryEvent(file, 'crumb', { ...crumb, source_at: '2026-09-16T10:00:00Z' }).created, true);
    assert.equal(receiveMemoryEvent(file, 'crumb', { ...crumb, source_at: '2026-09-16T20:00:00Z' }).created, false);
    assert.equal(receiveMemoryEvent(file, 'crumb', { ...crumb, source_at: '2026-09-17T10:00:00Z' }).created, true);
});
