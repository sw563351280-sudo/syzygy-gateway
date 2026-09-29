/* Codex settings and durable, read-only work journal. */
let codexSettingsDefault = '';
let codexSettingsLoading = false;
let codexSettingsRevision = null;
let codexModels = [];
let codexDefaultModel = '';
const codexDraftKey = 'syzygy.codex-settings.draft.v1';
const codexSavedKey = 'syzygy.codex-settings.saved.v1';
let codexRecovery = null;
function codexSettingsValues() {
    return { prompt: document.getElementById('codexSettingsPrompt').value,
        model: document.getElementById('codexSettingsModel').value,
        effort: document.getElementById('codexSettingsEffort').value };
}
function codexSettingsDraft() {
    if (codexSettingsLoading) return;
    try {
        localStorage.setItem(codexDraftKey, JSON.stringify(codexSettingsValues()));
        document.getElementById('codexSettingsStatus').textContent = '未保存 · 草稿已留在本机，点击保存后同步到服务器';
    } catch (_) { document.getElementById('codexSettingsStatus').textContent = '未保存 · 本机无法保存草稿，请先保存再离开'; }
}
function codexOption(select, value, label) {
    const option = document.createElement('option');
    option.value = value; option.textContent = label; select.appendChild(option);
}
function codexSettingsEfforts(preferred) {
    const model = document.getElementById('codexSettingsModel').value || codexDefaultModel;
    const row = codexModels.find(row => row.model === model);
    const select = document.getElementById('codexSettingsEffort');
    const labels = { none: '不启用', minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '极高', max: '最高', ultra: '超高' };
    const values = row?.supportedReasoningEfforts?.map(item => item.reasoningEffort).filter(Boolean) || [];
    select.replaceChildren();
    // Unknown catalogs preserve the saved value; do not invent model capabilities.
    if (!values.length) values.push(preferred || 'high');
    for (const value of values) codexOption(select, value, labels[value] || value);
    select.value = values.includes(preferred) ? preferred : (values.includes(row?.defaultReasoningEffort) ? row.defaultReasoningEffort : values[0]);
}
function codexSettingsModelChanged() {
    codexSettingsEfforts(document.getElementById('codexSettingsEffort').value);
    codexSettingsDraft();
}
function codexSettingsFill(values) {
    document.getElementById('codexSettingsPrompt').value = values.prompt;
    const select = document.getElementById('codexSettingsModel');
    if (values.model && !Array.from(select.options).some(option => option.value === values.model)) {
        codexOption(select, values.model, values.model + '（已保存，列表中暂不可用）');
    }
    select.value = values.model || '';
    codexSettingsEfforts(values.effort || 'high');
}
function codexSettingsRestoreDraft() {
    try {
        const draft = codexRecovery || JSON.parse(localStorage.getItem(codexDraftKey));
        if (typeof draft?.prompt !== 'string') return;
        codexSettingsFill(draft);
        document.getElementById('codexSettingsStatus').textContent = '已恢复本机草稿，请核对后保存';
    } catch (_) {}
}
let codexRecordsOffset = 0;
let codexRecordsRequest = 0;

