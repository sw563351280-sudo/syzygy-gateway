/* Codex settings and durable, read-only work journal. */
let codexSettingsDefault = '';
let codexSettingsLoading = false;
let codexSettingsLoadRequest = 0;
let codexSettingsRevision = null;
let codexModels = [];
let codexDefaultModel = '';
let codexUsageRequest = 0;
const codexDraftKey = 'syzygy.codex-settings.draft.v1';
const codexSavedKey = 'syzygy.codex-settings.saved.v1';
let codexRecovery = null;
let codexNoteConfigured = false;
function codexSettingsValues() {
    return { prompt: document.getElementById('codexSettingsPrompt').value,
        model: document.getElementById('codexSettingsModel').value,
        effort: document.getElementById('codexSettingsEffort').value };
}
function codexSettingsDraft() {
    if (codexSettingsLoading) return;
    codexSettingsRefreshOverview();
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
    void codexSettingsSaveChoice();
}
function codexSettingsEffortChanged() {
    codexSettingsDraft();
    void codexSettingsSaveChoice();
}
function codexSettingsRefreshOverview() {
    const modelValue = document.getElementById('codexSettingsModel')?.value || '';
    const model = codexModels.find(row => row.model === modelValue);
    const modelName = model?.displayName || modelValue || (codexDefaultModel ? '服务器默认 · ' + codexDefaultModel : '读取中');
    const effortValue = document.getElementById('codexSettingsEffort')?.value || '';
    const effortLabels = { none: '不启用', minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '极高', max: '最高', ultra: '超高' };
    const overview = document.getElementById('codexModelOverview');
    if (overview) overview.textContent = [modelName, effortLabels[effortValue] || effortValue].filter(Boolean).join(' · ');
    const prompt = document.getElementById('codexSettingsPrompt')?.value || '';
    const preview = document.getElementById('codexPromptPreview');
    const count = document.getElementById('codexPromptCharCount');
    if (preview) preview.textContent = prompt.trim().replace(/\s+/g, ' ') || '还没有内容';
    if (count) count.textContent = String(prompt.length);
}
function codexSettingsFill(values) {
    document.getElementById('codexSettingsPrompt').value = values.prompt;
    const select = document.getElementById('codexSettingsModel');
    if (values.model && !Array.from(select.options).some(option => option.value === values.model)) {
        codexOption(select, values.model, values.model + '（已保存，列表中暂不可用）');
    }
    select.value = values.model || '';
    codexSettingsEfforts(values.effort || 'high');
    codexSettingsRefreshOverview();
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

function codexUsageWindows(data) {
    const payload = data?.rateLimits || {};
    const buckets = payload.rateLimitsByLimitId && Object.keys(payload.rateLimitsByLimitId).length
        ? Object.entries(payload.rateLimitsByLimitId)
        : payload.rateLimits ? [[payload.rateLimits.limitId || '', payload.rateLimits]]
            : (payload.primary || payload.secondary) ? [[payload.limitId || '', payload]] : [];
    const rows = [];
    for (const [limitId, snapshot] of buckets) {
        for (const [kind, window] of [['primary', snapshot?.primary], ['secondary', snapshot?.secondary]]) {
            if (!window || !Number.isFinite(Number(window.usedPercent))) continue;
            const duration = Number(window.windowDurationMins);
            let windowLabel = kind === 'primary' ? '当前周期' : '长期周期';
            if (Number.isFinite(duration) && duration > 0) {
                if (duration % 10080 === 0) windowLabel = duration / 10080 + ' 周';
                else if (duration % 1440 === 0) windowLabel = duration / 1440 + ' 天';
                else if (duration % 60 === 0) windowLabel = duration / 60 + ' 小时';
                else windowLabel = duration + ' 分钟';
            }
            const bucketName = snapshot.limitName || (limitId && limitId !== 'codex' ? limitId : '');
            rows.push({
                label: [bucketName, windowLabel].filter(Boolean).join(' · '),
                remaining: Math.max(0, Math.min(100, 100 - Number(window.usedPercent))),
                resetsAt: Number(window.resetsAt) || null,
                duration: Number.isFinite(duration) ? duration : Number.MAX_SAFE_INTEGER
            });
        }
    }
    return rows.sort((a, b) => a.remaining - b.remaining || a.duration - b.duration);
}

function codexUsageResetLabel(resetsAt) {
    if (!resetsAt) return '未提供重置时间';
    const date = new Date(resetsAt * 1000);
    if (Number.isNaN(date.getTime())) return '未提供重置时间';
    return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date) + ' 重置';
}

