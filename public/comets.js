(() => {
    'use strict';
    const pwd = new URLSearchParams(location.search).get('pwd') || localStorage.getItem('memoryPwd') || '';
    const query = '?pwd=' + encodeURIComponent(pwd);
    const list = document.getElementById('list'), count = document.getElementById('count'), status = document.getElementById('careStatus');
    document.getElementById('back').href = '/' + query;
    document.getElementById('star').href = '/long-term.html' + query;
    document.getElementById('growth').href = '/relationship-growth.html' + query;
    document.getElementById('dust').href = '/stardust.html' + query;
    const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const stamp = value => {
        if (!value) return '';
        const date = new Date(value);
        if (!Number.isFinite(date.getTime())) return '';
        return date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    };
    function render(item) {
        const due = stamp(item.due_at), origin = stamp(item.source_at || item.created_at);
        const reason = item.reason === '存在自然的后续' ? '' : item.reason;
        const attempts = Number(item.attempts) || 0;
        return `<article class="comet">
            <div class="head"><span class="entity">${esc(item.entity || '牵挂')}</span><span class="due">${due ? '下次想起 · ' + due : ''}</span></div>
            <div class="content">${esc(item.content)}</div>
            ${item.context ? `<p class="care-context">${esc(item.context)}</p>` : ''}
            ${reason ? `<p class="care-reason">还惦记着：${esc(reason)}</p>` : ''}
            ${item.source_quote ? `<details class="care-source"><summary>当时的原话${origin ? ' · ' + origin : ''}</summary><blockquote>${esc(item.source_quote)}</blockquote></details>` : ''}
            ${!item.context && !item.source_quote ? '<p class="care-missing">这条旧牵挂没有留下原始背景。</p>' : ''}
            <div class="meta">${attempts ? '已经想起 ' + attempts + ' 次' : '还没问起'}</div>
            <details class="care-actions"><summary aria-label="牵挂操作"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1 12-12-3-3L5 16z"/></svg></summary><button type="button" data-resolve="${esc(item.id)}">已经好了</button></details>
        </article>`;
    }
    async function load() {
        status.textContent = '';
        try {
            const response = await fetch('/api/anticipations' + query, { cache: 'no-store' });
            if (!response.ok) throw new Error('read failed');
            const data = await response.json();
            if (!Array.isArray(data.anticipations)) throw new Error('invalid response');
            const items = data.anticipations.filter(item => item.status === 'open');
            count.textContent = items.length + ' 条牵挂';
            list.innerHTML = items.map(render).join('') || '<div class="empty">此刻没有悬着的事。</div>';
        } catch (_) {
            count.textContent = '';
            list.innerHTML = '<div class="empty">轨道暂时无法读取。<br><button type="button" class="care-retry">再试一次</button></div>';
        }
    }
    list.addEventListener('click', async event => {
        if (event.target.closest('.care-retry')) { await load(); return; }
        const button = event.target.closest('[data-resolve]');
        if (!button || button.disabled) return;
        button.disabled = true;
        status.textContent = '';
        try {
            const response = await fetch('/api/anticipations/' + encodeURIComponent(button.dataset.resolve) + '/resolve' + query, { method: 'POST' });
            if (!response.ok) throw new Error('write failed');
            await load();
        } catch (_) {
            status.textContent = '这次没有记下，牵挂还在。可以再试一次。';
            button.disabled = false;
        }
    });
    document.addEventListener('click', event => document.querySelectorAll('.care-actions[open]').forEach(menu => { if (!menu.contains(event.target)) menu.open = false; }));
    document.addEventListener('keydown', event => { if (event.key === 'Escape') document.querySelectorAll('.care-actions[open]').forEach(menu => { menu.open = false; menu.querySelector('summary').focus(); }); });
    load();
})();
