'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { cityLabel, locationAge, locationIsFresh, locationTimestamp, preserveLegacyLocationTimestamp } = require('../sensor-location');

test('GPS freshness uses its own timestamp instead of a newer battery packet', () => {
    const state = {
        received_at: '2026-10-18T12:59:00.000Z',
        captured_at: '2026-10-18T12:59:00.000Z',
        location: { latitude: 35, longitude: 135, captured_at: '2026-10-18T12:00:00.000Z' },
        battery: { level_percent: 80 }
    };
    const now = Date.parse('2026-10-18T13:00:00.000Z');
    assert.equal(locationTimestamp(state), '2026-10-18T12:00:00.000Z');
    assert.equal(locationAge(state, now), 60 * 60 * 1000);
    assert.equal(locationIsFresh(state, now), false);
});

test('legacy sensor states remain compatible and city labels prefer locality-sized fields', () => {
    const legacy = { received_at: '2026-10-18T12:00:00Z', captured_at: '2026-10-18T11:59:00Z', location: { latitude: 35, longitude: 135 } };
    assert.equal(locationTimestamp(legacy), '2026-10-18T11:59:00.000Z');
    assert.equal(locationIsFresh(legacy, Date.parse('2026-10-18T12:10:00Z')), true);
    assert.equal(cityLabel({ address: { city: '札幌市', state: '北海道' } }), '札幌市');
    assert.equal(cityLabel({ address: { town: '小樽市', state: '北海道' } }), '小樽市');
});

test('legacy GPS time is frozen before a newer non-location packet updates the envelope', () => {
    const state = { received_at: '2026-10-18T12:00:00Z', captured_at: '2026-10-18T11:59:00Z', location: { latitude: 35, longitude: 135 } };
    assert.equal(preserveLegacyLocationTimestamp(state), true);
    state.captured_at = '2026-10-18T13:00:00Z';
    state.received_at = '2026-10-18T13:00:00Z';
    assert.equal(locationTimestamp(state), '2026-10-18T11:59:00.000Z');
    assert.equal(preserveLegacyLocationTimestamp(state), false);
});

test('missing coordinates never become a fresh zero-zero location', () => {
    const now = Date.parse('2026-10-18T12:00:00Z');
    assert.equal(locationIsFresh({ location: { latitude: null, longitude: null, captured_at: '2026-10-18T12:00:00Z' } }, now), false);
    assert.equal(locationIsFresh({ location: { latitude: 0, longitude: 0, captured_at: '2026-10-18T12:00:00Z' } }, now), true);
});
