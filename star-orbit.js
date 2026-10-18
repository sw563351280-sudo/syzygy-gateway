'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-([012]\d|3[01])$/;
const ICONS = new Set(['💊', '💧', '🍳', '🌙', '🧴', '🚶', '🫧', '🧘', '📖', '☀️', '🌿', '✨']);

function dateKey(now = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(now);
}

function validDate(value) {
    if (!DATE_RE.test(String(value || ''))) return false;
    const parsed = new Date(`${value}T12:00:00+08:00`);
    return !Number.isNaN(parsed.getTime()) && dateKey(parsed) === value;
}

function addDays(value, amount) {
    const date = new Date(`${value}T12:00:00+08:00`);
    date.setUTCDate(date.getUTCDate() + amount);
    return dateKey(date);
}

function daysBetween(from, to) {
    return Math.round((Date.parse(`${to}T12:00:00+08:00`) - Date.parse(`${from}T12:00:00+08:00`)) / 86400000);
}

function freshStore() { return { version: 1, tasks: [], records: {} }; }

function normalizeStore(value) {
    if (!value || typeof value !== 'object' || !Array.isArray(value.tasks) || !value.records || typeof value.records !== 'object') {
        throw Error('Invalid star orbit store');
    }
    return { version: 1, tasks: value.tasks, records: value.records };
}

function cleanText(value, max) { return String(value || '').trim().slice(0, max); }

function normalizeTaskInput(body, today) {
    const name = cleanText(body?.name, 40);
    const mode = ['check', 'count', 'split'].includes(body?.mode) ? body.mode : null;
    const scheduleKind = ['daily', 'range', 'custom'].includes(body?.schedule?.kind) ? body.schedule.kind : null;
    if (!name) throw Object.assign(Error('请给任务取一个名字'), { status: 400 });
    if (!mode) throw Object.assign(Error('请选择记录方式'), { status: 400 });
    if (!scheduleKind) throw Object.assign(Error('请选择什么时候做'), { status: 400 });
    const startDate = validDate(body.schedule.startDate) ? body.schedule.startDate : today;
    const schedule = { kind: scheduleKind, startDate };
    if (scheduleKind === 'range') {
        schedule.endDate = validDate(body.schedule.endDate) ? body.schedule.endDate : addDays(startDate, 4);
        if (schedule.endDate < startDate) throw Object.assign(Error('结束日期不能早于开始日期'), { status: 400 });
    }
    if (scheduleKind === 'custom') {
        const customType = body.schedule.customType === 'interval' ? 'interval' : 'weekdays';
        schedule.customType = customType;
        if (customType === 'interval') {
            const every = Number(body.schedule.every);
            if (!Number.isInteger(every) || every < 1 || every > 365) throw Object.assign(Error('间隔天数应在 1–365 之间'), { status: 400 });
            schedule.every = every;
        } else {
            schedule.weekdays = [...new Set((Array.isArray(body.schedule.weekdays) ? body.schedule.weekdays : []).map(Number))]
                .filter(day => Number.isInteger(day) && day >= 0 && day <= 6).sort();
            if (!schedule.weekdays.length) throw Object.assign(Error('至少选择一个星期'), { status: 400 });
        }
    }
    const task = { name, icon: ICONS.has(body.icon) ? body.icon : '✨', mode, schedule };
    if (mode === 'count') {
        const target = Number(body.target);
        if (!Number.isInteger(target) || target < 1 || target > 999) throw Object.assign(Error('目标数量应在 1–999 之间'), { status: 400 });
        task.target = target;
    }
    if (mode === 'split') {
        const names = (Array.isArray(body.doses) ? body.doses : []).map(item => cleanText(item, 12)).filter(Boolean);
        task.doses = [...new Set(names)].slice(0, 12).map((name, index) => ({ id: `dose_${index + 1}`, name }));
        if (!task.doses.length) task.doses = [{ id: 'dose_1', name: '早' }, { id: 'dose_2', name: '晚' }];
    }
    return task;
}

