(() => {
    const list = document.getElementById('inboxList');
    if (!list) return;
    const panel = document.createElement('details');
    panel.className = 'memory-diagnostic';
    panel.innerHTML = '<summary>连接诊断</summary><p>查看分类模型实际配置。点击测试会发送虚构短文本，可能产生少量费用；不会读取、修改或重试你的记忆。</p><pre role="status" aria-live="polite">展开后读取配置…</pre><button type="button" class="tiny">发送短请求测试</button>';
    list.before(panel);
    const output = panel.querySelector('pre'), button = panel.querySelector('button');
    let busy = false;
    function render(data) {
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
        output.textContent = test ? '正在测试，最多等待约 20 秒…' : '正在读取实际配置…';
        try {
            const response = await fetch('/api/memory-curator-diagnostics', { method: test ? 'POST' : 'GET', cache: 'no-store' });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || '无法读取诊断，请检查登录状态');
            render(data);
        } catch (error) { output.textContent = '诊断失败：' + error.message; }
        finally { busy = false; button.disabled = false; }
    }
    panel.addEventListener('toggle', () => { if (panel.open) request(false); });
    button.addEventListener('click', () => request(true));
})();
