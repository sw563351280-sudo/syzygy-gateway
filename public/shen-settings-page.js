/* Shenwang prompt A/B settings. Provider controls remain in script.js. */
'use strict';

const shenSettingsDraftKey = 'syzygy.shen-settings.draft.v1';
let shenSettingsRevision = null;
let shenSettingsActive = 'A';
let shenSettingsServerValue = null;

function shenSettingsValues() {
    return {
        active: shenSettingsActive,
        prompts: {
            A: document.getElementById('shenSettingsPromptA')?.value || '',
            B: document.getElementById('shenSettingsPromptB')?.value || ''
        }
    };
}

function shenSettingsSetEnabled(enabled) {
    ['shenSettingsPromptA', 'shenSettingsPromptB', 'shenSettingsSave'].forEach(id => {
        const element = document.getElementById(id);
        if (element) element.disabled = !enabled;
    });
}

function shenSettingsRenderSelection() {
    for (const version of ['A', 'B']) {
        const selected = version === shenSettingsActive;
        const tab = document.getElementById('shenPromptTab' + version);
        const panel = document.getElementById('shenPromptPanel' + version);
        if (tab) {
            tab.classList.toggle('active', selected);
            tab.setAttribute('aria-checked', selected ? 'true' : 'false');
        }
        if (panel) panel.hidden = !selected;
    }
    const save = document.getElementById('shenSettingsSave');
    if (save) save.textContent = `保存并启用 ${shenSettingsActive} 版`;
}

function shenSettingsFill(value) {
    shenSettingsActive = value.active === 'B' ? 'B' : 'A';
    document.getElementById('shenSettingsPromptA').value = value.prompts?.A || '';
    document.getElementById('shenSettingsPromptB').value = value.prompts?.B || '';
    shenSettingsRenderSelection();
}

function shenSettingsSelect(version) {
    if (version !== 'A' && version !== 'B') return;
    shenSettingsActive = version;
    shenSettingsRenderSelection();
    shenSettingsDraft();
}

function shenSettingsDraft() {
    if (!shenSettingsServerValue) return;
    try {
        localStorage.setItem(shenSettingsDraftKey, JSON.stringify({
            ...shenSettingsValues(),
            baseRevision: shenSettingsRevision,
            savedAt: new Date().toISOString()
        }));
    } catch (_) {}
}

function shenSettingsReadDraft() {
    try {
        const draft = JSON.parse(localStorage.getItem(shenSettingsDraftKey) || 'null');
        if (!draft || !draft.prompts || typeof draft.prompts.A !== 'string' || typeof draft.prompts.B !== 'string') return null;
        return draft;
    } catch (_) { return null; }
}

function shenSettingsRestoreDraft() {
    const draft = shenSettingsReadDraft();
    if (!draft) return;
    shenSettingsFill(draft);
    document.getElementById('shenSettingsRestore').hidden = true;
    document.getElementById('shenSettingsStatus').textContent = '已恢复本机草稿，请核对后保存。';
}

async function shenSettingsLoad() {
    const status = document.getElementById('shenSettingsStatus');
    shenSettingsSetEnabled(false);
    if (status) status.textContent = '正在读取沈望设定…';
    try {
        const response = await fetch('/api/shen-settings', { cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.version !== 1 || !data.settings) throw new Error(data.error || '无法读取沈望设定');
        shenSettingsRevision = data.settings.updatedAt || null;
        shenSettingsServerValue = data.settings;
        shenSettingsFill(data.settings);
        shenSettingsSetEnabled(true);
        if (typeof renderSuppliers === 'function') renderSuppliers();
        const draft = shenSettingsReadDraft();
        const different = draft && JSON.stringify({ active: draft.active, prompts: draft.prompts }) !== JSON.stringify({ active: data.settings.active, prompts: data.settings.prompts });
        const restore = document.getElementById('shenSettingsRestore');
        if (restore) restore.hidden = !different;
        if (status) status.textContent = different
            ? `服务器当前启用 ${data.settings.active} 版；本机还有一份未保存草稿。`
            : `当前启用 ${data.settings.active} 版。切换需点击保存。`;
    } catch (error) {
        if (status) status.textContent = '读取失败：' + error.message;
    }
}

async function shenSettingsSave() {
    const status = document.getElementById('shenSettingsStatus');
    const button = document.getElementById('shenSettingsSave');
    const values = shenSettingsValues();
    if (!values.prompts.A.trim() || !values.prompts.B.trim()) {
        if (status) status.textContent = 'A/B 两版 Prompt 都需要填写。';
        return;
    }
    shenSettingsDraft();
    if (button) button.disabled = true;
    if (status) status.textContent = '正在保存…';
    try {
        const response = await fetch('/api/shen-settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...values, expectedUpdatedAt: shenSettingsRevision })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.version !== 1 || !data.settings) throw new Error(data.error || '保存失败');
        shenSettingsRevision = data.settings.updatedAt;
        shenSettingsServerValue = data.settings;
        shenSettingsFill(data.settings);
        localStorage.removeItem(shenSettingsDraftKey);
        document.getElementById('shenSettingsRestore').hidden = true;
        if (status) status.textContent = `${data.settings.active} 版已保存并启用，将从下一条消息开始使用。`;
    } catch (error) {
        if (status) status.textContent = '保存失败：' + error.message + ' 草稿已保留。';
    } finally {
        if (button) button.disabled = false;
    }
}

function shenSettingsCopyToOther() {
    const from = shenSettingsActive;
    const to = from === 'A' ? 'B' : 'A';
    const source = document.getElementById('shenSettingsPrompt' + from);
    const target = document.getElementById('shenSettingsPrompt' + to);
    if (!source || !target) return;
    target.value = source.value;
    shenSettingsActive = to;
    shenSettingsRenderSelection();
    shenSettingsDraft();
    document.getElementById('shenSettingsStatus').textContent = `已复制到 ${to} 版，保存后才会启用。`;
    target.focus();
}

window.shenSettingsLoad = shenSettingsLoad;
window.shenSettingsSave = shenSettingsSave;
window.shenSettingsSelect = shenSettingsSelect;
window.shenSettingsDraft = shenSettingsDraft;
window.shenSettingsRestoreDraft = shenSettingsRestoreDraft;
window.shenSettingsCopyToOther = shenSettingsCopyToOther;
