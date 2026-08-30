'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchHealthSummary, getShanghaiDate, healthDataStatus, normalizeDate } = require('../health-data');

const ENV = {
    HEALTH_DATA_ENABLED: 'true',
    HEALTH_SERVICE_URL: 'http://127.0.0.1:8091',
    HEALTH_SERVICE_TOKEN: 'a'.repeat(32),
};

test('uses Asia/Shanghai when defaulting the date', () => {
    assert.equal(getShanghaiDate(new Date('2026-08-30T18:00:00Z')), '2026-08-31');
    assert.equal(normalizeDate('', new Date('2026-08-30T18:00:00Z')), '2026-08-31');
});

test('does not consider an external health service URL configured', () => {
    const status = healthDataStatus({ ...ENV, HEALTH_SERVICE_URL: 'https://example.com' });
    assert.equal(status.configured, false);
    assert.equal(status.reason, 'invalid_service_url');
});

test('sends an authenticated loopback request and returns only the expected envelope', async () => {
    let seen;
    const output = await fetchHealthSummary({ date: '2026-08-30', type: 'sleep' }, {
        env: ENV,
        fetchImpl: async (url, options) => {
            seen = { url: String(url), authorization: options.headers.Authorization };
            return new Response(JSON.stringify({ ok: true, date: '2026-08-30', data: { sleep: [{ score: 90 }] } }), { status: 200 });
        },
    });
    assert.equal(seen.url, 'http://127.0.0.1:8091/health?date=2026-08-30&type=sleep');
    assert.equal(seen.authorization, `Bearer ${ENV.HEALTH_SERVICE_TOKEN}`);
    assert.deepEqual(JSON.parse(output).data, { sleep: [{ score: 90 }] });
});

test('rejects unsupported dates and data types before making a request', async () => {
    await assert.rejects(() => fetchHealthSummary({ date: 'not-a-date' }, { env: ENV, fetchImpl: async () => null }), /日期/);
    await assert.rejects(() => fetchHealthSummary({ date: '2026-02-30' }, { env: ENV, fetchImpl: async () => null }), /日期/);
    await assert.rejects(() => fetchHealthSummary({ type: 'blood_pressure' }, { env: ENV, fetchImpl: async () => null }), /type/);
});