async function codexWorkspaceRequest(url, options = {}) {
    const response = await fetch(url, { cache: 'no-store', ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '请求失败，请检查登录和网络');
    return data;
}

async function codexSettingsLoad() {
    const input = document.getElementById('codexSettingsPrompt');
    const button = document.getElementById('codexSettingsSave');
    const status = document.getElementById('codexSettingsStatus');
    codexSettingsLoading = true;
    input.disabled = true;
    document.getElementById('codexSettingsModel').disabled = true;
    document.getElementById('codexSettingsEffort').disabled = true;
    button.disabled = true;
    status.textContent = '正在读取设定…';
    try {
        const data = await codexWorkspaceRequest('/api/codex/settings');
        if (data.version !== 2 || typeof data.defaultModel !== 'string') throw new Error('服务器设定接口尚未更新，请等待部署完成。没有覆盖本机草稿。');
        codexSettingsDefault = data.defaultPrompt;
        codexSettingsRevision = data.settings.updatedAt || null;
        codexDefaultModel = data.defaultModel;
        const model = document.getElementById('codexSettingsModel');
        model.replaceChildren();
        codexOption(model, '', '服务器默认 · ' + codexDefaultModel);
        let catalogError = '';
        try {
            const catalog = await codexWorkspaceRequest('/api/codex/models');
            codexModels = catalog.models || [];
            for (const row of codexModels) codexOption(model, row.model, row.displayName + (row.isDefault ? ' · 推荐' : ''));
        } catch (error) { codexModels = []; catalogError = '模型列表暂不可用：' + error.message; }
        codexSettingsFill(data.settings);
        model.disabled = false;
        const effort = document.getElementById('codexSettingsEffort');
        effort.disabled = false;
        input.disabled = false;
        button.disabled = false;
        status.textContent = '保存后从下一轮 Codex 消息生效，正在执行的任务不受影响。';
        document.getElementById('codexSettingsModelHelp').textContent = catalogError || '来自服务器 Codex 的可用模型；思考程度随模型切换。';
        const restore = document.getElementById('codexSettingsRestore');
        restore.hidden = true;
        codexRecovery = null;
        try {
            let draft = JSON.parse(localStorage.getItem(codexDraftKey));
            const backup = JSON.parse(localStorage.getItem(codexSavedKey));
            if (!draft && backup && (!data.settings.updatedAt || Date.parse(backup.updatedAt) > Date.parse(data.settings.updatedAt))) draft = backup;
            if (draft && JSON.stringify(draft) !== JSON.stringify(codexSettingsValues())) {
                codexRecovery = draft;
                restore.hidden = false;
                status.textContent = '发现本机草稿。可点击「恢复草稿」找回；当前显示服务器已保存的设定。';
            }
        } catch (_) {}
    } catch (error) { status.textContent = error.message; }
    finally { codexSettingsLoading = false; }
}

async function codexSettingsSave(event) {
    event?.preventDefault();
    if (codexSettingsLoading) return;
    codexSettingsDraft();
    const values = codexSettingsValues();
    codexSettingsLoading = true;
    const button = document.getElementById('codexSettingsSave');
    const status = document.getElementById('codexSettingsStatus');
    button.disabled = true;
    for (const id of ['codexSettingsPrompt', 'codexSettingsModel', 'codexSettingsEffort']) document.getElementById(id).disabled = true;
    try {
        const data = await codexWorkspaceRequest('/api/codex/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...values, expectedUpdatedAt: codexSettingsRevision }) });
        if (data.version !== 2 || data.settings?.prompt !== values.prompt.trim() || data.settings?.model !== values.model || data.settings?.effort !== values.effort) throw new Error('服务器没有确认完整设定，草稿已保留');
        codexSettingsRevision = data.settings.updatedAt;
        codexRecovery = null;
        document.getElementById('codexSettingsRestore').hidden = true;
        try {
            localStorage.setItem(codexSavedKey, JSON.stringify(data.settings));
            if (JSON.stringify(codexSettingsValues()) === JSON.stringify(values)) localStorage.removeItem(codexDraftKey);
        } catch (_) {}
        status.textContent = '设定已保存 · 下一轮生效';
    } catch (error) { status.textContent = '未保存：' + error.message; }
    finally {
        button.disabled = false; codexSettingsLoading = false;
        for (const id of ['codexSettingsPrompt', 'codexSettingsModel', 'codexSettingsEffort']) document.getElementById(id).disabled = false;
    }
}

function codexSettingsReset() {
    if (!document.getElementById('codexSettingsPrompt').disabled) {
        document.getElementById('codexSettingsPrompt').value = codexSettingsDefault;
        document.getElementById('codexSettingsModel').value = '';
        codexSettingsEfforts('high');
        codexSettingsDraft();
        document.getElementById('codexSettingsStatus').textContent = '已填入默认设定，点击保存后生效。';
    }
}

async function codexRecordsLoad(reset = true) {
    if (reset) codexRecordsOffset = 0;
    const request = ++codexRecordsRequest;
    const list = document.getElementById('codexRecordsList');
    const status = document.getElementById('codexRecordsStatus');
    status.textContent = '正在读取工作记录…';
    const query = new URLSearchParams({ q: document.getElementById('codexRecordsQuery').value, date: document.getElementById('codexRecordsDate').value, limit: '20', offset: String(codexRecordsOffset) });
    try {
        const data = await codexWorkspaceRequest('/api/codex/work-records?' + query);
        if (request !== codexRecordsRequest) return;
        if (reset) list.replaceChildren();
        for (const row of data.records) {
            const card = document.createElement('article');
            card.className = 'codex-record-card';
            const time = document.createElement('time');
            time.dateTime = row.createdAt;
            time.textContent = new Date(row.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) + ' · 北京时间 · Codex';
            const title = document.createElement('h3');
            title.textContent = row.title;
            const state = document.createElement('small');
            state.textContent = '执行状态：' + ({ completed: '已结束', failed: '失败', interrupted: '已中断' }[row.status] || row.status);
            card.append(time, title, state);
            for (const [field, label] of [['summary', '工作内容'], ['verification', '验证情况'], ['remaining', '待办与风险']]) {
                const heading = document.createElement('h4');
                heading.textContent = label;
                const text = document.createElement('p');
                text.textContent = row[field];
                card.append(heading, text);
            }
            list.appendChild(card);
        }
        codexRecordsOffset += data.records.length;
        document.getElementById('codexRecordsMore').hidden = codexRecordsOffset >= data.total;
        status.textContent = data.total ? '共 ' + data.total + ' 条 · 内容由 Codex 自报，请留意验证情况' : '还没有符合条件的工作记录。Codex 实际处理任务后会写在这里。';
    } catch (error) { if (request === codexRecordsRequest) status.textContent = error.message; }
}

async function ttMemoriesLoad() {
    const status = document.getElementById('ttMemoriesStatus');
    const container = document.getElementById('ttMemoriesGroups');
    status.textContent = '正在打开抽屉…';
    try {
        const data = await codexWorkspaceRequest('/api/codex/memories');
        const groups = [
            ['core', '不会忘的'], ['jiangyu', '关于江鱼'], ['home', '小屋里的事'],
            ['collaboration', '协作默契'], ['tentative', '暂时这样想']
        ];
        container.replaceChildren();
        for (const [key, title] of groups) {
            const section = document.createElement('section');
            section.className = 'tt-memory-group';
            const heading = document.createElement('h3');
            heading.textContent = title;
            section.appendChild(heading);
            const rows = (data.memories || []).filter(row => row.category === key && row.status !== 'deleted');
            if (!rows.length) {
                const empty = document.createElement('p');
                empty.className = 'tt-memory-empty';
                empty.textContent = '还没有放进来的纸条。';
                section.appendChild(empty);
            } else {
                for (const row of rows) {
                    const card = document.createElement('article');
                    card.className = 'tt-memory-card';
                    const content = document.createElement('p');
                    content.textContent = row.content;
                    const meta = document.createElement('small');
                    meta.textContent = [row.kind, row.updatedAt && new Date(row.updatedAt).toLocaleDateString('zh-CN')].filter(Boolean).join(' · ');
                    card.append(content, meta);
                    section.appendChild(card);
                }
            }
            container.appendChild(section);
        }
        status.textContent = (data.memories || []).length ? `共 ${(data.memories || []).length} 条记忆` : '抽屉已经安好，目前还是空的。';
    } catch (error) {
        status.textContent = '小抽屉暂时打不开：' + error.message;
        container.replaceChildren();
    }
}
