'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture() {
    const elements = new Map();
    const storage = new Map();
    const requests = [];
    function element(id) {
        if (!elements.has(id)) elements.set(id, {
            id, value: '', disabled: false, hidden: false, textContent: '', attributes: {},
            classList: { toggle() {} }, setAttribute(name, value) { this.attributes[name] = value; }, focus() {}
        });
        return elements.get(id);
    }
    const document = { getElementById: element };
    const localStorage = {
        getItem: key => storage.get(key) || null,
        setItem: (key, value) => storage.set(key, value),
        removeItem: key => storage.delete(key)
    };
    let saved = { active: 'A', prompts: { A: '提示 A', B: '提示 B' }, updatedAt: null };
    const context = vm.createContext({ document, localStorage, renderSuppliers() {}, fetch: async (_url, options = {}) => {
        requests.push(options);
        if (options.method === 'PUT') {
            const body = JSON.parse(options.body);
            saved = { active: body.active, prompts: body.prompts, updatedAt: 'revision-2' };
        }
        return { ok: true, json: async () => ({ version: 1, settings: saved, maxPromptLength: 50000 }) };
    } });
    context.window = context;
    vm.runInContext(fs.readFileSync(require.resolve('../public/shen-settings-page.js'), 'utf8'), context);
    return { context, document, storage, requests };
}

test('loads both prompts and saves the selected variant with revision', async () => {
    const { context, document, requests, storage } = fixture();
    await context.shenSettingsLoad();
    assert.equal(document.getElementById('shenSettingsPromptA').value, '提示 A');
    assert.equal(document.getElementById('shenSettingsPromptB').value, '提示 B');
    context.shenSettingsSelect('B');
    document.getElementById('shenSettingsPromptB').value = '新的 B';
    await context.shenSettingsSave();
    assert.deepEqual(JSON.parse(requests[1].body), {
        active: 'B', prompts: { A: '提示 A', B: '新的 B' }, expectedUpdatedAt: null
    });
    assert.equal(storage.has('syzygy.shen-settings.draft.v1'), false);
    assert.match(document.getElementById('shenSettingsStatus').textContent, /B 版已保存并启用/);
});

test('unsaved prompt drafts survive refresh and require explicit restore', async () => {
    const { context, document } = fixture();
    await context.shenSettingsLoad();
    document.getElementById('shenSettingsPromptA').value = '未写完的 A';
    context.shenSettingsDraft();
    await context.shenSettingsLoad();
    assert.equal(document.getElementById('shenSettingsPromptA').value, '提示 A');
    assert.equal(document.getElementById('shenSettingsRestore').hidden, false);
    context.shenSettingsRestoreDraft();
    assert.equal(document.getElementById('shenSettingsPromptA').value, '未写完的 A');
});

test('copying a prompt creates an editable other variant without saving', async () => {
    const { context, document, requests } = fixture();
    await context.shenSettingsLoad();
    document.getElementById('shenSettingsPromptA').value = '复制我';
    context.shenSettingsCopyToOther();
    assert.equal(document.getElementById('shenSettingsPromptB').value, '复制我');
    assert.equal(requests.length, 1);
    assert.match(document.getElementById('shenSettingsStatus').textContent, /保存后才会启用/);
});