function codexUsageRender(data) {
    const rows = codexUsageWindows(data);
    const dial = document.getElementById('codexUsageDial');
    const percent = document.getElementById('codexUsagePercent');
    const windowLabel = document.getElementById('codexUsageWindow');
    const reset = document.getElementById('codexUsageReset');
    const list = document.getElementById('codexUsageWindows');
    if (!rows.length) throw new Error('没有读到可用的额度窗口');
    const tightest = rows[0];
    dial?.style?.setProperty('--remaining', String(tightest.remaining));
    dial?.setAttribute?.('aria-label', `Codex ${tightest.label}剩余 ${tightest.remaining}%`);
    if (percent) percent.textContent = tightest.remaining + '%';
    if (windowLabel) windowLabel.textContent = tightest.label;
    if (reset) reset.textContent = codexUsageResetLabel(tightest.resetsAt);
    if (list) {
        list.replaceChildren();
        for (const row of rows) {
            const item = document.createElement('div');
            item.className = 'codex-usage-row';
            const head = document.createElement('div');
            const label = document.createElement('span');
            label.textContent = row.label;
            const value = document.createElement('strong');
            value.textContent = row.remaining + '%';
            head.append(label, value);
            const track = document.createElement('i');
            const fill = document.createElement('b');
            fill.style.width = row.remaining + '%';
            track.append(fill);
            const time = document.createElement('small');
            time.textContent = codexUsageResetLabel(row.resetsAt);
            item.append(head, track, time);
            list.append(item);
        }
    }
}

async function codexUsageLoad() {
    const request = ++codexUsageRequest;
    const status = document.getElementById('codexUsageStatus');
    if (status) status.textContent = '正在读取…';
    try {
        const data = await codexWorkspaceRequest('/api/codex/usage');
        if (request !== codexUsageRequest) return;
        codexUsageRender(data);
        if (status) status.textContent = data.fetchedAt ? '刚刚更新' : '已更新';
    } catch (error) {
        if (request !== codexUsageRequest) return;
        const percent = document.getElementById('codexUsagePercent');
        const windowLabel = document.getElementById('codexUsageWindow');
        const reset = document.getElementById('codexUsageReset');
        if (percent) percent.textContent = '—';
        if (windowLabel) windowLabel.textContent = '暂时读不到';
        if (reset) reset.textContent = '—';
        if (status) status.textContent = error.message;
    }
}

function codexNoteOverview() {
    const overview = document.getElementById('codexNoteOverview');
    const enabled = document.getElementById('codexNoteEnabled')?.checked;
    const model = document.getElementById('codexNoteModel')?.value || 'deepseek-chat';
    if (overview) overview.textContent = enabled ? `已启用 · ${model}` : `未启用 · ${model}`;
}

async function codexNoteSettingsLoad() {
    const ids = ['codexNoteEnabled', 'codexNoteBaseUrl', 'codexNoteApiKey', 'codexNoteModel', 'codexNoteSave', 'codexNoteTest'];
    ids.forEach(id => { const element = document.getElementById(id); if (element) element.disabled = true; });
    const status = document.getElementById('codexNoteStatus');
    if (status) status.textContent = '正在读取便签员设置…';
    try {
        const data = await codexWorkspaceRequest('/api/workroom-notes/settings');
        if (data.version !== 1) throw new Error('便签员接口尚未更新');
        codexNoteConfigured = data.settings.apiKeyConfigured === true;
        document.getElementById('codexNoteEnabled').checked = data.settings.enabled === true;
        document.getElementById('codexNoteBaseUrl').value = data.settings.baseUrl || 'https://api.deepseek.com';
        const key = document.getElementById('codexNoteApiKey');
        key.value = ''; key.placeholder = codexNoteConfigured ? '已保存 · 留空表示不更换' : 'sk-…';
        document.getElementById('codexNoteModel').value = data.settings.model || 'deepseek-chat';
        if (status) status.textContent = codexNoteConfigured ? 'API Key 已保存在服务端' : '还没有保存 API Key';
        ids.forEach(id => { const element = document.getElementById(id); if (element) element.disabled = false; });
        codexNoteOverview();
    } catch (error) { if (status) status.textContent = '读取失败：' + error.message; }
}

