'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function fixture(version = 2) {
    const elements = new Map(), storage = new Map(), requests = [];
    const document = { createElement: () => ({}), getElementById(id) {
        if (!elements.has(id)) elements.set(id, { value: '', disabled: false, textContent: '', options: [],
            replaceChildren() { this.options = []; }, appendChild(option) { this.options.push(option); } });
        return elements.get(id);
    } };
    const localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
    let saved = { prompt: '原设定', model: 'custom-model', effort: 'low', updatedAt: null };
    const context = vm.createContext({ document, localStorage, fetch: async (url, options) => {
        requests.push({ url, options });
        if (options.method === 'PUT') saved = { ...JSON.parse(options.body), updatedAt: 'new' };
        return { ok: true, json: async () => url.endsWith('/models') ? { models: [{
            model: 'custom-model', displayName: 'Custom Model', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }]
        }] } : { version, settings: saved, defaultPrompt: '默认设定', defaultModel: 'custom-model' } };
    } });
    vm.runInContext(fs.readFileSync(require.resolve('../public/workroom-pages.js'), 'utf8'), context);
    return { context, document, storage, requests };
}
test('picker loads real model capabilities and saves settings with revision', async () => {
    const { context, document, requests, storage } = fixture();
    await context.codexSettingsLoad();
    assert.equal(document.getElementById('codexSettingsModel').value, 'custom-model');
    assert.equal(document.getElementById('codexSettingsEffort').options.length, 2);
    document.getElementById('codexSettingsEffort').value = 'high';
    await context.codexSettingsSave();
    const save = requests.find(request => request.options.method === 'PUT');
    assert.deepEqual(JSON.parse(save.options.body), { prompt: '原设定', model: 'custom-model', effort: 'high', expectedUpdatedAt: null });
    assert.equal(storage.has('syzygy.codex-settings.draft.v1'), false);
    assert.equal(storage.has('syzygy.codex-settings.saved.v1'), true);
    assert.match(document.getElementById('codexSettingsStatus').textContent, /已保存/);
});
test('settings save button cannot trigger native form navigation', () => {
    const html = fs.readFileSync(require.resolve('../public/index.html'), 'utf8');
    assert.match(html, /id="codexSettingsForm"[^>]*onsubmit="event\.preventDefault\(\);window\.codexSettingsSave\(\)"/);
    assert.match(html, /id="codexSettingsSave" type="button" onclick="window\.codexSettingsSave\(\)"/);
    assert.match(html, /id="codexUsageCard" class="codex-usage-card"/);
    assert.match(html, /class="codex-settings-section"/);
    assert.match(html, /工作区便签员/);
    assert.match(html, /id="codexNoteBaseUrl"[^>]*type="url"/);
    assert.match(html, /id="codexNoteApiKey"[^>]*type="password"/);
    assert.match(html, /id="codexNoteTest"[^>]*type="button"/);
});

test('usage dial selects the tightest real rate-limit window', () => {
    const { context } = fixture();
    const rows = JSON.parse(JSON.stringify(context.codexUsageWindows({ rateLimits: { rateLimits: {
        primary: { usedPercent: 18, windowDurationMins: 300, resetsAt: 100 },
        secondary: { usedPercent: 73, windowDurationMins: 10080, resetsAt: 200 }
    } } })));
    assert.deepEqual(rows.map(row => ({ label: row.label, remaining: row.remaining })), [
        { label: '1 周', remaining: 27 },
        { label: '5 小时', remaining: 82 }
    ]);
});
test('refresh preserves unsaved draft and restoration is explicit', async () => {
    const { context, document } = fixture();
    await context.codexSettingsLoad();
    document.getElementById('codexSettingsPrompt').value = '没写完的设定';
    context.codexSettingsDraft();
    await context.codexSettingsLoad();
    assert.equal(document.getElementById('codexSettingsPrompt').value, '原设定');
    assert.equal(document.getElementById('codexSettingsRestore').hidden, false);
    context.codexSettingsRestoreDraft();
    assert.equal(document.getElementById('codexSettingsPrompt').value, '没写完的设定');
});
test('old backend cannot claim successful settings load', async () => {
    const { context, document } = fixture(1);
    await context.codexSettingsLoad();
    assert.equal(document.getElementById('codexSettingsSave').disabled, true);
    assert.match(document.getElementById('codexSettingsStatus').textContent, /尚未更新/);
});