function taskOnDate(task, date) {
    if (!task || date < task.schedule.startDate) return false;
    if (task.endedAt && date > (task.endedDate || dateKey(new Date(task.endedAt)))) return false;
    if (task.schedule.kind === 'range') return date <= task.schedule.endDate;
    if (task.schedule.kind === 'daily') return true;
    if (task.schedule.customType === 'interval') return daysBetween(task.schedule.startDate, date) % task.schedule.every === 0;
    const weekday = new Date(`${date}T12:00:00+08:00`).getUTCDay();
    return task.schedule.weekdays.includes(weekday);
}

function taskProgress(task, record = {}) {
    if (record.skipped) return { done: false, ratio: 0, skipped: true };
    if (task.mode === 'check') return { done: Boolean(record.value), ratio: record.value ? 1 : 0, skipped: false };
    if (task.mode === 'count') {
        const value = Math.max(0, Number(record.value) || 0);
        return { done: value >= task.target, ratio: Math.min(1, value / task.target), skipped: false };
    }
    const completed = task.doses.filter(dose => record.doses?.[dose.id]?.done).length;
    return { done: completed === task.doses.length, ratio: task.doses.length ? completed / task.doses.length : 0, skipped: false };
}

function daySummary(store, date) {
    const tasks = store.tasks.filter(task => taskOnDate(task, date));
    if (!tasks.length) return { date, scheduled: 0, completed: 0, ratio: 0, state: 'empty' };
    const records = store.records[date] || {};
    const progress = tasks.map(task => taskProgress(task, records[task.id]));
    const included = progress.filter(item => !item.skipped);
    const completed = included.filter(item => item.done).length;
    const ratio = included.length ? included.reduce((sum, item) => sum + item.ratio, 0) / included.length : 0;
    return { date, scheduled: tasks.length, completed, ratio, state: included.length ? (completed === included.length ? 'complete' : 'active') : 'skipped' };
}

function publicTask(task, today) {
    const ended = Boolean(task.endedAt || (task.schedule.kind === 'range' && task.schedule.endDate < today));
    return { ...task, ended, remainingDays: task.schedule.kind === 'range' && !ended ? Math.max(0, daysBetween(today, task.schedule.endDate)) : null };
}

function formatTaskProgress(task, record = {}) {
    const progress = taskProgress(task, record);
    if (progress.skipped) return '今天已放下';
    if (task.mode === 'check') return progress.done ? '已完成' : '未完成';
    if (task.mode === 'count') return `${Math.max(0, Number(record.value) || 0)}/${task.target}${progress.done ? '，已完成' : ''}`;
    const done = task.doses.filter(dose => record.doses?.[dose.id]?.done).map(dose => dose.name);
    return `${done.length}/${task.doses.length}${done.length ? `，已完成：${done.join('、')}` : ''}${progress.done ? '，全部完成' : ''}`;
}

