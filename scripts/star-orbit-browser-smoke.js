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
    orbit.createTask({ name: '吃早饭', icon: '🍳', mode: 'check', schedule: { kind: 'daily', startDate: today } });
    orbit.createTask({ name: '喝水', icon: '💧', mode: 'count', target: 8, schedule: { kind: 'daily', startDate: today } });
    orbit.createTask({ name: '吃药', icon: '💊', mode: 'split', doses: ['早', '晚'], schedule: { kind: 'range', startDate: today, endDate: today } });
    const app = express(); app.use(express.json());
    app.use('/api/star-orbit', orbit.router);
    app.get('/api/home/summary', (_req, res) => res.json({ date: today, days: 545, nextMilestone: 600, calendarAvailable: false, todos: [], schedules: [], letter: null, diary: null, photo: null, music: null, musicAvailable: false, starOrbit: orbit.summary(today) }));
    app.post('/api/home/miss-you', (_req, res) => res.json({ ok: true }));
    app.get('/api/sync-config', (_req, res) => res.json({ chatSessions: [], suppliers: [] }));
    app.get('/api/music/status', (_req, res) => res.json({ csrfToken: 'fixture', configured: false, session: { state: 'closed', mode: 'local' } }));
    app.use('/api', (_req, res) => res.json({ success: true, config: {}, data: [], favorites: [], status: {}, records: [] }));
    app.get('/diary-logs', (_req, res) => res.json([]));
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
        await page.waitForSelector('.sea-orbit-summary');
        assert.match(await page.$eval('.sea-orbit-summary', node => node.textContent), /今日 0\/3 · 💧 0\/8/);
        await page.click('.sea-orbit-summary');
        await page.waitForFunction(() => document.querySelector('#starOrbitDialog')?.open && document.querySelectorAll('.orbit-task-row').length === 3);
        await page.screenshot({ path: path.join(os.tmpdir(), 'star-orbit-month.png') });
        assert.equal(await page.$eval('.orbit-drawer', node => node.scrollWidth <= node.clientWidth), true, 'drawer fits mobile width');
        await page.click('[data-record="check"]');
        await page.waitForSelector('[data-record="check"].is-done');
        const fifthDrop = await page.$$('[data-record="count"]'); await fifthDrop[4].click();
        await page.waitForFunction(() => document.querySelector('.orbit-drops small')?.textContent === '5/8');
        await page.click('[data-record="dose"]');
        await page.waitForSelector('[data-record="dose"].is-done');
        await page.click('[data-orbit-tab="year"]');
        assert.ok(await page.$$eval('.orbit-year-day', nodes => nodes.length) >= 365);
        await page.click('[data-orbit-tab="tasks"]');
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
        console.log(JSON.stringify({ ok: true, checks: ['home summary', 'mobile drawer', 'check', 'water count', 'split dose', 'year view', 'task creation', 'no overflow'], screenshots: [path.join(os.tmpdir(), 'star-orbit-month.png'), path.join(os.tmpdir(), 'star-orbit-mobile.png')] }));
    } finally {
        await browser?.close(); ws.close(); await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true });
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
