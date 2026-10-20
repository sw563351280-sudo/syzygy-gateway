'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../public/sensor-location-client.js'), 'utf8');

function fixture({ token = '', response = { ok: true, status: 204 }, geolocationError = null, promptAnswer = null } = {}) {
    const storage = new Map(token ? [['sensor_ingest_token', token]] : []);
    const requests = [];
    const intervals = new Map();
    const listeners = {};
    const elements = new Map([
        ['locationSharingToggle', { checked: false, addEventListener(type, handler) { this[type] = handler; } }],
        ['locationSharingStatus', { textContent: '' }]
    ]);
    let nextInterval = 1;
    let geolocationCalls = 0;
    const document = {
        readyState: 'complete', hidden: false, body: { dataset: { view: 'home' } },
        getElementById: id => elements.get(id) || null,
        addEventListener(type, handler) { listeners[type] = handler; }
    };
    const context = vm.createContext({
        document,
        navigator: { geolocation: { getCurrentPosition(success, failure) {
            geolocationCalls++;
            if (geolocationError) return failure(geolocationError);
            success({ timestamp: Date.now(), coords: { latitude: 39.12, longitude: 117.2, accuracy: 18 } });
        } } },
        localStorage: {
            getItem: key => storage.get(key) || null,
            setItem: (key, value) => storage.set(key, String(value)),
            removeItem: key => storage.delete(key)
        },
        prompt: () => promptAnswer,
        fetch: async (url, options) => { requests.push({ url, options }); return response; },
        setInterval(handler, delay) { const id = nextInterval++; intervals.set(id, { handler, delay }); return id; },
        clearInterval(id) { intervals.delete(id); },
        Date, Number, String, Boolean, JSON, Promise
    });
    context.window = context;
    vm.runInContext(source, context);
    return { context, document, elements, storage, requests, intervals, listeners, get geolocationCalls() { return geolocationCalls; } };
}

test('existing sensor pairing enables location only when chat becomes active', async () => {
    const app = fixture({ token: 'paired-token' });
    assert.equal(app.elements.get('locationSharingToggle').checked, true);
    assert.equal(app.geolocationCalls, 0);

    app.context.SyzygyLocation.setChatActive(true);
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(app.geolocationCalls, 1);
    assert.equal(app.requests.length, 1);
    assert.equal(app.requests[0].url, '/api/sensors/ingest');
    assert.equal(app.requests[0].options.headers.Authorization, 'Bearer paired-token');
    const payload = JSON.parse(app.requests[0].options.body);
    assert.equal(payload.device_id, 'iphone-chat');
    assert.equal(payload.latitude, 39.12);
    assert.equal(payload.longitude, 117.2);
    assert.equal(Object.hasOwn(payload, 'sound_average'), false);
    assert.equal(app.elements.get('locationSharingStatus').textContent, '刚刚更新');
    assert.equal([...app.intervals.values()][0].delay, 5 * 60 * 1000);
});

test('unpaired browsers stay off and never request coordinates', () => {
    const app = fixture();
    assert.equal(app.elements.get('locationSharingToggle').checked, false);
    app.context.SyzygyLocation.setChatActive(true);
    assert.equal(app.geolocationCalls, 0);
    assert.equal(app.requests.length, 0);
    assert.equal(app.elements.get('locationSharingStatus').textContent, '尚未配对 · 打开开关完成');
});

test('turning location on pairs in settings and uploads when chat opens', async () => {
    const app = fixture({ promptAnswer: 'new-device-token' });
    const toggle = app.elements.get('locationSharingToggle');
    toggle.checked = true;
    toggle.change();

    assert.equal(toggle.checked, true);
    assert.equal(app.storage.get('sensor_ingest_token'), 'new-device-token');
    assert.equal(app.storage.get('syzygy.location-sharing.enabled.v1'), 'true');
    assert.equal(app.elements.get('locationSharingStatus').textContent, '聊天打开时自动更新');

    app.context.SyzygyLocation.setChatActive(true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(app.requests.length, 1);
    assert.equal(app.requests[0].options.headers.Authorization, 'Bearer new-device-token');
});

test('cancelling pairing leaves location sharing off', () => {
    const app = fixture({ promptAnswer: null });
    const toggle = app.elements.get('locationSharingToggle');
    toggle.checked = true;
    toggle.change();

    assert.equal(toggle.checked, false);
    assert.equal(app.storage.has('sensor_ingest_token'), false);
    assert.equal(app.storage.get('syzygy.location-sharing.enabled.v1'), 'false');
    assert.equal(app.elements.get('locationSharingStatus').textContent, '尚未配对 · 打开开关完成');
});

test('turning sharing off clears the foreground timer and blocks later updates', () => {
    const app = fixture({ token: 'paired-token' });
    app.context.SyzygyLocation.setChatActive(true);
    assert.equal(app.geolocationCalls, 1);
    app.context.SyzygyLocation.setEnabled(false);
    app.context.SyzygyLocation.requestUpdate();
    assert.equal(app.geolocationCalls, 1);
    assert.equal(app.intervals.size, 0);
    assert.equal(app.storage.get('syzygy.location-sharing.enabled.v1'), 'false');
    assert.equal(app.elements.get('locationSharingStatus').textContent, '已关闭');
});

test('location errors are shown without sending a request', () => {
    const app = fixture({ token: 'paired-token', geolocationError: { code: 1 } });
    app.context.SyzygyLocation.setChatActive(true);
    assert.equal(app.requests.length, 0);
    assert.equal(app.elements.get('locationSharingStatus').textContent, '需要重新允许定位');
});

test('an unauthorized upload clears the bad pairing and stops retries', async () => {
    const app = fixture({ token: 'expired-token', response: { ok: false, status: 401 } });
    app.context.SyzygyLocation.setChatActive(true);
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(app.storage.has('sensor_ingest_token'), false);
    assert.equal(app.storage.get('syzygy.location-sharing.enabled.v1'), 'false');
    assert.equal(app.elements.get('locationSharingToggle').checked, false);
    assert.equal(app.elements.get('locationSharingStatus').textContent, '配对已失效 · 打开开关重配');
    assert.equal(app.intervals.size, 0);
});

test('sensor page and environment tool no longer expose microphone collection', () => {
    const sensors = fs.readFileSync(require.resolve('../public/sensors.html'), 'utf8');
    const server = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const toolStart = server.indexOf('{ type: "function", function: { name: "check_environment"');
    const toolEnd = server.indexOf('\n', toolStart);
    assert.doesNotMatch(sensors, /麦克风|startMic|sound_average|getUserMedia/);
    assert.doesNotMatch(server.slice(toolStart, toolEnd), /响度/);
});