function createStarOrbit({ directory, clock = () => new Date() }) {
    const file = path.join(directory, 'star_orbit.json');
    function read() {
        try { return normalizeStore(JSON.parse(fs.readFileSync(file, 'utf8'))); }
        catch (error) { if (error.code === 'ENOENT') return freshStore(); throw error; }
    }
    function write(store) {
        const temp = `${file}.tmp.${crypto.randomBytes(4).toString('hex')}`;
        fs.writeFileSync(temp, JSON.stringify(normalizeStore(store), null, 2), { encoding: 'utf8', mode: 0o600 });
        fs.renameSync(temp, file);
    }
    function summary(date = dateKey(clock())) {
        const store = read(), result = daySummary(store, date), records = store.records[date] || {};
        const countTask = store.tasks.find(task => taskOnDate(task, date) && task.mode === 'count' && !taskProgress(task, records[task.id]).done && !records[task.id]?.skipped);
        if (countTask) result.highlight = { icon: countTask.icon, value: Math.max(0, Number(records[countTask.id]?.value) || 0), target: countTask.target };
        return result;
    }
    function todayContext(date = dateKey(clock())) {
        const store = read();
        const tasks = store.tasks.filter(task => taskOnDate(task, date));
        if (!tasks.length) return `【星轨·今日任务】\n${date} 没有安排。只代表星轨当天，不包含普通待办或其他日期。`;
        const records = store.records[date] || {};
        const summary = daySummary(store, date);
        return `【星轨·今日任务】\n${date}｜${summary.completed}/${summary.scheduled} 项完成\n${tasks.map(task => `- ${task.icon} ${task.name}：${formatTaskProgress(task, records[task.id] || {})}`).join('\n')}\n只提供今天的实时摘要；不要据此推断昨天或未来的完成情况。`;
    }
    function view(from, to) {
        const today = dateKey(clock());
        const start = validDate(from) ? from : `${today.slice(0, 7)}-01`;
        const end = validDate(to) && to >= start ? to : addDays(start, 41);
        if (daysBetween(start, end) > 400) throw Object.assign(Error('日期范围不能超过 400 天'), { status: 400 });
        const store = read(), days = [];
        for (let date = start; date <= end; date = addDays(date, 1)) days.push(daySummary(store, date));
        return { today, tasks: store.tasks.map(task => publicTask(task, today)), records: store.records, days };
    }
    function createTask(body) {
        const store = read(), now = clock(), today = dateKey(now);
        const entry = { id: `orbit_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`, ...normalizeTaskInput(body, today), createdAt: now.toISOString() };
        store.tasks.push(entry); write(store); return publicTask(entry, today);
    }
    function endTask(id) {
        const store = read(), task = store.tasks.find(item => item.id === id);
        if (!task) throw Object.assign(Error('没有找到这项任务'), { status: 404 });
        const now = clock(); task.endedAt = now.toISOString(); task.endedDate = dateKey(now); write(store); return publicTask(task, task.endedDate);
    }
    function patchRecord(date, taskId, body) {
        if (!validDate(date)) throw Object.assign(Error('日期不正确'), { status: 400 });
        const store = read(), task = store.tasks.find(item => item.id === taskId);
        if (!task || !taskOnDate(task, date)) throw Object.assign(Error('这一天没有这项安排'), { status: 404 });
        const byDate = store.records[date] ||= {}, record = byDate[taskId] ||= {};
        if (body?.skipped !== undefined) {
            record.skipped = Boolean(body.skipped);
        } else if (task.mode === 'check') {
            record.value = Boolean(body?.value); record.skipped = false;
        } else if (task.mode === 'count') {
            const value = Number(body?.value);
            if (!Number.isInteger(value) || value < 0 || value > 9999) throw Object.assign(Error('记录数量不正确'), { status: 400 });
            record.value = value; record.skipped = false;
        } else {
            const dose = task.doses.find(item => item.id === body?.doseId);
            if (!dose) throw Object.assign(Error('没有找到这个剂次'), { status: 400 });
            record.doses ||= {};
            record.doses[dose.id] = { done: Boolean(body.done) };
            if (body.time && /^([01]\d|2[0-3]):[0-5]\d$/.test(body.time)) record.doses[dose.id].time = body.time;
            record.skipped = false;
        }
        record.recordedAt = clock().toISOString();
        write(store);
        return { record, summary: daySummary(store, date) };
    }

    const router = express.Router();
    router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    router.get('/', (req, res) => {
        try { res.json(view(req.query.from, req.query.to)); }
        catch (error) { res.status(error.status || 503).json({ error: error.status ? error.message : '星轨暂时没有同步好' }); }
    });
    router.post('/tasks', (req, res) => {
        try { res.status(201).json({ task: createTask(req.body) }); }
        catch (error) { res.status(error.status || 503).json({ error: error.status ? error.message : '任务暂时没有保存好' }); }
    });
    router.patch('/tasks/:id', (req, res) => {
        try {
            if (!req.body?.ended) return res.status(400).json({ error: '只支持结束任务' });
            res.json({ task: endTask(req.params.id) });
        } catch (error) { res.status(error.status || 503).json({ error: error.status ? error.message : '任务暂时没有更新好' }); }
    });
    router.patch('/days/:date/tasks/:taskId', (req, res) => {
        try { res.json(patchRecord(req.params.date, req.params.taskId, req.body)); }
        catch (error) { res.status(error.status || 503).json({ error: error.status ? error.message : '记录暂时没有保存好' }); }
    });
    return { router, read, summary, todayContext, view, createTask, endTask, patchRecord };
}

module.exports = { addDays, createStarOrbit, dateKey, daySummary, formatTaskProgress, normalizeTaskInput, taskOnDate, taskProgress };
