/* Codex settings and durable, read-only work journal. */
let codexSettingsDefault = '';
let codexSettingsLoading = false;
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
    button.disabled = true;
    status.textContent = '正在读取设定…';
    try {
        const data = await codexWorkspaceRequest('/api/codex/settings');
        codexSettingsDefault = data.defaultPrompt;
        input.value = data.settings.prompt;
        input.disabled = false;
        button.disabled = false;
        status.textContent = '保存后从下一轮 Codex 消息生效，正在执行的任务不受影响。';
    } catch (error) { status.textContent = error.message; }
    finally { codexSettingsLoading = false; }
}

async function codexSettingsSave(event) {
    event.preventDefault();
    if (codexSettingsLoading) return;
    const button = document.getElementById('codexSettingsSave');
    const status = document.getElementById('codexSettingsStatus');
    button.disabled = true;
    try {
        await codexWorkspaceRequest('/api/codex/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: document.getElementById('codexSettingsPrompt').value }) });
        status.textContent = '设定已保存 · 下一轮生效';
    } catch (error) { status.textContent = '未保存：' + error.message; }
    finally { button.disabled = false; }
}

function codexSettingsReset() {
    if (!document.getElementById('codexSettingsPrompt').disabled) {
        document.getElementById('codexSettingsPrompt').value = codexSettingsDefault;
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
