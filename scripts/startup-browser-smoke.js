'use strict';
// Synthetic, localhost-only startup regression. Never starts gateway jobs or reads user data.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const express = require('express');
const puppeteer = require('puppeteer-core');
const { WebSocketServer } = require('ws');
const directory = path.resolve(__dirname, '..');
const baseline = process.argv.includes('--baseline');
const baselineRef = process.env.AUDIT_BASE_REF || '83317fb';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
    const app = express(); app.use(express.json());
    const requests = [];
    app.use((req, _res, next) => { if (req.path.startsWith('/api/')) requests.push(req.path); next(); });
    const messages = Array.from({ length: 170 }, (_, index) => ({
        _id: 'm' + index,
        role: index % 2 ? 'assistant' : 'user',
        content: index === 169 ? '**hello** from the fixture' : 'fixture message ' + index,
        image: index === 169 ? '/fixture-image.svg' : undefined,
        fullTime: new Date(Date.UTC(2026, 8, 30, 1, 0, index)).toISOString()
    }));
    app.get('/api/sync-config', async (req, res) => {
        await sleep(900);
        const limit = Math.max(1, Number(req.query.mainLimit) || messages.length);
        const start = Math.max(0, messages.length - limit);
        res.json({ _version: 1, activeChatId: 'main', suppliers: [{ name: 'fixture', url: 'https://invalid.test/v1', key: 'fixture-key' }],
            _historyWindows: { main: { start, total: messages.length, hasMore: start > 0, partial: start > 0 } },
            chatSessions: [{ id: 'main', name: 'main', messages: messages.slice(start) }, { id: 'syzygy-workroom', name: 'workroom', messages: [] }] });
    });
    app.get('/api/chat-history/:sessionId', (req, res) => {
        const end = Math.max(0, Math.min(messages.length, Number(req.query.before) || messages.length));
        const start = Math.max(0, end - (Number(req.query.limit) || 80));
        res.json({ _version: 1, sessionId: req.params.sessionId, messages: messages.slice(start, end), start, end, total: messages.length, hasMore: start > 0 });
    });
    app.post('/api/sync-config', (_req, res) => res.json({ success: true, _version: 2 }));
    app.get('/api/favorites', async (_req, res) => { await sleep(900); res.json({ favorites: [] }); });
    app.get('/api/todos', (_req, res) => res.json({ active: [], shen: [], fish: [] }));
    app.get('/api/period', (_req, res) => res.json({ status: { inPeriod: false }, records: [] }));
    app.get('/api/music/status', (_req, res) => res.json({ csrfToken: 'fixture', configured: false, session: { mode: 'local', state: 'idle', offers: [] } }));
    app.get('/api/music/session', (_req, res) => res.json({ mode: 'local', state: 'idle', offers: [] }));
    app.post('/api/fetch-models', (_req, res) => res.json({ data: [{ id: 'fixture-model' }] }));
    app.use('/api', (_req, res) => res.json({ success: true, tools: {}, servers: [], state: 'disconnected', config: {}, tasks: [], data: [] }));
    app.get('/fixture-image.svg', (_req, res) => res.type('svg').send('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'));
    if (baseline) for (const [route, file] of [['/', 'public/index.html'], ['/script.js', 'public/script.js'], ['/style.css', 'public/style.css']]) {
        const content = execFileSync('git', ['show', baselineRef + ':' + file], { cwd: directory });
        app.get(route, (_req, res) => res.type(file.endsWith('.js') ? 'js' : file.endsWith('.css') ? 'css' : 'html').send(content));
    }
    app.use(express.static(path.join(directory, 'public')));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const ws = new WebSocketServer({ server });
    let browser;
    try {
        const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(p => p && fs.existsSync(p));
        assert.ok(executablePath, 'Chromium is required for this smoke test');
        browser = await puppeteer.launch({ executablePath, headless: true, args: ['--mute-audio'], defaultViewport: { width: 1024, height: 900 } });
        const page = await browser.newPage();
        const errors = [], resources = [], external = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setRequestInterception(true);
        page.on('request', request => {
            resources.push(request.url());
            if (request.url().startsWith('http') && !request.url().startsWith('http://127.0.0.1:')) {
                external.push(request.url());
                if (request.url().includes('/marked/')) return request.respond({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(directory, 'public/vendor/marked.min.js'), 'utf8') });
                return request.abort();
            }
            return request.continue();
        });
        await page.evaluateOnNewDocument(() => {
            window.homeReadyAt = null;
            new MutationObserver(() => {
                if (window.homeReadyAt === null && document.querySelector('#neuWeekStrip .neu-week-day')) window.homeReadyAt = performance.now();
            }).observe(document, { childList: true, subtree: true });
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
        await sleep(2300);
        const metrics = await page.evaluate(() => ({ homeReadyMs: Math.round(window.homeReadyAt), hiddenChatRows: document.querySelectorAll('#chatWindow .msg-row').length, markdownAvailable: typeof marked !== 'undefined' }));
        const initial = { ...metrics, startupApiCalls: requests.slice(), externalScripts: external, hiddenChatImageLoaded: resources.some(url => url.endsWith('/fixture-image.svg')), largeFontLoaded: resources.some(url => url.includes('ximai.ttf')), pageErrors: errors.slice() };
        console.log(JSON.stringify({ mode: baseline ? 'baseline' : 'updated', ...initial }, null, 2));
        if (!baseline) {
            assert.ok(metrics.homeReadyMs < 900, 'home must not wait for delayed sync');
            assert.equal(metrics.hiddenChatRows, 0);
            assert.equal(initial.hiddenChatImageLoaded, false);
            assert.equal(external.length, 0);
            for (const endpoint of ['/api/tools-status', '/api/mcp/servers', '/api/toy-status']) assert.equal(requests.includes(endpoint), false);
            await page.evaluate(() => openCommunication());
            await page.waitForSelector('#chatWindow .msg.sys strong');
            assert.equal(await page.evaluate(() => activeChatId), 'main');
            assert.equal(await page.evaluate(() => chatSessions.find(session => session.id === 'main').messages.length), 80);
            await page.evaluate(() => revealEarlierChatMessages());
            await page.evaluate(() => revealEarlierChatMessages());
            assert.equal(await page.evaluate(() => chatSessions.find(session => session.id === 'main').messages.length), 160);
            await page.evaluate(() => revealEarlierChatMessages());
            assert.equal(await page.evaluate(() => chatSessions.find(session => session.id === 'main').messages.length), 170);
            await page.evaluate(() => openWorkroom());
            assert.equal(await page.evaluate(() => activeChatId), 'syzygy-workroom');
            await page.evaluate(() => openCommunication());
            assert.equal(await page.evaluate(() => activeChatId), 'main');
            await page.evaluate(() => goView('dev'));
            await page.waitForFunction(() => document.querySelector('#toyConnectionStatus')?.classList.contains('is-disconnected'));
            assert.ok(requests.includes('/api/toy-status'));
            await page.setViewport({ width: 393, height: 852, isMobile: true, hasTouch: true });
            await page.evaluate(() => goView('home'));
            assert.equal(await page.evaluate(() => document.querySelector('#sec-home').classList.contains('active')), true);
            console.log('Desktop/mobile navigation, Markdown rendering and on-demand device refresh passed.');
        }
        assert.deepEqual(errors, []);
    } finally {
        if (browser) await browser.close();
        ws.close(); await new Promise(resolve => server.close(resolve));
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
