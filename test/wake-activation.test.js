'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { POLICY, freshState, advanceState, recordAgentRun, millisecondsUntilCandidate } = require('../wake-activation');

test('wake state advances continuously and stays within policy bounds', () => {
    const start = new Date('2026-08-13T00:00:00.000Z');
    const state = freshState(start, 12345);
    const result = advanceState(state, new Date(start.getTime() + 45 * 60000));
    assert.ok(result.state.activation_drive >= POLICY.driveMin && result.state.activation_drive <= POLICY.driveMax);
    assert.ok(result.state.latent_activity_tone >= POLICY.toneMin && result.state.latent_activity_tone <= POLICY.toneMax);
    assert.ok(result.state.stochastic_drift_state >= POLICY.driftMin && result.state.stochastic_drift_state <= POLICY.driftMax);
    assert.ok(result.state.cumulative_hazard > 0);
});

test('a real agent run starts a new cycle with a softer drive rather than a cooldown', () => {
    const now = new Date('2026-08-13T00:00:00.000Z');
    const state = freshState(now, 44); state.activation_drive = 0.6; state.cumulative_hazard = 4;
    const next = recordAgentRun(state, now);
    assert.equal(next.cumulative_hazard, 0);
    assert.equal(next.activation_drive, 0.5);
    assert.equal(next.generation, 2);
    assert.ok(millisecondsUntilCandidate(next, now) > 0);
});
