'use strict';

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const POLICY = Object.freeze({
    version: 'wake-activation-v1',
    driveMean: 0.50, driveMin: 0.20, driveMax: 0.80, driveHalfLifeMinutes: 12, runKick: 0.10,
    toneMean: 0.50, toneMin: 0.25, toneMax: 0.75, toneHalfLifeHours: 6, toneSigma: 0.10,
    driftMin: -0.40, driftMax: 0.40, driftHalfLifeMinutes: 25, driftSigma: 0.18,
    lambdaBasePerHour: 1.50, betaDrive: 1.80, betaTone: 1.60, betaDrift: 1.20,
    lambdaMinPerHour: 0.15, lambdaMaxPerHour: 8.00,
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const halfLifeDecay = (elapsedMs, halfLifeMs) => Math.pow(2, -Math.max(0, elapsedMs) / halfLifeMs);

function nextUnit(seed) {
    let value = (Number(seed) >>> 0) || 0x9e3779b9;
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return { seed: value >>> 0, value: ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
}

function nextNormal(seed) {
    const first = nextUnit(seed);
    const second = nextUnit(first.seed);
    const u = Math.max(first.value, Number.EPSILON);
    return { seed: second.seed, value: Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * second.value) };
}

function freshState(now = new Date(), entropy = Math.floor(Math.random() * 0xffffffff)) {
    const thresholdDraw = nextUnit(entropy);
    return {
        policy_version: POLICY.version,
        activation_drive: POLICY.driveMean,
        latent_activity_tone: POLICY.toneMean,
        stochastic_drift_state: 0,
        cumulative_hazard: 0,
        threshold: -Math.log(Math.max(thresholdDraw.value, Number.EPSILON)),
        entropy: thresholdDraw.seed,
        generation: 1,
        last_updated_at: now.toISOString(),
        last_run_at: null,
        last_wake_at: null,
    };
}

function normalizeState(raw, now = new Date()) {
    const base = freshState(now, Number(raw?.entropy) || undefined);
    const state = { ...base, ...(raw && typeof raw === 'object' ? raw : {}) };
    state.policy_version = POLICY.version;
    state.activation_drive = clamp(Number(state.activation_drive), POLICY.driveMin, POLICY.driveMax);
    state.latent_activity_tone = clamp(Number(state.latent_activity_tone), POLICY.toneMin, POLICY.toneMax);
    state.stochastic_drift_state = clamp(Number(state.stochastic_drift_state), POLICY.driftMin, POLICY.driftMax);
    state.cumulative_hazard = Math.max(0, Number(state.cumulative_hazard) || 0);
    state.threshold = Math.max(0.000001, Number(state.threshold) || base.threshold);
    state.entropy = Number(state.entropy) >>> 0;
    state.generation = Math.max(1, Number(state.generation) || 1);
    return state;
}

function lambdaPerHour(state, modulation = 1) {
    const safeModulation = clamp(Number(modulation) || 1, 0.60, 3.00);
    const exponent = POLICY.betaDrive * (state.activation_drive - POLICY.driveMean)
        + POLICY.betaTone * (state.latent_activity_tone - POLICY.toneMean)
        + POLICY.betaDrift * state.stochastic_drift_state;
    return clamp(POLICY.lambdaBasePerHour * Math.exp(exponent) * safeModulation, POLICY.lambdaMinPerHour, POLICY.lambdaMaxPerHour);
}

function advanceState(raw, now = new Date(), modulation = 1) {
    const state = normalizeState(raw, now);
    const lastMs = new Date(state.last_updated_at || now).getTime();
    const elapsedMs = clamp(now.getTime() - lastMs, 0, 12 * HOUR_MS);
    if (!elapsedMs) return { state, lambda_per_hour: lambdaPerHour(state, modulation), triggered: state.cumulative_hazard >= state.threshold };
    const toneDecay = halfLifeDecay(elapsedMs, POLICY.toneHalfLifeHours * HOUR_MS);
    const driftDecay = halfLifeDecay(elapsedMs, POLICY.driftHalfLifeMinutes * MINUTE_MS);
    const driveDecay = halfLifeDecay(elapsedMs, POLICY.driveHalfLifeMinutes * MINUTE_MS);
    const toneNoise = nextNormal(state.entropy); const driftNoise = nextNormal(toneNoise.seed);
    state.entropy = driftNoise.seed;
    state.activation_drive = clamp(POLICY.driveMean + (state.activation_drive - POLICY.driveMean) * driveDecay, POLICY.driveMin, POLICY.driveMax);
    state.latent_activity_tone = clamp(POLICY.toneMean + (state.latent_activity_tone - POLICY.toneMean) * toneDecay + POLICY.toneSigma * Math.sqrt(1 - toneDecay ** 2) * toneNoise.value, POLICY.toneMin, POLICY.toneMax);
    state.stochastic_drift_state = clamp(state.stochastic_drift_state * driftDecay + POLICY.driftSigma * Math.sqrt(1 - driftDecay ** 2) * driftNoise.value, POLICY.driftMin, POLICY.driftMax);
    const lambda = lambdaPerHour(state, modulation);
    state.cumulative_hazard += lambda * (elapsedMs / HOUR_MS);
    state.last_updated_at = now.toISOString();
    return { state, lambda_per_hour: lambda, triggered: state.cumulative_hazard >= state.threshold };
}

function recordAgentRun(raw, now = new Date()) {
    const state = normalizeState(raw, now);
    const draw = nextUnit(state.entropy);
    state.entropy = draw.seed;
    state.activation_drive = clamp(state.activation_drive - POLICY.runKick, POLICY.driveMin, POLICY.driveMax);
    state.cumulative_hazard = 0;
    state.threshold = -Math.log(Math.max(draw.value, Number.EPSILON));
    state.generation += 1;
    state.last_updated_at = now.toISOString();
    state.last_run_at = now.toISOString();
    return state;
}

function millisecondsUntilCandidate(raw, now = new Date(), modulation = 1) {
    const { state, lambda_per_hour: lambda } = advanceState(raw, now, modulation);
    if (state.cumulative_hazard >= state.threshold) return 0;
    return Math.max(1000, ((state.threshold - state.cumulative_hazard) / lambda) * HOUR_MS);
}

module.exports = { POLICY, freshState, normalizeState, lambdaPerHour, advanceState, recordAgentRun, millisecondsUntilCandidate };
