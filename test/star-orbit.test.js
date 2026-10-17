'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const { createStarOrbit, daySummary, taskOnDate, taskProgress } = require('../star-orbit');

function dailyTask(overrides = {}) {
    return { id: 'daily', name: '吃早饭', icon: '🍳', mode: 'check', schedule: { kind: 'daily', startDate: '2026-10-01' }, ...overrides };
}

test('task schedules include the intended dates and preserve history after ending', () => {
    assert.equal(taskOnDate(dailyTask(), '2026-10-17'), true);
    assert.equal(taskOnDate(dailyTask({ endedAt: '2026-10-17T13:00:00.000Z' }), '2026-10-17'), true);
    assert.equal(taskOnDate(dailyTask({ endedAt: '2026-10-17T13:00:00.000Z' }), '2026-10-18'), false);
    assert.equal(taskOnDate(dailyTask({ schedule: { kind: 'range', startDate: '2026-10-10', endDate: '2026-10-14' } }), '2026-10-15'), false);
    assert.equal(taskOnDate(dailyTask({ schedule: { kind: 'custom', customType: 'interval', startDate: '2026-10-10', every: 3 } }), '2026-10-16'), true);
    assert.equal(taskOnDate(dailyTask({ schedule: { kind: 'custom', customType: 'weekdays', startDate: '2026-10-01', weekdays: [6] } }), '2026-10-17'), true);
});

test('progress and day heat state distinguish empty, partial, complete and all skipped', () => {
    const check = dailyTask(), count = dailyTask({ id: 'water', mode: 'count', target: 8 }), split = dailyTask({ id: 'medicine', mode: 'split', doses: [{ id: 'am', name: '早' }, { id: 'pm', name: '晚' }] });
    const store = { tasks: [check, count, split], records: { '2026-10-17': { daily: { value: true }, water: { value: 4 }, medicine: { doses: { am: { done: true } } } } } };
    assert.deepEqual(taskProgress(count, { value: 4 }), { done: false, ratio: .5, skipped: false });
    assert.equal(daySummary(store, '2026-10-17').ratio, 2 / 3);
    store.records['2026-10-17'] = { daily: { skipped: true }, water: { skipped: true }, medicine: { skipped: true } };
    assert.equal(daySummary(store, '2026-10-17').state, 'skipped');
    store.records['2026-10-17'] = { daily: { value: true }, water: { value: 8 }, medicine: { doses: { am: { done: true }, pm: { done: true } } } };
    assert.equal(daySummary(store, '2026-10-17').state, 'complete');
    assert.equal(daySummary({ tasks: [], records: {} }, '2026-10-17').state, 'empty');
});

test('store validates tasks, persists records atomically and keeps recorded time internal', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'star-orbit-'));
    const now = new Date('2026-10-17T08:12:00.000Z');
    try {
        const orbit = createStarOrbit({ directory, clock: () => now });
        assert.throws(() => orbit.createTask({ name: '', mode: 'check', schedule: { kind: 'daily' } }), error => error.status === 400);
        const water = orbit.createTask({ name: '喝水', icon: '💧', mode: 'count', target: 8, schedule: { kind: 'daily', startDate: '2026-10-17' } });
        orbit.patchRecord('2026-10-17', water.id, { value: 5 });
        assert.equal(orbit.summary('2026-10-17').highlight.value, 5);
        assert.equal(orbit.view('2026-10-17', '2026-10-17').records['2026-10-17'][water.id].recordedAt, now.toISOString());
        assert.equal(fs.existsSync(path.join(directory, 'star_orbit.json')), true);
        assert.equal(fs.readdirSync(directory).some(name => name.includes('.tmp.')), false);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('HTTP routes create a task, record progress and reject dates without an arrangement', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'star-orbit-route-'));
    const orbit = createStarOrbit({ directory, clock: () => new Date('2026-10-17T08:12:00.000Z') });
    const app = express(); app.use(express.json()); app.use('/api/star-orbit', orbit.router);
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/star-orbit`;
    try {
        const created = await fetch(base + '/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '吃药', icon: '💊', mode: 'split', doses: ['早', '晚'], schedule: { kind: 'range', startDate: '2026-10-17', endDate: '2026-10-21' } }) });
        assert.equal(created.status, 201); const task = (await created.json()).task;
        const recorded = await fetch(`${base}/days/2026-10-17/tasks/${task.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ doseId: 'dose_1', done: true, time: '08:12' }) });
        assert.equal(recorded.status, 200);
        const view = await (await fetch(base + '?from=2026-10-17&to=2026-10-21')).json();
        assert.equal(view.records['2026-10-17'][task.id].doses.dose_1.time, '08:12');
        const outside = await fetch(`${base}/days/2026-10-22/tasks/${task.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ doseId: 'dose_1', done: true }) });
        assert.equal(outside.status, 404);
    } finally { await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); }
});
