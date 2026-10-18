(() => {
    'use strict';

    const home = document.getElementById('homeV2');
    if (!home) return;
    const icons = ['💊', '💧', '🍳', '🌙', '🧴', '🚶', '🫧', '🧘', '📖', '☀️', '🌿', '✨'];
    const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
    const weekdayValues = [1, 2, 3, 4, 5, 6, 0];
    const esc = value => String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
    const todayKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const dateAt = value => new Date(`${value}T12:00:00Z`);
    const dateKey = date => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    const normalizeDate = value => {
        const match = String(value || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
        return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : '';
    };
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
        <header class="orbit-head"><div><p>STELLAR RHYTHM</p><h2 id="orbitTitle">星轨</h2></div><button id="orbitNewTask" class="orbit-head-add" type="button" aria-label="新建任务" hidden>＋</button></header>
        <nav class="orbit-tabs" role="tablist" aria-label="星轨内容">
          <button type="button" role="tab" data-orbit-section="heart" aria-selected="true">心迹</button>
          <button type="button" role="tab" data-orbit-section="daily" aria-selected="false">日常</button>
          <button type="button" role="tab" data-orbit-section="tasks" aria-selected="false">我的任务</button>
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
              <div id="orbitWeekdays" class="orbit-weekdays">${weekdays.map((day, index) => `<label><input type="checkbox" value="${weekdayValues[index]}"><span>${day}</span></label>`).join('')}</div>
              <label id="orbitIntervalField" class="orbit-interval" hidden>每隔 <input id="orbitEvery" type="number" min="1" max="365" value="2" inputmode="numeric"> 天</label>
            </div>
            <button class="orbit-submit" type="submit">好了</button><p id="orbitCreateStatus" class="orbit-status" role="status"></p>
          </form>
        </section>
      </div>`;
    home.append(dialog);

    const $ = id => document.getElementById(id);
    let taskData = null;
    let selectedDate = todayKey();
    let activeSection = 'heart';
    let activeRange = 'month';
    let taskLoading = null;
    let diaryEntries = null;
    const heatYears = new Map();
    const calendarMonths = new Map();

    async function api(url, body, method = 'GET') {
        const options = body === undefined ? { cache: 'no-store' } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
        const response = await fetch(url, options);
        const result = await response.json();
        if (!response.ok) throw Error(result.error || '星轨暂时没有同步好');
        return result;
    }
    function yearOf(value = selectedDate) { return dateAt(value).getUTCFullYear(); }
    function monthKey(value = selectedDate) { return value.slice(0, 7); }
    function recordFor(date, id) { return taskData?.records?.[date]?.[id] || {}; }
    function activeTasks(date) {
        return (taskData?.tasks || []).filter(task => {
            if (date < task.schedule.startDate) return false;
            if (task.endedAt && date > (task.endedDate || String(task.endedAt).slice(0, 10))) return false;
            if (task.schedule.kind === 'range') return date <= task.schedule.endDate;
            if (task.schedule.kind === 'daily') return true;
            if (task.schedule.customType === 'interval') return Math.round((dateAt(date) - dateAt(task.schedule.startDate)) / 86400000) % task.schedule.every === 0;
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
    function dayInfo(date) { return taskData?.days?.find(item => item.date === date) || { date, scheduled: 0, completed: 0, ratio: 0, state: 'empty' }; }
    function ratioClass(day) {
        if (day.state === 'complete') return 'is-complete';
        if (day.state === 'skipped') return 'is-skipped';
        if (!day.scheduled) return 'is-empty';
        if (day.ratio === 0) return 'is-planned';
        if (day.ratio <= .33) return 'is-low';
        if (day.ratio <= .66) return 'is-mid';
        return 'is-high';
    }
    function heatDay(date) { return heatYears.get(yearOf(date))?.days?.find(item => item.date === date) || { date, level: 0, score: 0, rounds: 0, userCharacters: 0, messages: 0 }; }
    function heatClass(day) { return day.level ? `is-heat-${day.level}` : 'is-empty'; }
    function dateTitle(value) {
        const date = dateAt(value), weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'long', timeZone: 'UTC' }).format(date);
        return `${date.getUTCMonth() + 1}月${date.getUTCDate()}日 · ${weekday}`;
    }
    function monthPages() {
        const rows = calendarMonths.get(monthKey()) || [];
        return new Map(rows.filter(page => page?.date).map(page => [normalizeDate(page.date), page]));
    }
    function diaryGroups(date) {
        const rows = (diaryEntries || []).filter(entry => normalizeDate(entry.date || entry.day || entry.dateStr || entry.datetime) === date);
        return {
            snapshots: rows.filter(entry => entry.type === 'mood_snapshot' || String(entry.text || '').includes('【心情快照')),
            flows: rows.filter(entry => entry.type === 'daily_flow' || String(entry.text || '').includes('【今日流水】'))
        };
    }
    function hasDiaryMark(date) {
        const groups = diaryGroups(date);
        return { mood: groups.snapshots.length > 0, flow: groups.flows.length > 0 };
    }

    async function loadTasks(force = false) {
        if (taskLoading) return taskLoading;
        const year = yearOf();
        if (!force && taskData?.days?.[0]?.date.startsWith(String(year))) return taskData;
        $('orbitStatus').textContent = '正在把星星排好…';
        taskLoading = api(`/api/star-orbit?from=${year}-01-01&to=${year}-12-31`).then(result => {
            taskData = result; $('orbitStatus').textContent = ''; return result;
        }).catch(error => { $('orbitStatus').textContent = error.message; throw error; }).finally(() => { taskLoading = null; });
        return taskLoading;
    }
    async function loadHeart(force = false) {
        const year = yearOf(), month = monthKey();
        $('orbitStatus').textContent = '正在捞起这段心迹…';
        try {
            const jobs = [];
            if (force || !heatYears.has(year)) jobs.push(api(`/api/heart-trail?year=${year}`).then(result => heatYears.set(year, result)));
            if (force || !calendarMonths.has(month)) jobs.push(api(`/api/calendar?month=${month}`).then(result => calendarMonths.set(month, result.success ? result.data || [] : [])));
            if (force || !diaryEntries) jobs.push(api('/diary-logs').then(result => { diaryEntries = Array.isArray(result) ? result : (result.entries || result.data || result.logs || []); }));
            await Promise.all(jobs);
            $('orbitStatus').textContent = '';
        } catch (error) {
            $('orbitStatus').textContent = error.message;
            throw error;
        }
    }
    async function ensureActiveData(force = false) {
        if (activeSection === 'heart') return loadHeart(force);
        return loadTasks(force);
    }

    function rangeToggle() {
        return `<span class="orbit-range-tabs" role="tablist" aria-label="查看范围"><button type="button" data-orbit-range="month" aria-selected="${activeRange === 'month'}">月</button><button type="button" data-orbit-range="year" aria-selected="${activeRange === 'year'}">年</button></span>`;
    }
    function periodNav(label, previous, next, kind) {
        return `<div class="orbit-period-nav"><button type="button" data-${kind}="${previous}" aria-label="上一${kind === 'month' ? '月' : '年'}">‹</button><strong>${label}</strong>${rangeToggle()}<button type="button" data-${kind}="${next}" aria-label="下一${kind === 'month' ? '月' : '年'}">›</button></div>`;
    }

    function renderHeartMonth() {
        const panel = $('orbitMonthPanel'), { first, last } = monthRange(selectedDate), firstDate = dateAt(first);
        const leading = (firstDate.getUTCDay() + 6) % 7, previous = addDays(first, -1), next = addDays(last, 1);
        const pages = monthPages(), cells = [];
        for (let index = 0; index < leading; index++) cells.push('<span class="orbit-day-spacer"></span>');
        for (let date = first; date <= last; date = addDays(date, 1)) {
            const heat = heatDay(date), page = pages.get(date), marks = hasDiaryMark(date), labels = [];
            if (page?.shenwang_note) labels.push('<i class="orbit-note-dot" title="有沈望手记"></i>');
            if (marks.mood) labels.push('<i class="orbit-mood-dot" title="有心情快照"></i>');
            if (marks.flow) labels.push('<i class="orbit-flow-dot" title="有今日流水"></i>');
            if (page?.period_flag) labels.push('<i class="orbit-period-dot" title="生理期"></i>');
            cells.push(`<button type="button" class="orbit-day orbit-heart-day ${heatClass(heat)}${date === selectedDate ? ' is-selected' : ''}${date === todayKey() ? ' is-today' : ''}" data-date="${date}" aria-label="${dateTitle(date)}，聊天热度 ${heat.level} 档"><span>${Number(date.slice(-2))}</span><span class="orbit-day-marks">${labels.join('')}</span></button>`);
        }
        const current = dateAt(first);
        panel.innerHTML = `${periodNav(`${current.getUTCFullYear()}年 ${current.getUTCMonth() + 1}月`, previous, next, 'month')}
          <div class="orbit-week-head">${weekdays.map(day => `<span>${day}</span>`).join('')}</div>
          <div class="orbit-month-grid">${cells.join('')}</div>
          <div class="orbit-legend orbit-heart-legend"><span>○ 安静</span><span><i></i><i></i><i></i> 聊天渐亮</span></div>
          <div id="orbitHeartDetail"></div>`;
        renderHeartDetail();
    }

    function formatDiaryTime(value) {
        if (!value) return '';
        try { return new Date(value).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }); }
        catch (_) { return ''; }
    }
    function renderHeartDetail() {
        const container = $('orbitHeartDetail'); if (!container) return;
        const heat = heatDay(selectedDate), page = monthPages().get(selectedDate), { snapshots, flows } = diaryGroups(selectedDate);
        let sections = '';
        if (snapshots.length) {
            sections += '<h4>心情快照</h4>' + snapshots.map(entry => `<article class="orbit-heart-entry"><time>${esc(formatDiaryTime(entry.datetime))}</time><p>${esc(entry.text || '').replace(/\n/g, '<br>')}</p></article>`).join('');
        }
        if (flows.length) {
            sections += '<h4>今日流水</h4>' + flows.map(entry => `<article class="orbit-heart-entry"><time>${esc(formatDiaryTime(entry.datetime))}</time><p>${esc(String(entry.text || '').replace(/^【今日流水】\n?/, '')).replace(/\n/g, '<br>')}</p></article>`).join('');
        }
        if (page && (page.mood || page.shenwang_note || page.shenwang_comment || page.period_flag)) {
            sections += '<h4>日历记录</h4>';
            if (page.mood) sections += `<div class="orbit-heart-line"><span>心情</span><p>${esc(page.mood)}</p></div>`;
            if (page.period_flag) sections += '<div class="orbit-heart-line"><span>生理期</span><p>是</p></div>';
            if (page.shenwang_note) sections += `<div class="orbit-heart-line"><span>沈望手记</span><p>${esc(page.shenwang_note).replace(/\n/g, '<br>')}</p></div>`;
            if (page.shenwang_comment) sections += `<div class="orbit-heart-line"><span>沈望点评</span><p>${esc(page.shenwang_comment).replace(/\n/g, '<br>')}</p></div>`;
        }
        const summary = heat.rounds || heat.userCharacters ? `聊了 ${heat.rounds} 轮 · 你留下 ${heat.userCharacters} 字` : '这一天的聊天很安静';
        container.innerHTML = `<section class="orbit-heart-detail"><header><div><h3>${dateTitle(selectedDate)}</h3><p>${summary}</p></div><div><button type="button" data-heart-state>状态</button><button type="button" data-heart-snapshot>＋快照</button></div></header>${sections || '<p class="orbit-heart-empty">这一天还没有留下记录。</p>'}</section>`;
    }

    function renderDailyMonth() {
        const panel = $('orbitMonthPanel'), { first, last } = monthRange(selectedDate), firstDate = dateAt(first);
        const leading = (firstDate.getUTCDay() + 6) % 7, previous = addDays(first, -1), next = addDays(last, 1);
        const lit = taskData.days.filter(day => day.date >= first && day.date <= last && day.state === 'complete').length;
        const cells = [];
        for (let index = 0; index < leading; index++) cells.push('<span class="orbit-day-spacer"></span>');
        for (let date = first; date <= last; date = addDays(date, 1)) {
            const day = dayInfo(date);
            cells.push(`<button type="button" class="orbit-day ${ratioClass(day)}${date === selectedDate ? ' is-selected' : ''}${date === taskData.today ? ' is-today' : ''}" data-date="${date}" aria-label="${dateTitle(date)}"><span>${Number(date.slice(-2))}</span></button>`);
        }
        const current = dateAt(first);
        panel.innerHTML = `${periodNav(`${current.getUTCFullYear()}年 ${current.getUTCMonth() + 1}月`, previous, next, 'month')}
          <div class="orbit-week-head">${weekdays.map(day => `<span>${day}</span>`).join('')}</div>
          <div class="orbit-month-grid">${cells.join('')}</div>
          <div class="orbit-legend"><span>○ 无安排</span><span><i></i><i></i><i></i> 渐亮</span><span>★ 全部完成</span></div>
          <p class="orbit-lit-count">本月点亮 <strong>${lit}</strong> 颗金星</p><div id="orbitDayDetail"></div>`;
        renderDayDetail();
    }

    function taskControls(task, date) {
        const record = recordFor(date, task.id), state = progress(task, record);
        if (task.mode === 'check') return `<button type="button" class="orbit-check${state.done ? ' is-done' : ''}" data-record="check" data-task="${task.id}" aria-label="${state.done ? '撤回' : '完成'}${esc(task.name)}">${state.done ? '★' : ''}</button>`;
        if (task.mode === 'count' && task.target <= 10) {
            const value = Number(record.value) || 0;
            return `<div class="orbit-drops" aria-label="${esc(task.name)} ${value}/${task.target}">${Array.from({ length: task.target }, (_, index) => `<button type="button" data-record="count" data-task="${task.id}" data-value="${index + 1}" class="${index < value ? 'is-full' : ''}" aria-label="记录到 ${index + 1}">${esc(task.icon)}</button>`).join('')}<small>${value}/${task.target}</small></div>`;
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
            return `<article class="orbit-task-row${record.skipped ? ' is-skipped' : ''}" data-swipe-row><button class="orbit-skip" type="button" data-skip="${task.id}">${record.skipped ? '算回来' : '放下'}</button><div class="orbit-task-main"><span class="orbit-task-icon">${esc(task.icon)}</span><div class="orbit-task-copy"><strong>${esc(task.name)}</strong>${record.skipped ? '<small>今天的这一项放下了</small>' : ''}</div>${taskControls(task, selectedDate)}<button type="button" class="orbit-row-more" data-reveal aria-label="更多操作">···</button></div></article>`;
        }).join('');
        container.innerHTML = `<section class="orbit-day-detail"><header><div><h3>${dateTitle(selectedDate)}</h3><p>${day.state === 'complete' ? '★ 今天的都照顾好了' : day.state === 'skipped' ? '今天的安排都放下了' : tasks.length ? `${day.completed}/${day.scheduled} 已照顾` : '今天没有安排'}</p></div></header>${rows || '<p class="orbit-no-tasks">这一天没有安排。</p>'}</section>`;
        bindSwipes(container);
    }

    function renderYear() {
        const panel = $('orbitYearPanel'), year = yearOf(), first = `${year}-01-01`, last = `${year}-12-31`;
        const offset = (dateAt(first).getUTCDay() + 6) % 7;
        const months = Array.from({ length: 12 }, (_, month) => {
            const dayIndex = Math.round((new Date(Date.UTC(year, month, 1)) - dateAt(first)) / 86400000), week = Math.floor((offset + dayIndex) / 7);
            return `<span style="left:${week * 13}px">${month + 1}月</span>`;
        }).join('');
        const cells = [];
        for (let date = first; date <= last; date = addDays(date, 1)) {
            const parsed = dateAt(date), dayIndex = Math.round((parsed - dateAt(first)) / 86400000), week = Math.floor((offset + dayIndex) / 7) + 1;
            const row = (parsed.getUTCDay() + 6) % 7 + 1;
            const state = activeSection === 'heart' ? heatClass(heatDay(date)) : ratioClass(dayInfo(date));
            cells.push(`<button type="button" class="orbit-year-day ${state}${date === todayKey() ? ' is-today' : ''}" style="grid-column:${week + 1};grid-row:${row}" data-date="${date}" aria-label="${dateTitle(date)}"></button>`);
        }
        const legend = activeSection === 'heart' ? '<span>○ 安静</span><span><i></i><i></i><i></i> 聊天渐亮</span>' : '<span>○ 无安排</span><span><i></i><i></i><i></i> 渐亮</span><span>★ 全部完成</span>';
        panel.innerHTML = `${periodNav(`${year}年 · 一整年的光`, `${year - 1}-01-01`, `${year + 1}-01-01`, 'year')}<div class="orbit-year-scroll" id="orbitYearScroll"><div class="orbit-year-months">${months}</div><div class="orbit-year-grid">${cells.join('')}</div></div><div class="orbit-legend${activeSection === 'heart' ? ' orbit-heart-legend' : ''}">${legend}</div>`;
        requestAnimationFrame(() => panel.querySelector(`[data-date="${todayKey()}"]`)?.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' }));
    }

    function scheduleText(task) {
        if (task.schedule.kind === 'daily') return '每天';
        if (task.schedule.kind === 'range') return task.ended ? '已结束' : `还剩 ${task.remainingDays} 天`;
        if (task.schedule.customType === 'interval') return `每隔 ${task.schedule.every} 天`;
        return `每周 ${task.schedule.weekdays.map(value => '日一二三四五六'[value]).join('、')}`;
    }
    function renderTasks() {
        const groups = { '日常': [], '阶段': [], '自定义': [], '已结束的': [] };
        for (const task of taskData?.tasks || []) {
            const group = task.ended ? '已结束的' : task.schedule.kind === 'daily' ? '日常' : task.schedule.kind === 'range' ? '阶段' : '自定义';
            groups[group].push(task);
        }
        $('orbitTasksPanel').innerHTML = Object.entries(groups).map(([name, tasks]) => {
            const content = tasks.length ? tasks.map(task => `<article class="orbit-managed-task"><span>${esc(task.icon)}</span><div><strong>${esc(task.name)}</strong><small>${esc(scheduleText(task))}</small></div>${task.ended ? '' : `<button type="button" data-end-task="${task.id}">结束</button>`}</article>`).join('') : '<p class="orbit-group-empty">还没有</p>';
            return name === '已结束的' ? `<details class="orbit-task-group"><summary>${name} <small>${tasks.length}</small></summary>${content}</details>` : `<section class="orbit-task-group"><h3>${name}</h3>${content}</section>`;
        }).join('') + '<button type="button" class="orbit-fab" data-new-task aria-label="新建任务">＋</button>';
    }
    function render() {
        dialog.querySelectorAll('[data-orbit-section]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.orbitSection === activeSection)));
        $('orbitCreatePanel').hidden = true;
        $('orbitNewTask').hidden = activeSection === 'heart';
        $('orbitMonthPanel').hidden = activeSection === 'tasks' || activeRange !== 'month';
        $('orbitYearPanel').hidden = activeSection === 'tasks' || activeRange !== 'year';
        $('orbitTasksPanel').hidden = activeSection !== 'tasks';
        if (activeSection === 'tasks') renderTasks();
        else if (activeRange === 'year') renderYear();
        else if (activeSection === 'heart') renderHeartMonth();
        else renderDailyMonth();
    }
    async function setSection(section) {
        activeSection = section;
        if (section === 'tasks') activeRange = 'month';
        await ensureActiveData();
        render();
    }
    async function setRange(range) {
        activeRange = range;
        await ensureActiveData();
        render();
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
        try { await api(`/api/star-orbit/days/${selectedDate}/tasks/${encodeURIComponent(taskId)}`, body, 'PATCH'); await loadTasks(true); render(); window.SeaHome?.refresh(true); }
        catch (error) { $('orbitStatus').textContent = error.message; }
    }
    async function addMoodSnapshot() {
        const mood = window.prompt('现在的心情：'); if (mood === null) return;
        const physical = window.prompt('身体状态：') || '', focusRaw = window.prompt('当前关注，用 / 分隔：') || '';
        try {
            await api('/api/mood-snapshot', { date: selectedDate, mood, physical_state: physical, current_focus: focusRaw.split('/').map(value => value.trim()).filter(Boolean), observation: '', trigger: '星轨心迹手动记录', importance: 'normal' }, 'POST');
            diaryEntries = null; await loadHeart(true); render(); window.toast?.('已写入心情快照');
        } catch (error) { $('orbitStatus').textContent = error.message; }
    }

    dialog.addEventListener('click', async event => {
        const target = event.target.closest('button'); if (!target) return;
        if (target.classList.contains('orbit-close')) { dialog.close(); return; }
        if (target.dataset.orbitSection) { await setSection(target.dataset.orbitSection); return; }
        if (target.dataset.orbitRange) { await setRange(target.dataset.orbitRange); return; }
        if (target.id === 'orbitNewTask' || target.hasAttribute('data-new-task')) { showCreate(); return; }
        if (target.id === 'orbitCreateBack') { render(); return; }
        if (target.id === 'orbitIconButton') { $('orbitIconPicker').hidden = !$('orbitIconPicker').hidden; return; }
        if (target.dataset.icon) { $('orbitIconButton').textContent = target.dataset.icon; $('orbitIconPicker').hidden = true; return; }
        if (target.dataset.month || target.dataset.year) {
            selectedDate = target.dataset.month || target.dataset.year;
            await ensureActiveData(); render(); return;
        }
        if (target.dataset.date) {
            selectedDate = target.dataset.date; activeRange = 'month';
            await ensureActiveData(); render(); return;
        }
        if (target.hasAttribute('data-heart-state')) { window.goView?.('state'); dialog.close(); return; }
        if (target.hasAttribute('data-heart-snapshot')) { await addMoodSnapshot(); return; }
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
            try { await api(`/api/star-orbit/tasks/${encodeURIComponent(target.dataset.endTask)}`, { ended: true }, 'PATCH'); await loadTasks(true); render(); window.SeaHome?.refresh(true); }
            catch (error) { $('orbitStatus').textContent = error.message; }
        }
    });
    dialog.addEventListener('change', event => { if (event.target.matches('[name="orbitMode"],[name="orbitSchedule"],[name="orbitCustomKind"]')) updateCreateFields(); });
    dialog.addEventListener('close', () => { document.body.classList.remove('sea-modal-open'); });
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    $('orbitCreateForm').addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.currentTarget, submit = event.submitter, scheduleKind = form.querySelector('[name="orbitSchedule"]:checked').value, customType = form.querySelector('[name="orbitCustomKind"]:checked').value;
        const start = $('orbitStartDate').value || todayKey();
        const body = { name: $('orbitTaskName').value, icon: $('orbitIconButton').textContent, mode: form.querySelector('[name="orbitMode"]:checked').value, target: Number($('orbitTarget').value), doses: $('orbitDoses').value.split(/[、,，]/).map(value => value.trim()).filter(Boolean), schedule: { kind: scheduleKind, startDate: start, endDate: $('orbitEndDate').value, customType, every: Number($('orbitEvery').value), weekdays: [...$('orbitWeekdays').querySelectorAll('input:checked')].map(input => Number(input.value)) } };
        submit.disabled = true; $('orbitCreateStatus').textContent = '正在放进星轨…';
        try { await api('/api/star-orbit/tasks', body, 'POST'); form.reset(); $('orbitIconButton').textContent = '💊'; setDefaultDates(); updateCreateFields(); $('orbitCreateStatus').textContent = ''; await loadTasks(true); activeSection = 'tasks'; render(); window.SeaHome?.refresh(true); }
        catch (error) { $('orbitCreateStatus').textContent = error.message; }
        finally { submit.disabled = false; }
    });
    function setDefaultDates() { $('orbitStartDate').value = todayKey(); $('orbitEndDate').value = addDays(todayKey(), 4); }
    setDefaultDates(); updateCreateFields();

    async function open(options = {}) {
        const requested = ['heart', 'daily', 'tasks'].includes(options.section) ? options.section : 'heart';
        selectedDate = normalizeDate(options.date) || todayKey();
        activeSection = requested; activeRange = 'month';
        if (!dialog.open) dialog.showModal();
        document.body.classList.add('sea-modal-open');
        await ensureActiveData(true); render();
    }
    window.StarOrbit = { open, refresh: async () => { await ensureActiveData(true); render(); } };
})();
