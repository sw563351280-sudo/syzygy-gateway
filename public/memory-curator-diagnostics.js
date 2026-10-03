(() => {
    const list = document.getElementById('inboxList');
    if (!list) return;
    const flow = document.createElement('section');
    flow.className = 'memory-flow';
    flow.innerHTML = '<div class="memory-flow-head"><strong>记忆怎样被整理</strong><button type="button" class="tiny">刷新状态</button></div><p>记下 → 检查并保存 → 后续整理。每一步各司其职，不是同一个模型。</p><div class="memory-flow-cards" aria-live="polite">正在读取各阶段配置…</div>';
    list.before(flow);
    const cards = flow.querySelector('.memory-flow-cards');
    function element(tag, text, parent, className = '') {
        const node = document.createElement(tag); node.textContent = text;
        node.className = className; parent.appendChild(node); return node;
    }
    function serviceState(service, parent) {
        element('div', '当前配置模型：' + service.model, parent, 'memory-flow-model');
        const seen = service.observation;
        let status = !service.configured ? '缺少密钥配置' : '已配置 · 尚未观测到调用';
        if (seen) status = ({ running: '正在调用', success: '最近一次模型调用成功', failed: '最近一次模型调用失败' })[seen.status] || '状态未知';
        element('div', status, parent, 'memory-flow-state ' + (seen?.status === 'failed' || !service.configured ? 'is-warning' : seen?.status === 'success' ? 'is-success' : ''));
        if (seen?.at) element('small', new Date(seen.at).toLocaleString('zh-CN', { hour12: false }), parent);
        if (seen?.error) element('p', seen.error, parent);
    }
    function renderFlow(data) {
        cards.replaceChildren();
        if (!data?.services) { element('p', '流程状态暂不可用，请等待服务器更新后刷新。', cards); return; }
        const first = element('article', '', cards);
        element('h4', '01 · 沈望记下内容', first);
        element('p', '聊天时由沈望选出值得记住的内容，送入收件箱。', first);
        element('div', '模型：随当轮沈望的聊天模型，不固定', first, 'memory-flow-model');
        element('small', '没有统一在线状态；收到记忆也不代表后续已经保存。', first);
        element('p', '另一路入口：夜间管家补录，由 Gemini 3.1 Pro 提取。', first);
        const merge = data.services.find(row => row.id === 'merge');
        const second = element('article', '', cards);
        element('h4', '02 · 检查重复并保存', second);
        element('p', '先找相似旧记忆，再决定新增、合并或交给你确认。没有相似候选时直接保存，不调用审查模型。', second);
        if (merge) serviceState(merge, second);
        element('p', '收件箱待处理 ' + data.pending + ' 条 · 待你确认 ' + data.review + ' 条', second);
        if (data.mergeFailures) element('p', data.mergeFailures + ' 条记录的最近错误发生在归并审查；这是待办记录，不是实时连通检测。', second, 'is-warning');
        element('small', '相似检索：BAAI/bge-m3；不可用时退回文本匹配。保存由程序完成。', second);
        const third = element('article', '', cards);
        element('h4', '03 · 后续整理', third);
        element('p', '写入后，可继续形成关系心得与现实事件；两者分别调用各自模型。', third);
        for (const service of data.services.filter(row => row.id !== 'merge')) {
            const branch = element('div', '', third, 'memory-flow-branch');
            element('strong', service.title, branch); serviceState(service, branch);
        }
        element('p', '状态只记录本次服务启动后观测到的模型调用；“已配置”不等于“连接正常”，调用成功也不等于全部记忆已处理。', cards, 'memory-flow-note');
    }
    const panel = document.createElement('details');
    panel.className = 'memory-diagnostic';
    panel.innerHTML = '<summary>第 02 步 · 归并审查连接诊断</summary><p>只测试检查重复这一步，不测试沈望聊天或后续整理。发送虚构短文本可能产生少量费用；不会修改或重试你的记忆。</p><pre role="status" aria-live="polite">展开后读取配置…</pre><button type="button" class="tiny">测试归并审查连接</button>';
    list.before(panel);
    const output = panel.querySelector('pre'), button = panel.querySelector('button');
    let busy = false;
    function render(data) {
        if (data.flow) renderFlow(data.flow);
        const lines = [];
        if (data.endpoint) lines.push('请求地址：' + data.endpoint, '模型：' + data.model, '密钥配置来源：' + data.keySource + '（不显示密钥）');
        if (data.configured === false) lines.push('尚未配置密钥');
        if (typeof data.ok === 'boolean') {
            lines.push('', data.ok ? '测试成功：连接及分类响应解析正常' : '测试未通过', '耗时：' + data.elapsedMs + ' 毫秒');
            for (const [index, row] of (data.attempts || []).entries()) {
                lines.push('第 ' + (index + 1) + ' 次请求：HTTP ' + row.status + (row.jsonMode ? ' · JSON 模式' : ' · 兼容模式'));
                if (row.requestId) lines.push('请求编号：' + row.requestId);
                if (row.detail) lines.push('错误详情：' + row.detail);
            }
            lines.push('这次测试不代表之前的失败已解决；如需处理待办记忆，请另点重试。');
        }
        if (data.error) lines.push('说明：' + data.error);
        output.textContent = lines.join('\n');
    }
    async function request(test) {
        if (busy) return;
        busy = true; button.disabled = true;
        output.textContent = test ? '正在测试，最多等待约 45 秒…' : '正在读取实际配置…';
        try {
            const response = await fetch('/api/memory-curator-diagnostics', { method: test ? 'POST' : 'GET', cache: 'no-store' });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || '无法读取诊断，请检查登录状态');
            render(data);
        } catch (error) {
            output.textContent = '诊断失败：' + error.message;
            if (!test) { cards.replaceChildren(); element('p', '状态读取失败：' + error.message + '。请点击刷新状态重试。', cards); }
        }
        finally { busy = false; button.disabled = false; }
    }
    panel.addEventListener('toggle', () => { if (panel.open) request(false); });
    button.addEventListener('click', () => request(true));
    flow.querySelector('button').addEventListener('click', () => request(false));
    request(false); // Local read only; never sends a model request.
})();
