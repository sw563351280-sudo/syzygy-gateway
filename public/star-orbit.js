(() => {
    'use strict';

    const home = document.getElementById('homeV2');
    if (!home) return;
    const icons = ['💊', '💧', '🍳', '🌙', '🧴', '🚶', '🫧', '🧘', '📖', '☀️', '🌿', '✨'];
    const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
    const weekdayValues = [1, 2, 3, 4, 5, 6, 0];
    const todayKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
    const dateAt = value => new Date(`${value}T12:00:00Z`);
    const dateKey = date => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    const addDays = (value, amount) => { const date = dateAt(value); date.setUTCDate(date.getUTCDate() + amount); return dateKey(date); };
    const monthRange = value => {
        const date = dateAt(value), first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
        const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
        return { first: dateKey(first), last: dateKey(last) };
    };

    const dialog = document.createElement('dialog');
    dialog.id = 'starOrbitDialog';
    dialog.className = 'sea-dialog sea-drawer orbit-drawer';
    dialog.setAttribute('aria-labelledby', 'orbitTitle');
    dialog.innerHTML = `
      <div class="sea-dialog-inner orbit-shell">
        <div class="sea-drawer-handle" aria-hidden="true"></div>
        <button class="sea-close orbit-close" type="button" aria-label="关闭星轨">×</button>
        <header class="orbit-head"><div><p>STELLAR RHYTHM</p><h2 id="orbitTitle">星轨</h2></div><button id="orbitNewTask" class="orbit-head-add" type="button" aria-label="新建任务">＋</button></header>
        <nav class="orbit-tabs" role="tablist" aria-label="星轨视图">
          <button type="button" role="tab" data-orbit-tab="month" aria-selected="true">月</button>
          <button type="button" role="tab" data-orbit-tab="year" aria-selected="false">年</button>
          <button type="button" role="tab" data-orbit-tab="tasks" aria-selected="false">我的任务</button>
        </nav>
        <p id="orbitStatus" class="orbit-status" role="status"></p>
        <section id="orbitMonthPanel" class="orbit-panel"></section>
        <section id="orbitYearPanel" class="orbit-panel" hidden></section>
        <section id="orbitTasksPanel" class="orbit-panel" hidden></section>
        <section id="orbitCreatePanel" class="orbit-create" hidden aria-labelledby="orbitCreateTitle">
          <div class="orbit-create-head"><button type="button" id="orbitCreateBack">‹</button><h3 id="orbitCreateTitle">新建一颗星</h3><span></span></div>
          <form id="orbitCreateForm">
            <label class="orbit-field orbit-name-field"><span>名字</span><div><button id="orbitIconButton" type="button" aria-label="选择图标">💊</button><input id="orbitTaskName" maxlength="40" placeholder="比如：吃药" required></div></label>
            <div id="orbitIconPicker" class="orbit-icon-picker" hidden>${icons.map(icon => `<button type="button" data-icon="${icon}">${icon}</button>`).join('')}</div>
            <fieldset><legend>记录方式</legend><div class="orbit-choice-cards">
              <label><input type="radio" name="orbitMode" value="check" checked><span><b>✓</b>一键打勾</span></label>
              <label><input type="radio" name="orbitMode" value="count"><span><b>💧</b>计数</span></label>
              <label><input type="radio" name="orbitMode" value="split"><span><b>💊</b>分次</span></label>
            </div></fieldset>
            <label id="orbitTargetField" class="orbit-field" hidden><span>目标数量</span><input id="orbitTarget" type="number" min="1" max="999" value="8" inputmode="numeric"></label>
            <label id="orbitDosesField" class="orbit-field" hidden><span>剂次，用顿号隔开</span><input id="orbitDoses" maxlength="80" value="早、晚"></label>
            <fieldset><legend>什么时候做</legend><div class="orbit-schedule-tabs">
              <label><input type="radio" name="orbitSchedule" value="daily" checked><span>每天</span></label>
              <label><input type="radio" name="orbitSchedule" value="range"><span>一段时间</span></label>
              <label><input type="radio" name="orbitSchedule" value="custom"><span>自定义</span></label>
            </div></fieldset>
            <div id="orbitRangeFields" class="orbit-date-fields" hidden><label>从<input id="orbitStartDate" type="date"></label><label>到<input id="orbitEndDate" type="date"></label></div>
            <div id="orbitCustomFields" class="orbit-custom-fields" hidden>
              <div class="orbit-custom-kind"><label><input type="radio" name="orbitCustomKind" value="weekdays" checked>星期几</label><label><input type="radio" name="orbitCustomKind" value="interval">每隔 N 天</label></div>
              <div id="orbitWeekdays" class="orbit-weekdays">${weekdays.map((day, i) => `<label><input type="checkbox" value="${weekdayValues[i]}"><span>${day}</span></label>`).join('')}</div>
              <label id="orbitIntervalField" class="orbit-interval" hidden>每隔 <input id="orbitEvery" type="number" min="1" max="365" value="2" inputmode="numeric"> 天</label>
            </div>
            <button class="orbit-submit" type="submit">好了</button><p id="orbitCreateStatus" class="orbit-status" role="status"></p>
          </form>
        </section>
      </div>`;
    home.append(dialog);

    const $ = id => document.getElementById(id);
    let data = null, selectedDate = todayKey(), activeTab = 'month', loading = null;

    async function api(url, body, method = 'GET') {
        const options = body === undefined ? { cache: 'no-store' } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
        const response = await fetch(url, options), result = await response.json();
        if (!response.ok) throw Error(result.error || '星轨暂时没有同步好');
        return result;
    }
    function recordFor(date, id) { return data?.records?.[date]?.[id] || {}; }
    function activeTasks(date) {
        return (data?.tasks || []).filter(task => {
            if (date < task.schedule.startDate) return false;
            if (task.endedAt && date > (task.endedDate || String(task.endedAt).slice(0, 10))) return false;
            if (task.schedule.kind === 'range') return date <= task.schedule.endDate;
            if (task.schedule.kind === 'daily') return true;
            if (task.schedule.customType === 'interval') {
                return Math.round((dateAt(date) - dateAt(task.schedule.startDate)) / 86400000) % task.schedule.every === 0;
            }
            return task.schedule.weekdays.includes(dateAt(date).getUTCDay());
        });
    }
    function progress(task, record) {
        if (record.skipped) return { ratio: 0, done: false, skipped: true };
        if (task.mode === 'check') return { ratio: record.value ? 1 : 0, done: Boolean(record.value) };
        if (task.mode === 'count') { const value = Number(record.value) || 0; return { ratio: Math.min(1, value / task.target), done: value >= task.target }; }
        const count = task.doses.filter(dose => record.doses?.[dose.id]?.done).length;
        return { ratio: count / task.doses.length, done: count === task.doses.length };
    }
    function dayInfo(date) { return data?.days?.find(item => item.date === date) || { date, scheduled: 0, completed: 0, ratio: 0, state: 'empty' }; }
    function ratioClass(day) {
        if (day.state === 'complete') return 'is-complete';
        if (day.state === 'skipped') return 'is-skipped';
        if (!day.scheduled) return 'is-empty';
        if (day.ratio === 0) return 'is-planned';
        if (day.ratio <= .33) return 'is-low';
        if (day.ratio <= .66) return 'is-mid';
        return 'is-high';
    }
    function dateTitle(value) {
        const date = dateAt(value), weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'long', timeZone: 'UTC' }).format(date);
        return `${date.getUTCMonth() + 1}月${date.getUTCDate()}日 · ${weekday}`;
    }

    async function load(force = false) {
        if (loading) return loading;
        const year = dateAt(selectedDate).getUTCFullYear();
        if (!force && data?.days?.[0]?.date.startsWith(String(year))) return data;
        $('orbitStatus').textContent = '正在把星星排好…';
        loading = api(`/api/star-orbit?from=${year}-01-01&to=${year}-12-31`).then(result => {
            data = result; $('orbitStatus').textContent = ''; render(); return result;
        }).catch(error => { $('orbitStatus').textContent = error.message; throw error; }).finally(() => { loading = null; });
        return loading;
    }

    function renderMonth() {
        const panel = $('orbitMonthPanel'), { first, last } = monthRange(selectedDate), firstDate = dateAt(first);
        const leading = (firstDate.getUTCDay() + 6) % 7, previous = addDays(first, -1), next = addDays(last, 1);
        const lit = data.days.filter(day => day.date >= first && day.date <= last && day.state === 'complete').length;
        const cells = [];
        for (let i = 0; i < leading; i++) cells.push('<span class="orbit-day-spacer"></span>');
        for (let date = first; date <= last; date = addDays(date, 1)) {
            const day = dayInfo(date), label = Number(date.slice(-2));
            cells.push(`<button type="button" class="orbit-day ${ratioClass(day)}${date === selectedDate ? ' is-selected' : ''}${date === data.today ? ' is-today' : ''}" data-date="${date}" aria-label="${dateTitle(date)}"><span>${label}</span></button>`);
        }
        const current = dateAt(first);
        panel.innerHTML = `<div class="orbit-month-nav"><button type="button" data-month="${previous}">‹</button><strong>${current.getUTCFullYear()}年 ${current.getUTCMonth() + 1}月</strong><button type="button" data-month="${next}">›</button></div>
          <div class="orbit-week-head">${weekdays.map(day => `<span>${day}</span>`).join('')}</div>
          <div class="orbit-month-grid">${cells.join('')}</div>
          <div class="orbit-legend"><span>○ 无安排</span><span><i></i><i></i><i></i> 渐亮</span><span>★ 全部完成</span></div>
          <p class="orbit-lit-count">本月点亮 <strong>${lit}</strong> 颗金星</p>
          <div id="orbitDayDetail"></div>`;
        renderDayDetail();
    }

    function taskControls(task, date) {
        const record = recordFor(date, task.id), state = progress(task, record);
        if (task.mode === 'check') return `<button type="button" class="orbit-check${state.done ? ' is-done' : ''}" data-record="check" data-task="${task.id}" aria-label="${state.done ? '撤回' : '完成'}${esc(task.name)}">${state.done ? '★' : ''}</button>`;
        if (task.mode === 'count' && task.target <= 10) {
            const value = Number(record.value) || 0;
            return `<div class="orbit-drops" aria-label="${esc(task.name)} ${value}/${task.target}">${Array.from({ length: task.target }, (_, i) => `<button type="button" data-record="count" data-task="${task.id}" data-value="${i + 1}" class="${i < value ? 'is-full' : ''}" aria-label="记录到 ${i + 1}">${esc(task.icon)}</button>`).join('')}<small>${value}/${task.target}</small></div>`;
        }
        if (task.mode === 'count') {
            const value = Number(record.value) || 0;
            return `<div class="orbit-stepper"><span>${value}/${task.target}</span><button type="button" data-record="step" data-task="${task.id}" data-value="${Math.max(0, value - 1)}">−</button><button type="button" data-record="step" data-task="${task.id}" data-value="${value + 1}">＋</button></div>`;
        }
        return `<div class="orbit-doses">${task.doses.map(dose => { const doseRecord = record.doses?.[dose.id]; return `<span class="orbit-dose-wrap"><button type="button" class="orbit-dose${doseRecord?.done ? ' is-done' : ''}" data-record="dose" data-task="${task.id}" data-dose="${dose.id}">${esc(dose.name)}${doseRecord?.time ? ` <small>${esc(doseRecord.time)}</small>` : ''}</button><span class="orbit-dose-menu" hidden><button type="button" data-dose-action="time" data-task="${task.id}" data-dose="${dose.id}">更正时间</button><button type="button" data-dose-action="undo" data-task="${task.id}" data-dose="${dose.id}">撤回记录</button></span></span>`; }).join('')}</div>`;
    }

    function renderDayDetail() {
        const container = $('orbitDayDetail'); if (!container) return;
        const tasks = activeTasks(selectedDate), day = dayInfo(selectedDate);
        const rows = tasks.map(task => {
            const record = recordFor(selectedDate, task.id);
            return `<article class="orbit-task-row${record.skipped ? ' is-skipped' : ''}" data-swipe-row>
              <button class="orbit-skip" type="button" data-skip="${task.id}">${record.skipped ? '算回来' : '放下'}</button>
              <div class="orbit-task-main"><span class="orbit-task-icon">${esc(task.icon)}</span><div class="orbit-task-copy"><strong>${esc(task.name)}</strong>${record.skipped ? '<small>今天的这一项放下了</small>' : ''}</div>${taskControls(task, selectedDate)}<button type="button" class="orbit-row-more" data-reveal aria-label="更多操作">···</button></div>
            </article>`;
        }).join('');
        container.innerHTML = `<section class="orbit-day-detail"><header><div><h3>${dateTitle(selectedDate)}</h3><p>${day.state === 'complete' ? '★ 今天的都照顾好了' : day.state === 'skipped' ? '今天的安排都放下了' : tasks.length ? `${day.completed}/${day.scheduled} 已照顾` : '今天没有安排'}</p></div></header>${rows || '<p class="orbit-no-tasks">这一天没有安排。</p>'}</section>`;
        bindSwipes(container);
    }

    function renderYear() {
        const panel = $('orbitYearPanel'), year = dateAt(selectedDate).getUTCFullYear(), first = `${year}-01-01`, last = `${year}-12-31`;
        const offset = (dateAt(first).getUTCDay() + 6) % 7;
        const months = Array.from({ length: 12 }, (_, month) => {
            const dayIndex = Math.round((new Date(Date.UTC(year, month, 1)) - dateAt(first)) / 86400000);
            const week = Math.floor((offset + dayIndex) / 7);
            return `<span style="left:${week * 13}px">${month + 1}月</span>`;
        }).join('');
        const cells = [];
        for (let date = first; date <= last; date = addDays(date, 1)) {
            const parsed = dateAt(date), dayIndex = Math.round((parsed - dateAt(first)) / 86400000), week = Math.floor((offset + dayIndex) / 7) + 1;
            const row = (parsed.getUTCDay() + 6) % 7 + 1;
            cells.push(`<button type="button" class="orbit-year-day ${ratioClass(dayInfo(date))}${date === data.today ? ' is-today' : ''}" style="grid-column:${week + 1};grid-row:${row}" data-date="${date}" aria-label="${dateTitle(date)}"></button>`);
        }
        panel.innerHTML = `<div class="orbit-year-title">${year} · 一整年的光</div><div class="orbit-year-scroll" id="orbitYearScroll"><div class="orbit-year-months">${months}</div><div class="orbit-year-grid">${cells.join('')}</div></div><div class="orbit-legend"><span>○ 无安排</span><span><i></i><i></i><i></i> 渐亮</span><span>★ 全部完成</span></div>`;
        requestAnimationFrame(() => {
            const current = panel.querySelector(`[data-date="${data.today}"]`);
            current?.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' });
        });
    }

    function scheduleText(task) {
        if (task.schedule.kind === 'daily') return '每天';
        if (task.schedule.kind === 'range') return task.ended ? '已结束' : `还剩 ${task.remainingDays} 天`;
        if (task.schedule.customType === 'interval') return `每隔 ${task.schedule.every} 天`;
        return `每周 ${task.schedule.weekdays.map(value => '日一二三四五六'[value]).join('、')}`;
    }
    function renderTasks() {
        const groups = { '日常': [], '阶段': [], '自定义': [], '已结束的': [] };
        for (const task of data.tasks) {
            const group = task.ended ? '已结束的' : task.schedule.kind === 'daily' ? '日常' : task.schedule.kind === 'range' ? '阶段' : '自定义';
            groups[group].push(task);
        }
        $('orbitTasksPanel').innerHTML = Object.entries(groups).map(([name, tasks]) => {
            const content = tasks.length ? tasks.map(task => `<article class="orbit-managed-task"><span>${esc(task.icon)}</span><div><strong>${esc(task.name)}</strong><small>${esc(scheduleText(task))}</small></div>${task.ended ? '' : `<button type="button" data-end-task="${task.id}">结束</button>`}</article>`).join('') : '<p class="orbit-group-empty">还没有</p>';
            return name === '已结束的' ? `<details class="orbit-task-group"><summary>${name} <small>${tasks.length}</small></summary>${content}</details>` : `<section class="orbit-task-group"><h3>${name}</h3>${content}</section>`;
        }).join('') + '<button type="button" class="orbit-fab" data-new-task aria-label="新建任务">＋</button>';
    }
    function render() { renderMonth(); renderYear(); renderTasks(); setTab(activeTab); }

    function setTab(tab) {
        activeTab = tab;
        dialog.querySelectorAll('[data-orbit-tab]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.orbitTab === tab)));
        $('orbitMonthPanel').hidden = tab !== 'month'; $('orbitYearPanel').hidden = tab !== 'year'; $('orbitTasksPanel').hidden = tab !== 'tasks';
        $('orbitCreatePanel').hidden = true; $('orbitNewTask').hidden = false;
        if (tab === 'year') requestAnimationFrame(() => {
            const scroll = $('orbitYearScroll'), current = scroll?.querySelector(`[data-date="${data?.today}"]`);
            if (scroll && current) scroll.scrollLeft = Math.max(0, current.offsetLeft - scroll.clientWidth / 2);
        });
    }
    function showCreate() {
        $('orbitMonthPanel').hidden = $('orbitYearPanel').hidden = $('orbitTasksPanel').hidden = true;
        $('orbitCreatePanel').hidden = false; $('orbitNewTask').hidden = true; $('orbitTaskName').focus({ preventScroll: true });
    }
    function updateCreateFields() {
        const mode = dialog.querySelector('[name="orbitMode"]:checked').value, schedule = dialog.querySelector('[name="orbitSchedule"]:checked').value, custom = dialog.querySelector('[name="orbitCustomKind"]:checked').value;
        $('orbitTargetField').hidden = mode !== 'count'; $('orbitDosesField').hidden = mode !== 'split'; $('orbitRangeFields').hidden = schedule !== 'range'; $('orbitCustomFields').hidden = schedule !== 'custom';
        $('orbitWeekdays').hidden = custom !== 'weekdays'; $('orbitIntervalField').hidden = custom !== 'interval';
    }
    function bindSwipes(container) {
        container.querySelectorAll('[data-swipe-row]').forEach(row => {
            let start = null;
            row.addEventListener('pointerdown', event => { if (event.target.closest('button')) return; start = event.clientX; });
            row.addEventListener('pointerup', event => { if (start === null) return; const distance = event.clientX - start; if (distance < -28) row.classList.add('is-revealed'); if (distance > 28) row.classList.remove('is-revealed'); start = null; });
        });
    }
    async function patchRecord(taskId, body) {
        $('orbitStatus').textContent = '正在记下…';
        try { await api(`/api/star-orbit/days/${selectedDate}/tasks/${encodeURIComponent(taskId)}`, body, 'PATCH'); await load(true); window.SeaHome?.refresh(true); }
        catch (error) { $('orbitStatus').textContent = error.message; }
    }

    dialog.addEventListener('click', async event => {
        const target = event.target.closest('button'); if (!target) return;
        if (target.classList.contains('orbit-close')) { dialog.close(); return; }
        if (target.dataset.orbitTab) { setTab(target.dataset.orbitTab); return; }
        if (target.id === 'orbitNewTask' || target.hasAttribute('data-new-task')) { showCreate(); return; }
        if (target.id === 'orbitCreateBack') { setTab(activeTab); return; }
        if (target.id === 'orbitIconButton') { $('orbitIconPicker').hidden = !$('orbitIconPicker').hidden; return; }
        if (target.dataset.icon) { $('orbitIconButton').textContent = target.dataset.icon; $('orbitIconPicker').hidden = true; return; }
        if (target.dataset.month) { selectedDate = target.dataset.month; await load(); renderMonth(); return; }
        if (target.dataset.date) { selectedDate = target.dataset.date; if (activeTab === 'year') setTab('month'); renderMonth(); return; }
        if (target.hasAttribute('data-reveal')) { target.closest('[data-swipe-row]').classList.toggle('is-revealed'); return; }
        if (target.dataset.skip) {
            const record = recordFor(selectedDate, target.dataset.skip), next = !record.skipped;
            if (next && !window.confirm('这项今天不算？')) return;
            await patchRecord(target.dataset.skip, { skipped: next }); return;
        }
        if (target.dataset.record === 'check') { const record = recordFor(selectedDate, target.dataset.task); await patchRecord(target.dataset.task, { value: !record.value }); return; }
        if (target.dataset.record === 'count') {
            const record = recordFor(selectedDate, target.dataset.task), clicked = Number(target.dataset.value), current = Number(record.value) || 0;
            await patchRecord(target.dataset.task, { value: clicked === current ? Math.max(0, current - 1) : clicked }); return;
        }
        if (target.dataset.record === 'step') { await patchRecord(target.dataset.task, { value: Number(target.dataset.value) }); return; }
        if (target.dataset.record === 'dose') {
            const done = Boolean(recordFor(selectedDate, target.dataset.task).doses?.[target.dataset.dose]?.done);
            if (done) { const menu = target.nextElementSibling; dialog.querySelectorAll('.orbit-dose-menu').forEach(item => { if (item !== menu) item.hidden = true; }); menu.hidden = !menu.hidden; }
            else await patchRecord(target.dataset.task, { doseId: target.dataset.dose, done: true });
            return;
        }
        if (target.dataset.doseAction === 'undo') { await patchRecord(target.dataset.task, { doseId: target.dataset.dose, done: false }); return; }
        if (target.dataset.doseAction === 'time') {
            const value = window.prompt('服用时间（例如 08:12）', recordFor(selectedDate, target.dataset.task).doses?.[target.dataset.dose]?.time || '');
            if (value !== null) await patchRecord(target.dataset.task, { doseId: target.dataset.dose, done: true, time: value }); return;
        }
        if (target.dataset.endTask) {
            if (!window.confirm('让这项任务在这里结束吗？过去点亮的星星会保留。')) return;
            try { await api(`/api/star-orbit/tasks/${encodeURIComponent(target.dataset.endTask)}`, { ended: true }, 'PATCH'); await load(true); window.SeaHome?.refresh(true); }
            catch (error) { $('orbitStatus').textContent = error.message; }
        }
    });
    dialog.addEventListener('change', event => { if (event.target.matches('[name="orbitMode"],[name="orbitSchedule"],[name="orbitCustomKind"]')) updateCreateFields(); });
    dialog.addEventListener('close', () => { document.body.classList.remove('sea-modal-open'); });
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    $('orbitCreateForm').addEventListener('submit', async event => {
        event.preventDefault(); const form = event.currentTarget, submit = event.submitter, scheduleKind = form.querySelector('[name="orbitSchedule"]:checked').value, customType = form.querySelector('[name="orbitCustomKind"]:checked').value;
        const start = $('orbitStartDate').value || todayKey();
        const body = { name: $('orbitTaskName').value, icon: $('orbitIconButton').textContent, mode: form.querySelector('[name="orbitMode"]:checked').value, target: Number($('orbitTarget').value), doses: $('orbitDoses').value.split(/[、,，]/).map(value => value.trim()).filter(Boolean), schedule: { kind: scheduleKind, startDate: start, endDate: $('orbitEndDate').value, customType, every: Number($('orbitEvery').value), weekdays: [...$('orbitWeekdays').querySelectorAll('input:checked')].map(input => Number(input.value)) } };
        submit.disabled = true; $('orbitCreateStatus').textContent = '正在放进星轨…';
        try { await api('/api/star-orbit/tasks', body, 'POST'); form.reset(); $('orbitIconButton').textContent = '💊'; setDefaultDates(); updateCreateFields(); $('orbitCreateStatus').textContent = ''; await load(true); activeTab = 'tasks'; render(); window.SeaHome?.refresh(true); }
        catch (error) { $('orbitCreateStatus').textContent = error.message; }
        finally { submit.disabled = false; }
    });
    function setDefaultDates() { $('orbitStartDate').value = todayKey(); $('orbitEndDate').value = addDays(todayKey(), 4); }
    setDefaultDates(); updateCreateFields();

    async function open() {
        if (!dialog.open) dialog.showModal(); document.body.classList.add('sea-modal-open');
        selectedDate = todayKey(); activeTab = 'month'; await load(true);
    }
    window.StarOrbit = { open, refresh: () => load(true) };
})();
