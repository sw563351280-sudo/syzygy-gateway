'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const { WebSocketServer } = require('ws');
const { createStarOrbit, dateKey } = require('../star-orbit');

async function main() {
    const root = path.join(__dirname, '..'), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'star-orbit-browser-'));
    const now = new Date(), today = dateKey(now), orbit = createStarOrbit({ directory, clock: () => now });
    const app = express(); app.use(express.json());
    app.use('/api/star-orbit', orbit.router);
    app.get('/api/home/summary', (_req, res) => res.json({ date: today, days: 545, nextMilestone: 600, calendarAvailable: false, todos: [], schedules: [], letter: null, diary: null, photo: null, music: null, musicAvailable: false, starOrbit: orbit.summary(today) }));
    app.get('/api/heart-trail', (req, res) => res.json({ year: Number(req.query.year), rules: { thresholds: [1, 100, 190] }, days: [{ date: today, level: 3, score: 196, rounds: 60, userCharacters: 5300, messages: 120 }], archive: { firstDate: '2025-11-21', lastDate: today, missingMonths: [`${today.slice(0, 4)}-04`] } }));
    app.get('/api/calendar', (_req, res) => res.json({ success: true, data: [{ date: today, mood: '安心', shenwang_note: '今天也好好接住你。', period_flag: true }] }));
    app.post('/api/home/miss-you', (_req, res) => res.json({ ok: true }));
    app.get('/api/sync-config', (_req, res) => res.json({ chatSessions: [], suppliers: [] }));
    app.get('/api/music/status', (_req, res) => res.json({ csrfToken: 'fixture', configured: false, session: { state: 'closed', mode: 'local' } }));
    app.use('/api', (_req, res) => res.json({ success: true, config: {}, data: [], favorites: [], status: {}, records: [] }));
    app.get('/diary-logs', (_req, res) => res.json([{ id: 'mood-1', type: 'mood_snapshot', date: today, datetime: new Date().toISOString(), text: '【心情快照】\n很安心' }]));
    app.use(express.static(path.join(root, 'public')));
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const ws = new WebSocketServer({ server }); let browser;
    try {
        const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || ['/usr/bin/chromium-browser', '/snap/bin/chromium'].find(fs.existsSync);
        browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'] });
        const page = await browser.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setRequestInterception(true);
        page.on('request', request => request.url().startsWith('http') && !request.url().startsWith('http://127.0.0.1:') ? request.abort() : request.continue());
        await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 1 });
        await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'networkidle0' });
        await page.waitForSelector('#homeV2MoreToggle');
        const chatUi = await page.evaluate(() => {
            const html = document.documentElement;
            html.dataset.seaCycle = 'day';
            goView('chat');
            openCommunication();
            const input = document.querySelector('#chatInput');
            const mainPlaceholder = input.placeholder;
            const placeholderBefore = getComputedStyle(input, '::placeholder').color;
            SeaTheme.setAdjustments({ dayTextColor: '#c4956a' });
            const placeholderAfter = getComputedStyle(input, '::placeholder').color;
            const session = getActiveSession();
            session.messages = [{ role: 'assistant', speaker: 'shenwang', versions: [{ content: '尾巴前正文\n{"after_minutes":45,"urgency":"low","reason":"稍后看看"}', fullTime: '2026-10-18T08:00:00.000Z' }], activeVersion: 0 }];
            renderChatMessages({ forceBottom: true });
            const rendered = document.querySelector('#chatWindow .md-content')?.textContent || '';
            openWorkroom();
            const workroomPlaceholder = input.placeholder;
            SeaTheme.setAdjustments({ dayTextColor: '#1a3a5c' });
            return { mainPlaceholder, workroomPlaceholder, placeholderBefore, placeholderAfter, rendered };
        });
        assert.equal(chatUi.mainPlaceholder, '跟我说说话，宝宝……');
        assert.equal(chatUi.workroomPlaceholder, '把我们叫来，一起商量点什么……');
        assert.notEqual(chatUi.placeholderBefore, chatUi.placeholderAfter, 'composer hint follows the configured text color');
        assert.equal(chatUi.rendered.trim(), '尾巴前正文', 'stored naked wake JSON stays hidden in historical rendering');
        await page.evaluate(() => goView('home'));
        assert.equal(await page.$('.sea-orbit-summary'), null, 'empty orbit stays hidden on the home page');
        await page.click('#homeV2MoreToggle');
        await page.waitForSelector('#seaMoreDialog[open] [data-sea-action="star-orbit"]');
        assert.equal(await page.$('#seaMoreDialog [data-sea-action="calendar"]'), null, 'legacy calendar entry is folded into star orbit');
        await page.screenshot({ path: path.join(os.tmpdir(), 'star-orbit-empty-entry.png') });
        await page.click('[data-sea-action="star-orbit"]');
        await page.waitForFunction(() => document.querySelector('#starOrbitDialog')?.open);
        assert.equal(await page.$eval('#seaMoreDialog', node => node.open), false, 'more panel closes before orbit opens');
        assert.equal(await page.$eval('[data-orbit-section="heart"]', node => node.getAttribute('aria-selected')), 'true', 'ordinary entry defaults to heart trail');
        assert.equal(await page.$eval('#orbitNewTask', node => node.hidden), true, 'heart trail does not show task add action');
        const orbitGlass = await page.evaluate(() => {
            const html = document.documentElement, drawer = document.querySelector('.orbit-drawer'), original = html.dataset.seaCycle;
            html.dataset.seaCycle = 'day';
            const day = { background: getComputedStyle(drawer).backgroundColor, color: getComputedStyle(drawer).color, blur: getComputedStyle(drawer).backdropFilter };
            html.dataset.seaCycle = 'night';
            const night = { background: getComputedStyle(drawer).backgroundColor, color: getComputedStyle(drawer).color, blur: getComputedStyle(drawer).backdropFilter };
            html.dataset.seaCycle = original;
            return { day, night };
        });
        assert.notEqual(orbitGlass.day.background, orbitGlass.night.background, 'orbit glass changes with the day/night cycle');
        assert.match(orbitGlass.day.background, /0\.76/);
        assert.match(orbitGlass.night.background, /0\.78/);
        assert.match(orbitGlass.day.blur, /blur\(22px\)/);
        assert.notEqual(orbitGlass.day.color, orbitGlass.night.color, 'orbit copy follows the active appearance text color');
        assert.equal(await page.$$eval('.orbit-heart-day.is-heat-3', nodes => nodes.length), 1, 'chat heat lights the matching day');
        assert.equal(await page.$$eval('.orbit-heart-day .orbit-period-dot', nodes => nodes.length), 1, 'calendar period marker survives the merge');
        assert.match(await page.$eval('.orbit-heart-detail', node => node.textContent), /聊了 60 轮 · 你留下 5300 字/);
        assert.match(await page.$eval('.orbit-heart-detail', node => node.textContent), /今天也好好接住你/);
        assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.orbit-heart-detail')).color === getComputedStyle(document.body).color), true, 'heart text follows appearance text color');
        await page.click('[data-orbit-range="year"]');
        assert.ok(await page.$$eval('.orbit-year-day.is-archive-gap', nodes => nodes.length) >= 30, 'archive gap is distinct from a quiet month');
        assert.match(await page.$eval('#orbitYearPanel .orbit-heart-legend', node => node.textContent), /存档缺口/);
        await page.click('#orbitYearPanel [data-orbit-range="month"]');
        await page.screenshot({ path: path.join(os.tmpdir(), 'star-orbit-heart.png') });
        await page.click('[data-orbit-section="daily"]');
        assert.equal(await page.$$eval('.orbit-task-row', nodes => nodes.length), 0, 'empty orbit can be opened');
        await page.click('#orbitNewTask');
        await page.type('#orbitTaskName', '吃早饭');
        await page.click('#orbitCreateForm .orbit-submit');
        await page.waitForFunction(() => [...document.querySelectorAll('.orbit-managed-task strong')].some(node => node.textContent === '吃早饭'));
        await page.evaluate(async today => {
            const tasks = [
                { name: '喝水', icon: '💧', mode: 'count', target: 8, schedule: { kind: 'daily', startDate: today } },
                { name: '吃药', icon: '💊', mode: 'split', doses: ['早', '晚'], schedule: { kind: 'range', startDate: today, endDate: today } }
            ];
            for (const task of tasks) await fetch('/api/star-orbit/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(task) });
            await window.StarOrbit.refresh();
            await window.SeaHome.refresh(true);
        }, today);
        await page.keyboard.press('Escape');
        await page.waitForSelector('.sea-orbit-summary');
        assert.match(await page.$eval('.sea-orbit-summary', node => node.textContent), /今日 0\/3 · 💧 0\/8/);
        await page.click('.sea-orbit-summary');
        await page.waitForFunction(() => document.querySelector('#starOrbitDialog')?.open && document.querySelectorAll('.orbit-task-row').length === 3);
        assert.equal(await page.$eval('[data-orbit-section="daily"]', node => node.getAttribute('aria-selected')), 'true', 'home task summary opens the daily track');
        await page.screenshot({ path: path.join(os.tmpdir(), 'star-orbit-month.png') });
        assert.equal(await page.$eval('.orbit-drawer', node => node.scrollWidth <= node.clientWidth), true, 'drawer fits mobile width');
        await page.click('[data-record="check"]');
        await page.waitForSelector('[data-record="check"].is-done');
        const fifthDrop = await page.$$('[data-record="count"]'); await fifthDrop[4].click();
        await page.waitForFunction(() => document.querySelector('.orbit-drops small')?.textContent === '5/8');
        await page.click('[data-record="dose"]');
        await page.waitForSelector('[data-record="dose"].is-done');
        await page.click('[data-orbit-range="year"]');
        assert.ok(await page.$$eval('.orbit-year-day', nodes => nodes.length) >= 365);
        await page.click('[data-orbit-section="tasks"]');
        assert.equal(await page.$$eval('.orbit-managed-task', nodes => nodes.length), 3);
        await page.click('[data-new-task]');
        await page.type('#orbitTaskName', '晚间散步');
        await page.click('.orbit-choice-cards label:nth-child(1) input');
        await page.click('#orbitCreateForm .orbit-submit');
        await page.waitForFunction(() => [...document.querySelectorAll('.orbit-managed-task strong')].some(node => node.textContent === '晚间散步'));
        await page.screenshot({ path: path.join(os.tmpdir(), 'star-orbit-mobile.png') });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'page has no horizontal overflow');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('#starOrbitDialog').open);
        await page.waitForFunction(() => document.querySelector('.sea-orbit-summary').textContent.includes('今日 1/4'));
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ ok: true, checks: ['chat tail fallback', 'chat placeholders and configured hint color', 'default heart trail', 'day/night orbit glass', 'chat heat and calendar detail', 'appearance text color', 'empty-state menu entry', 'first task creation', 'home summary', 'mobile drawer', 'check', 'water count', 'split dose', 'year view', 'task creation', 'no overflow'], screenshots: [path.join(os.tmpdir(), 'star-orbit-empty-entry.png'), path.join(os.tmpdir(), 'star-orbit-heart.png'), path.join(os.tmpdir(), 'star-orbit-month.png'), path.join(os.tmpdir(), 'star-orbit-mobile.png')] }));
    } finally {
        await browser?.close(); ws.close(); await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true });
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
