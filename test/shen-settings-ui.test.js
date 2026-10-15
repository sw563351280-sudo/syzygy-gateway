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
    assert.equal(document.getElementById('shenPromptEnabledBadge').textContent, 'B 版 · 启用中');
    assert.equal(document.getElementById('shenSettingsSaveButton').textContent, '保存并启用');
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
    assert.equal(document.getElementById('shenSettingsSyncButton').textContent, '同步到 A 版');
});

test('collapsed prompt overview follows the selected draft without changing the enabled badge', async () => {
    const { context, document } = fixture();
    await context.shenSettingsLoad();
    context.shenSettingsSelect('B');
    document.getElementById('shenSettingsPromptB').value = '第一行\n第二行';
    context.shenSettingsDraft();
    assert.equal(document.getElementById('shenPromptPreview').textContent, '第一行 第二行');
    assert.equal(document.getElementById('shenPromptCharCount').textContent, '7');
    assert.equal(document.getElementById('shenPromptEnabledBadge').textContent, 'A 版 · 启用中');
});

test('save control cannot shadow the inline save handler', () => {
    const html = fs.readFileSync(require.resolve('../public/index.html'), 'utf8');
    assert.match(html, /id="shenSettingsSaveButton"[^>]*onclick="shenSettingsSave\(\)"/);
    assert.doesNotMatch(html, /id="shenSettingsSave"/);
});

test('settings page keeps model and prompt controls collapsed in the agreed order', () => {
    const html = fs.readFileSync(require.resolve('../public/index.html'), 'utf8');
    const modelPanel = html.indexOf('<details class="shen-supplier-panel">');
    const promptPanel = html.indexOf('<details class="shen-prompt-settings">');
    assert.ok(modelPanel >= 0 && promptPanel > modelPanel);
    assert.doesNotMatch(html.slice(modelPanel, promptPanel), /<details class="shen-supplier-panel" open/);
    assert.doesNotMatch(html.slice(promptPanel), /<details class="shen-prompt-settings" open/);
    assert.match(html, />模型与接口</);
    assert.match(html, />相处设定</);
    assert.doesNotMatch(html, /小屋里的沈望|供应商与模型接口|复制到另一版/);
});
