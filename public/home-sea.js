/* New home is isolated from the classic layout and loads no secondary page assets. */
(() => {
    'use strict';
    const home = document.getElementById('homeV2');
    const icons = {
        calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/>',
        ring: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="5.5"/>',
        todo: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="m8 12 3 3 5-6"/>',
        clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
        music: '<path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2.5"/><ellipse cx="17" cy="16" rx="3" ry="2.5"/>',
        book: '<path d="M12 5v16M12 5C9 3 5 3 2 4v16c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1Z"/>',
        lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
        photo: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 6"/>',
        chat: '<path d="M21 11a9 9 0 0 1-9 9c-2 0-3-.5-4-1L3 21l1.5-5A9 9 0 1 1 21 11Z"/>',
        settings: '<circle cx="12" cy="12" r="3"/><path d="m9 3-1 3-3 1-2 3 2 2-1 3 2 3 3-1 2 3h3l1-3 3-1 2-3-2-2 1-3-2-3-3 1-2-3Z"/>',
        ledger: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8m-8 4h8m-8 4h5"/>',
        star: '<path d="m12 3 2.7 5.7 6.3.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.3-.9Z"/>',
        orbit: '<circle cx="12" cy="12" r="6"/><ellipse cx="12" cy="12" rx="11" ry="4" transform="rotate(-25 12 12)"/>',
        flo: '<path d="M3 15c3-8 8-8 11-2s5 5 7 2M3 19c3-6 8-6 11-1s5 4 7 1"/>',
        people: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3Zm13-17a3 3 0 0 1 0 6m1 5a5 5 0 0 1 4 5v1h-3"/>',
        boat: '<path d="m2 12 4 7h12l4-7H2Zm4 0 6-9 6 9m-6-9v9m-6 7 6-7 6 7"/>',
        close: '<path d="m6 6 12 12M6 18 18 6"/>',
        arrow: '<path d="m9 5 7 7-7 7"/>'
    };
    const icon = (name, cls = '') => `<svg class="sea-icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || ''}</svg>`;
    const pill = (name, label, action) => `<button type="button" class="sea-pill" data-sea-action="${action}">${icon(name)}<span>${label}</span></button>`;
    home.innerHTML = `
        <div class="sea-atmosphere" aria-hidden="true"><i></i><i></i><i></i><i></i><span id="seaRipple"></span></div>
        <div class="sea-top-anchors">
            <button class="sea-whisper-anchor" type="button" aria-label="听一句沈望的悄悄话" data-sea-action="whisper"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2 12 8 18 10 12 12 10 18 8 12 2 10 8 8Z"/></svg></button>
            <button class="sea-lighthouse" id="homeV2MoreToggle" type="button" aria-label="更多功能" aria-haspopup="dialog" aria-controls="seaMoreDialog" data-sea-action="more"><i></i></button>
            <p id="seaWhisper" class="sea-whisper" role="status"></p>
        </div>
        <header class="home-v2-hero">
            <button class="sea-counter" type="button" data-sea-action="calendar" aria-label="查看纪念日历"><span id="homeV2DayCount">—</span><span class="sea-counter-caption">days together</span></button>
            <p>山河仍在，幸而有你。</p>
        </header>
        <section class="sea-today" aria-labelledby="seaTodayTitle"><h2 id="seaTodayTitle">今日</h2><div id="seaTodayRows"></div></section>
        <section class="sea-updates" aria-label="沈望的留言与最近动态"><button type="button" id="seaNote" class="sea-note" data-sea-action="letter" hidden></button><div id="seaRecent" class="sea-recent"></div></section>
        <nav class="sea-primary" aria-label="小屋入口">${pill('chat', '通讯', 'chat')}<button type="button" id="seaMiss" class="sea-pill sea-miss" data-sea-action="miss"><span class="sea-double-ripple" aria-hidden="true"><i></i><i></i></span><span id="seaMissLabel">想他了</span></button></nav>
        <p id="seaStatus" class="sea-status" role="status"></p>
        <button type="button" class="sea-paperboat" data-sea-action="letter" aria-label="展开沈望的信">${icon('boat')}</button>
        <dialog id="seaMoreDialog" class="sea-dialog sea-drawer" aria-labelledby="seaMoreTitle"><div class="sea-dialog-inner"><div class="sea-drawer-handle" aria-hidden="true"></div><button type="button" class="sea-close" data-sea-action="close" aria-label="关闭更多">${icon('close')}</button><h2 id="seaMoreTitle">更多</h2><nav class="sea-menu-primary" aria-label="常用功能">${pill('lock','锁页日记','private-journal')}${pill('settings','设置','settings')}${pill('ledger','账本','ledger')}</nav><nav class="sea-menu-secondary" aria-label="其他功能">${pill('star','收藏夹','favorites')}${pill('calendar','日历','calendar')}${pill('orbit','星渡','starcrossing')}${pill('flo','Flo','flo')}${pill('people','共创工作区','workroom')}${pill('photo','相册','album')}</nav><button type="button" class="sea-dev-link" data-sea-action="dev">开发中枢</button></div></dialog>
        <dialog id="seaLetterDialog" class="sea-dialog sea-letter" aria-labelledby="seaLetterTitle"><div class="sea-dialog-inner"><button type="button" class="sea-close" data-sea-action="close" aria-label="收起信">${icon('close')}</button><h2 id="seaLetterTitle">沈望的信</h2><p id="seaLetterSource" class="sea-letter-source"></p><article id="seaLetterText"></article></div></dialog>
        <dialog id="seaTodoDialog" class="sea-dialog sea-drawer" aria-labelledby="seaTodoTitle"><div class="sea-dialog-inner"><button type="button" class="sea-close" data-sea-action="close" aria-label="关闭待办">${icon('close')}</button><h2 id="seaTodoTitle">一起记下的事</h2><div id="seaTodoList"></div><form id="seaTodoForm"><input id="seaTodoInput" aria-label="新的待办" maxlength="500" placeholder="记下一件小事…" required><button type="submit" class="sea-pill">添加</button></form><p id="seaTodoStatus" role="status"></p></div></dialog>`;

    let data, request, refreshedAt = 0, missId, resetTimer, whisperTimer, recentTimer;
    const $ = id => document.getElementById(id);
    const isHome = () => document.documentElement.dataset.visualTheme === 'new' && $('sec-home').classList.contains('active');
    async function api(url, body, method = 'POST') {
        const response = await fetch(url, body === undefined ? { cache: 'no-store' } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const result = await response.json();
        if (!response.ok) throw Error(result.error || '同步失败，请稍后重试');
        return result;
    }
    function row(name, text, action, mark = false) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'sea-data-row'; button.dataset.seaAction = action;
        button.innerHTML = icon(name) + '<span></span>' + (mark ? '<i class="sea-shen-dot" aria-label="有沈望写的待办"></i>' : '') + icon('arrow', 'sea-row-arrow');
        button.querySelector('span').textContent = text;
        return button;
    }
    function empty(text, action) {
        const el = document.createElement('button'); el.type = 'button'; el.className = 'sea-empty'; el.dataset.seaAction = action; el.textContent = text; return el;
    }
    function render() {
        const rows = $('seaTodayRows'); rows.replaceChildren();
        $('homeV2DayCount').textContent = data.days;
        const day = new Date(data.date + 'T12:00:00+08:00');
        const weekday = day.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', weekday: 'long' });
        rows.append(row('calendar', `${day.getUTCMonth() + 1}月${day.getUTCDate()}日 · ${weekday}`, 'calendar'));
        rows.append(row('ring', `距 ${data.nextMilestone} 天纪念日 · 还有 ${data.nextMilestone - data.days} 天`, 'milestone'));
        rows.append(data.todos.length ? row('todo', `待办 · ${data.todos.length} 项`, 'todos', data.todos.some(t => t.owner === 'shen')) : empty('没什么要赶的，慢慢来。', 'todos'));
        if (data.calendarAvailable) rows.append(data.schedules.length ? row('clock', data.schedules.map(s => [s.time, s.text].filter(Boolean).join(' · ')).join(' / '), 'calendar') : empty('今天没安排，把时间留给你。', 'calendar'));
        $('seaNote').hidden = !data.letter;
        $('seaNote').textContent = data.letter ? '沈望：' + data.letter.text.replace(/\s+/g, ' ') : '';
        $('seaNote').title = data.letter ? '展开完整留言' : '';
        renderRecent();
        if ($('seaTodoDialog').open) renderTodos();
    }
    function renderRecent() {
        clearInterval(recentTimer);
        const el = $('seaRecent'); el.replaceChildren(); el.classList.remove('is-paired');
        const items = [];
        if (data.music && (data.music.playing || Date.now() - data.music.at < 3 * 86400000)) items.push(row('music', `${data.music.playing ? '正在共听' : '共听'}《${data.music.name}》`, 'music'));
        else if (data.musicAvailable) items.push(empty('很久没一起听歌了，挑一首，我陪你。', 'music'));
        if (data.diary) items.push(row('book', `日记《${data.diary.title}》 · ${String(data.diary.date || '').split('T')[0]}`, 'diary'));
        if (data.photo) items.push(row('photo', `相册 · ${data.photo.title}`, 'album'));
        let i = 0;
        if (items.length === 2 && matchMedia('(min-width: 700px)').matches) {
            el.classList.add('is-paired'); el.append(...items);
            if (el.scrollWidth <= el.clientWidth + 1) return;
            el.classList.remove('is-paired'); el.replaceChildren();
        }
        if (items.length) el.append(items[0]);
        // One row at a time: long titles never collide on small screens.
        if (items.length > 1 && isHome() && !document.hidden) recentTimer = setInterval(() => { i = (i + 1) % items.length; el.replaceChildren(items[i]); }, 6500);
    }
    async function refresh(force = false) {
        if (!isHome()) return;
        if (data) $('homeV2DayCount').textContent = data.days;
        if (request) return request;
        if (!force && Date.now() - refreshedAt < 15000) return;
        request = api('/api/home/summary').then(result => {
            if (!Array.isArray(result.todos) || !Number.isFinite(result.days)) throw Error('首页数据暂时不可用');
            data = result; refreshedAt = Date.now(); $('seaStatus').replaceChildren(); render();
        }).catch(error => {
            const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = error.message + ' · 重试';
            retry.addEventListener('click', () => refresh(true)); $('seaStatus').replaceChildren(retry);
        }).finally(() => { request = null; });
        return request;
    }
    function closeDialogs() { home.querySelectorAll('dialog[open]').forEach(d => d.close()); }
    function show(id) {
        closeDialogs(); const dialog = $(id); dialog.showModal(); document.body.classList.add('sea-modal-open');
        $('homeV2MoreToggle').setAttribute('aria-expanded', String(id === 'seaMoreDialog'));
    }
    home.querySelectorAll('dialog').forEach(dialog => {
        dialog.addEventListener('close', () => { document.body.classList.remove('sea-modal-open'); $('homeV2MoreToggle').setAttribute('aria-expanded', 'false'); });
        dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
    });
    async function openLetter(button) {
        if (!data) await refresh(true);
        if (button?.classList.contains('sea-paperboat') && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
            const boat = document.createElement('div'); boat.className = 'sea-boat-flight'; boat.innerHTML = icon('boat');
            const r = button.getBoundingClientRect(); document.body.append(boat);
            await boat.animate([{ left: r.left + 12 + 'px', top: r.top + 12 + 'px', opacity: .35, transform: 'scale(1)' }, { left: innerWidth / 2 - 10 + 'px', top: innerHeight / 2 - 10 + 'px', opacity: .7, transform: 'scale(3)' }], { duration: 420, easing: 'ease-in-out' }).finished;
            boat.remove();
        }
        $('seaLetterText').textContent = data?.letter?.text || '海上还没有新信。你可以先来通讯小屋坐一会儿。';
        $('seaLetterSource').textContent = data?.letter ? `${data.letter.source} · ${data.letter.date ? String(data.letter.date).split('T')[0] : ''}` : '';
        show('seaLetterDialog');
    }
    function renderTodos() {
        const list = $('seaTodoList'); list.replaceChildren();
        for (const todo of data?.todos || []) {
            const label = document.createElement('label'); label.className = 'sea-todo-item';
            const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.setAttribute('aria-label', '完成：' + todo.text);
            const text = document.createElement('span'); text.textContent = `${todo.owner === 'shen' ? '沈望：' : ''}${todo.text}`;
            checkbox.addEventListener('change', async () => { checkbox.disabled = true; try { await api('/api/todos/' + encodeURIComponent(todo.id), { done: true }, 'PATCH'); await refresh(true); window.neuRenderTodos?.(); } catch (error) { checkbox.checked = false; $('seaTodoStatus').textContent = error.message; } finally { checkbox.disabled = false; } });
            label.append(checkbox, text); list.append(label);
        }
        if (!list.children.length) list.textContent = '没什么要赶的，慢慢来。';
    }
    $('seaTodoForm').addEventListener('submit', async event => {
        event.preventDefault(); const input = $('seaTodoInput'), button = event.submitter, text = input.value.trim(); if (!text) return;
        button.disabled = true;
        try { await api('/api/todos', { text, owner: 'fish' }); input.value = ''; $('seaTodoStatus').textContent = ''; await refresh(true); window.neuRenderTodos?.(); }
        catch (error) { $('seaTodoStatus').textContent = error.message; } finally { button.disabled = false; }
    });
    async function miss() {
        const button = $('seaMiss'); if (button.disabled) return; button.disabled = true;
        missId ||= crypto.randomUUID();
        try {
            await api('/api/home/miss-you', { id: missId }); missId = null;
            $('seaMissLabel').textContent = '已送达'; $('seaStatus').textContent = '';
            const ripple = $('seaRipple'); ripple.classList.remove('is-rippling'); void ripple.offsetWidth; ripple.classList.add('is-rippling');
            clearTimeout(resetTimer); resetTimer = setTimeout(() => { $('seaMissLabel').textContent = '想他了'; button.disabled = false; ripple.classList.remove('is-rippling'); }, 2600);
        } catch (error) { button.disabled = false; $('seaStatus').textContent = error.message; }
    }
    const whispers = ['我在。海再远，也听得见你。','不用急，慢慢游过来。','累了就歇一会儿，我陪你。','今天也给你留着一盏灯。','想说什么，就来找我。','不说话也可以，坐一会儿。','有风的时候，记得把自己裹暖。','你的心意，我会好好收着。','海水会把声音带过来。','等你有空，我们再听一首。'];
    let whisperIndex = Math.floor(Math.random() * whispers.length);
    home.addEventListener('click', async event => {
        const button = event.target.closest('[data-sea-action]'); if (!button) return;
        const action = button.dataset.seaAction;
        if (action === 'close') { closeDialogs(); return; }
        if (action === 'more') { show('seaMoreDialog'); return; }
        if (action === 'letter') { openLetter(button); return; }
        if (action === 'whisper') {
            $('seaWhisper').textContent = whispers[whisperIndex++ % whispers.length]; $('seaWhisper').classList.add('is-visible'); button.classList.add('is-lit');
            clearTimeout(whisperTimer); whisperTimer = setTimeout(() => { $('seaWhisper').classList.remove('is-visible'); button.classList.remove('is-lit'); }, 3000); return;
        }
        if (action === 'miss') { miss(); return; }
        if (action === 'todos') { if (!data) await refresh(true); renderTodos(); show('seaTodoDialog'); return; }
        closeDialogs();
        if (action === 'music') { window.SyzygyMusic?.open(); return; }
        if (action === 'chat') { window.openCommunication(); return; }
        if (action === 'starcrossing') { window.openStarCrossing(); return; }
        if (action === 'workroom') { window.openWorkroom(); return; }
        window.goView(['milestone', 'diary'].includes(action) ? 'calendar' : action);
        if (['calendar', 'milestone', 'diary'].includes(action)) {
            await window.loadViewAssets?.('calendar');
            const date = (action === 'diary' ? data?.diary?.date : data?.date) || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
            const normalized = String(date).split('T')[0].split('-').map(v => v.padStart(2,'0')).join('-');
            const target = new Date(normalized + 'T12:00:00+08:00');
            if (action === 'milestone') target.setDate(target.getDate() + data.nextMilestone - data.days);
            // Calendar owns its display; only navigate after its lazy script has loaded.
            if (typeof calYear !== 'undefined') { calYear = target.getFullYear(); calMonth = target.getMonth() + 1; calRender(); }
        }
    });
    function sync() {
        const active = isHome(); home.classList.toggle('sea-active', active);
        document.getElementById('syzygy-music')?.toggleAttribute('home-minimal', active);
        if (!active) { closeDialogs(); clearInterval(recentTimer); } else { refresh(); if (data) renderRecent(); }
    }
    new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['data-visual-theme'] });
    new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['data-view'] });
    document.addEventListener('visibilitychange', () => { clearInterval(recentTimer); if (!document.hidden) { refresh(true); if (data) renderRecent(); } });
    window.addEventListener('focus', () => refresh());
    let resizeTimer;
    window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (data && isHome()) renderRecent(); }, 150); });
    document.fonts.ready.then(() => { if (data && isHome()) renderRecent(); });
    document.fonts.addEventListener('loadingdone', () => { if (data && isHome()) renderRecent(); });
    window.SeaHome = { refresh, sync, close: closeDialogs };
    document.addEventListener('DOMContentLoaded', sync);
})();
