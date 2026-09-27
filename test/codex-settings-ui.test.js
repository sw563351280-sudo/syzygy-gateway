'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('settings UI loads and saves model and effort together with the prompt', async () => {
    const elements = new Map();
    const requests = [];
    const document = { getElementById(id) {
        if (!elements.has(id)) elements.set(id, { value: '', disabled: false, textContent: '' });
        return elements.get(id);
    } };
    const context = vm.createContext({ document, fetch: async (url, options) => {
        requests.push({ url, options });
        return { ok: true, json: async () => ({
            settings: { prompt: '原设定', model: 'custom-model', effort: 'low' },
            defaultPrompt: '默认设定', defaultModel: 'server-model'
        }) };
    } });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/workroom-pages.js'), 'utf8'), context);
    await context.codexSettingsLoad();
    assert.equal(document.getElementById('codexSettingsModel').value, 'custom-model');
    assert.equal(document.getElementById('codexSettingsEffort').value, 'low');
    assert.equal(document.getElementById('codexSettingsModel').disabled, false);
    document.getElementById('codexSettingsModel').value = 'next-model';
    document.getElementById('codexSettingsEffort').value = 'xhigh';
    await context.codexSettingsSave({ preventDefault() {} });
    assert.deepEqual(JSON.parse(requests[1].options.body), { prompt: '原设定', model: 'next-model', effort: 'xhigh' });
    context.codexSettingsReset();
    assert.equal(document.getElementById('codexSettingsModel').value, '');
    assert.equal(document.getElementById('codexSettingsEffort').value, 'high');
});
