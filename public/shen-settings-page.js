/* Shenwang prompt A/B settings. Provider controls remain in script.js. */
'use strict';

const shenSettingsDraftKey = 'syzygy.shen-settings.draft.v1';
let shenSettingsRevision = null;
let shenSettingsActive = 'A';
let shenSettingsEnabled = 'A';
let shenSettingsServerValue = null;

function shenSettingsRefreshOverview() {
    const prompt = document.getElementById('shenSettingsPrompt' + shenSettingsActive)?.value || '';
    const preview = document.getElementById('shenPromptPreview');
    const count = document.getElementById('shenPromptCharCount');
    const badge = document.getElementById('shenPromptEnabledBadge');
    const supplier = document.getElementById('shenSupplierCurrent');
    const model = document.getElementById('shenModelCurrent');
    if (preview) preview.textContent = prompt.trim().replace(/\s+/g, ' ') || '还没有内容';
    if (count) count.textContent = String(prompt.length);
    if (badge) badge.textContent = `${shenSettingsEnabled} 版 · 启用中`;
    if (supplier && typeof suppliers !== 'undefined') supplier.textContent = suppliers[activeSupIndex]?.name || '未配置接口';
    if (model) model.textContent = document.getElementById('modelSelect')?.value || '未选择模型';
}

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
    ['shenSettingsPromptA', 'shenSettingsPromptB', 'shenSettingsSaveButton'].forEach(id => {
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
            tab.textContent = `${version} 版${version === shenSettingsEnabled ? ' · 启用中' : ''}`;
        }
        if (panel) panel.hidden = !selected;
    }
    const save = document.getElementById('shenSettingsSaveButton');
    if (save) save.textContent = '保存并启用';
    const sync = document.getElementById('shenSettingsSyncButton');
    if (sync) sync.textContent = `同步到 ${shenSettingsActive === 'A' ? 'B' : 'A'} 版`;
    shenSettingsRefreshOverview();
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
    shenSettingsRefreshOverview();
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
        shenSettingsEnabled = data.settings.active === 'B' ? 'B' : 'A';
        shenSettingsFill(data.settings);
        shenSettingsSetEnabled(true);
        if (typeof renderSuppliers === 'function') renderSuppliers();
        const draft = shenSettingsReadDraft();
        const different = draft && JSON.stringify({ active: draft.active, prompts: draft.prompts }) !== JSON.stringify({ active: data.settings.active, prompts: data.settings.prompts });
        const restore = document.getElementById('shenSettingsRestore');
        if (restore) restore.hidden = !different;
        if (status) status.textContent = different ? '有一份未保存草稿。' : '';
    } catch (error) {
        if (status) status.textContent = '读取失败：' + error.message;
    }
}

async function shenSettingsSave() {
    const status = document.getElementById('shenSettingsStatus');
    const button = document.getElementById('shenSettingsSaveButton');
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
        shenSettingsEnabled = data.settings.active === 'B' ? 'B' : 'A';
        shenSettingsFill(data.settings);
        localStorage.removeItem(shenSettingsDraftKey);
        document.getElementById('shenSettingsRestore').hidden = true;
        if (status) status.textContent = `${data.settings.active} 版已保存并启用。`;
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
window.shenSettingsRefreshOverview = shenSettingsRefreshOverview;