async function codexNoteSettingsSave() {
    const status = document.getElementById('codexNoteStatus');
    const button = document.getElementById('codexNoteSave');
    button.disabled = true;
    const payload = {
        enabled: document.getElementById('codexNoteEnabled').checked,
        baseUrl: document.getElementById('codexNoteBaseUrl').value.trim(),
        model: document.getElementById('codexNoteModel').value.trim()
    };
    const key = document.getElementById('codexNoteApiKey').value.trim();
    if (key || !codexNoteConfigured) payload.apiKey = key;
    try {
        const data = await codexWorkspaceRequest('/api/workroom-notes/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        codexNoteConfigured = data.settings.apiKeyConfigured === true;
        document.getElementById('codexNoteApiKey').value = '';
        document.getElementById('codexNoteApiKey').placeholder = codexNoteConfigured ? '已保存 · 留空表示不更换' : 'sk-…';
        status.textContent = data.settings.enabled ? '便签员已启用 · 下一次回到通讯区时生效' : '便签员设置已保存，目前未启用';
        codexNoteOverview();
    } catch (error) { status.textContent = '未保存：' + error.message; }
    finally { button.disabled = false; }
}

async function codexNoteSettingsTest() {
    const status = document.getElementById('codexNoteStatus');
    const button = document.getElementById('codexNoteTest');
    button.disabled = true; status.textContent = '正在测试连接…';
    try {
        const data = await codexWorkspaceRequest('/api/workroom-notes/test', { method: 'POST' });
        status.textContent = `连接正常 · ${data.model}`;
    } catch (error) { status.textContent = '连接失败：' + error.message; }
    finally { button.disabled = false; }
}

async function codexSettingsLoad() {
    const request = ++codexSettingsLoadRequest;
    const input = document.getElementById('codexSettingsPrompt');
    const button = document.getElementById('codexSettingsSave');
    const status = document.getElementById('codexSettingsStatus');
    codexSettingsLoading = true;
    input.disabled = true;
    document.getElementById('codexSettingsModel').disabled = true;
    document.getElementById('codexSettingsEffort').disabled = true;
    button.disabled = true;
    status.textContent = '正在读取设定…';
    void codexUsageLoad();
    void codexNoteSettingsLoad();
    try {
        const data = await codexWorkspaceRequest('/api/codex/settings');
        if (request !== codexSettingsLoadRequest) return;
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
            if (request !== codexSettingsLoadRequest) return;
            codexModels = catalog.models || [];
            for (const row of codexModels) codexOption(model, row.model, row.displayName + (row.isDefault ? ' · 推荐' : ''));
        } catch (error) {
            if (request !== codexSettingsLoadRequest) return;
            codexModels = []; catalogError = '模型列表暂不可用：' + error.message;
        }
        codexSettingsFill(data.settings);
        // Controls must not become interactive while their change handlers still
        // consider the page loading, or the first selection is silently ignored.
        codexSettingsLoading = false;
        model.disabled = false;
        const effort = document.getElementById('codexSettingsEffort');
        effort.disabled = false;
        input.disabled = false;
        button.disabled = false;
        status.textContent = '';
        document.getElementById('codexSettingsModelHelp').textContent = catalogError;
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
        codexSettingsRefreshOverview();
    } catch (error) { if (request === codexSettingsLoadRequest) status.textContent = error.message; }
    finally { if (request === codexSettingsLoadRequest) codexSettingsLoading = false; }
}

async function codexSettingsSaveChoice() {
    if (codexSettingsLoading) return;
    const model = document.getElementById('codexSettingsModel').value;
    const effort = document.getElementById('codexSettingsEffort').value;
    const button = document.getElementById('codexSettingsSave');
    const status = document.getElementById('codexSettingsStatus');
    codexSettingsLoading = true;
    button.disabled = true;
    document.getElementById('codexSettingsModel').disabled = true;
    document.getElementById('codexSettingsEffort').disabled = true;
    status.textContent = '正在保存模型选择…';
    try {
        const data = await codexWorkspaceRequest('/api/codex/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, effort, expectedUpdatedAt: codexSettingsRevision }) });
        if (data.version !== 2 || data.settings?.model !== model || data.settings?.effort !== effort) throw new Error('服务器没有确认模型选择');
        codexSettingsRevision = data.settings.updatedAt;
        try {
            localStorage.setItem(codexSavedKey, JSON.stringify(data.settings));
            if (JSON.stringify(codexSettingsValues()) === JSON.stringify({ prompt: data.settings.prompt, model, effort })) localStorage.removeItem(codexDraftKey);
        } catch (_) {}
        status.textContent = '模型已保存 · 下一轮生效';
    } catch (error) { status.textContent = '模型未保存：' + error.message; }
    finally {
        codexSettingsLoading = false;
        button.disabled = false;
        document.getElementById('codexSettingsModel').disabled = false;
        document.getElementById('codexSettingsEffort').disabled = false;
    }
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
