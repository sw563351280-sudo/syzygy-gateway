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
const workroomBriefOnly = process.argv.includes('--workroom-brief-only');
const frontendReliefOnly = process.argv.includes('--frontend-relief-only');
const baselineRef = process.env.AUDIT_BASE_REF || '83317fb';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function verifyWorkroomBrief(page) {
    await page.evaluate(() => openCommunication());
    await page.waitForSelector('.workroom-brief-card');
    assert.equal(await page.$eval('.workroom-brief-card', element => element.open), false, 'brief starts collapsed');
    assert.equal(await page.$eval('.workroom-brief-toggle', element => element.textContent), '• 便签员贴了一张便签');
    assert.deepEqual(await page.$eval('.workroom-brief-card', element => {
        const style = getComputedStyle(element);
        return { border: style.borderStyle, background: style.backgroundColor, shadow: style.boxShadow };
    }), { border: 'none', background: 'rgba(0, 0, 0, 0)', shadow: 'none' }, 'collapsed brief has no bubble styling');
    assert.equal(await page.$eval('.workroom-brief-toggle', element => getComputedStyle(element).fontSize), '10px', 'brief hint matches thinking-detail text size');
    assert.equal(await page.evaluate(() => {
        const brief = document.querySelector('.workroom-brief-card');
        const latestMessage = document.querySelector('#chatWindow .msg-row:last-of-type');
        return Boolean(brief.compareDocumentPosition(latestMessage) & Node.DOCUMENT_POSITION_FOLLOWING);
    }), true, 'brief stays before messages sent after it was created');
    assert.equal(await page.$eval('.workroom-brief-content', element => element.getClientRects().length), 0, 'brief body is hidden by default');
    await page.click('.workroom-brief-toggle');
    assert.equal(await page.$eval('.workroom-brief-card', element => element.open), true, 'click expands the brief');
    assert.ok(await page.$eval('.workroom-brief-content', element => element.getClientRects().length), 'expanded brief body is visible');
    await page.click('.workroom-brief-toggle');
    assert.equal(await page.$eval('.workroom-brief-card', element => element.open), false, 'second click collapses the brief');
}
async function main() {
    const app = express(); app.use(express.json());
    const requests = [];
    let modelReplyMode = 'success';
    let syncDelay = 900;
    app.use((req, _res, next) => { if (req.path.startsWith('/api/')) requests.push(req.path); next(); });
    const messages = Array.from({ length: 170 }, (_, index) => ({
        _id: 'm' + index,
        role: index % 2 ? 'assistant' : 'user',
        content: index === 169 ? '**hello** from the fixture' : 'fixture message ' + index,
        image: index === 169 ? '/fixture-image.svg' : undefined,
        fullTime: index === 169 ? '2026-10-20T01:00:00.000Z' : new Date(Date.UTC(2026, 8, 30, 1, 0, index)).toISOString()
    }));
    app.get('/api/sync-config', async (req, res) => {
        await sleep(syncDelay);
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
    app.get('/api/workroom-notes/briefs', (_req, res) => res.json({ briefs: [{
        id: 'brief-fixture', status: 'ready', createdAt: '2026-10-19T00:10:00.000Z', durationMinutes: 3,
        summary: '三人确认了便签的折叠展示。', topics: [{ title: '呈现', summary: '默认只显示一句提示。' }],
        progress: [{ title: '便签样式', status: 'completed' }]
    }] }));
    app.get('/api/ledger/overview', (_req, res) => res.json({ success: true, data: { balance_cents: 1234, income_cents: 2000, expense_cents: 766, savings_rate: 62, daily: {}, category_breakdown: [], count: 0, recent: [], previous_expense_cents: 0 } }));
    app.get('/api/calendar', (_req, res) => res.json({ success: true, data: [] }));
    app.get('/api/photos', (_req, res) => res.json({ photos: [] }));
    app.get('/api/user-state', (_req, res) => res.json({ user_state: { slots: {} } }));
    app.get('/diary-logs', (_req, res) => res.json([]));
    app.post('/api/fetch-models', async (_req, res) => {
        if (modelReplyMode === 'slow-error') {
            await sleep(1400);
            return res.status(502).json({ error: 'fixture upstream unavailable' });
        }
        res.json({ data: [{ id: 'fixture-model' }] });
    });
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
        browser = await puppeteer.launch({ executablePath, headless: true, args: ['--mute-audio', '--no-sandbox', '--disable-setuid-sandbox'], defaultViewport: process.argv.includes('--mobile') ? { width: 393, height: 852, isMobile: true, hasTouch: true } : { width: 1024, height: 900 } });
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
            assert.equal(resources.some(url => url.includes('/home-tools.')), false, 'secondary home tools stay unloaded on startup');
            if (process.argv.includes('--chat-startup-only')) {
                await page.waitForFunction(async () => Boolean(await ChatRecentCache.read()));
                // A remotely deleted message must never be restored from this display cache.
                await page.evaluate(async () => {
                    const snapshot = await ChatRecentCache.read();
                    snapshot.session.messages.push({ _id: 'deleted-remote', role: 'user', content: 'stale cached message' });
                    await ChatRecentCache.write(snapshot.session, snapshot.preferences);
                });
                syncDelay = 3000;
                const savesBefore = requests.filter(endpoint => endpoint === '/api/chat-messages').length;
                await page.reload({ waitUntil: 'domcontentloaded' });
                const preview = await page.evaluate(async () => {
                    const started = performance.now();
                    openCommunication();
                    await new Promise((resolve, reject) => {
                        const timer = setInterval(() => {
                            if (document.querySelector('#chatWindow [data-message-id="deleted-remote"]')) {
                                clearInterval(timer); clearTimeout(deadline); resolve();
                            }
                        }, 10);
                        const deadline = setTimeout(() => { clearInterval(timer); reject(new Error('Cached chat did not appear')); }, 1500);
                    });
                    const versionBefore = _dataVersion;
                    document.getElementById('chatInput').value = 'must wait for cloud';
                    await sendChat();
                    return { ms: performance.now() - started, versionBefore,
                        busy: document.getElementById('chatWindow').getAttribute('aria-busy'),
                        pending: _chatJournal.hasPending(), pendingIds: _chatJournal.pendingSnapshot().map(s => ({ id: s.id, ids: s.messages.map(m => m._id) })),
                        inert: document.querySelector('#chatWindow .msg-row').inert };
                });
                assert.ok(preview.ms < 1500, 'cached chat appears before the three-second sync');
                assert.equal(preview.versionBefore, 0, 'cache never becomes authoritative cloud data');
                assert.equal(preview.busy, 'true');
                assert.equal(preview.pending, false, 'cached messages are not queued for save: ' + JSON.stringify(preview.pendingIds));
                assert.equal(preview.inert, true, 'cached message actions are disabled until cloud load');
                await page.waitForFunction(() => _cloudConfigReady);
                assert.equal(await page.$('#chatWindow [data-message-id="deleted-remote"]'), null, 'cloud deletion replaces stale display cache');
                assert.equal(await page.evaluate(() => document.getElementById('chatWindow').getAttribute('aria-busy')), 'false');
                assert.equal(requests.filter(endpoint => endpoint === '/api/chat-messages').length, savesBefore);
                assert.deepEqual(errors, []);
                console.log(JSON.stringify({ cachedChatReadyMs: Math.round(preview.ms), cloudDelayMs: syncDelay, deletionAndSaveIsolation: 'passed' }));
                return;
            }
            if (process.argv.includes('--chat-history-only')) {
                await page.evaluate(() => openCommunication());
                await page.waitForSelector('#chatWindow .msg-row');
                await sleep(400);
                await page.evaluate(() => revealEarlierChatMessages());
                const result = await page.evaluate(async () => {
                    const win = document.getElementById('chatWindow');
                    _chatScrollGestureVersion++;
                    win.scrollTop = 120;
                    const before = captureChatScrollAnchor(win);
                    const originalRows = [...win.querySelectorAll('.msg-row')];
                    const parse = marked.parse;
                    let markdownCalls = 0;
                    marked.parse = (...args) => { markdownCalls++; return parse.apply(marked, args); };
                    await revealEarlierChatMessages();
                    marked.parse = parse;
                    const reusedRows = originalRows.every(row => row.isConnected && win.contains(row));
                    const after = captureChatScrollAnchor(win);
                    _historyPrefetches.clear();
                    const originalRequest = ChatPersistence.requestJson;
                    let release, received;
                    const ready = new Promise(resolve => { received = resolve; });
                    ChatPersistence.requestJson = async (url, ...args) => {
                        const data = await originalRequest(url, ...args);
                        if (url.startsWith('/api/chat-history/')) {
                            await new Promise(resolve => { release = resolve; received(); });
                        }
                        return data;
                    };
                    const loading = revealEarlierChatMessages();
                    await Promise.race([ready, new Promise((_, reject) => setTimeout(() => reject(new Error('History request did not start: ' + JSON.stringify({ length: getActiveSession().messages.length, shown: _visibleMessageCounts.main, loading: _historyLoading }))), 3000))]);
                    await resyncAndMerge('test-concurrent-history');
                    release();
                    await loading;
                    ChatPersistence.requestJson = originalRequest;
                    const session = getActiveSession();
                    const total = session.messages.length;
                    win.scrollTop = 120;
                    const reading = captureChatScrollAnchor(win);
                    session.messages.push(...Array.from({ length: 200 }, (_, i) => ({
                        _id: 'new-' + i, role: 'user', content: 'new tail ' + i
                    })));
                    renderChatMessages({ preserveScroll: true });
                    return { before, after, total, reading, reusedRows, markdownCalls, retained: captureChatScrollAnchor(win) };
                });
                assert.ok(result.before.messageId);
                assert.equal(result.after.messageId, result.before.messageId, 'prepend keeps the same message');
                assert.ok(Math.abs(result.after.offset - result.before.offset) < 2, 'prepend keeps reading position');
                assert.equal(result.total, 170, 'history is retained across concurrent sync');
                assert.equal(result.reusedRows, true, 'existing message nodes stay mounted while history is prepended');
                assert.ok(result.markdownCalls <= 40, 'only the new page needs Markdown parsing');
                assert.equal(result.retained.messageId, result.reading.messageId, 'new messages do not hide the reading anchor');
                assert.deepEqual(errors, []);
                console.log('History scroll anchor, concurrent sync and new-tail retention passed.');
                return;
            }
            if (workroomBriefOnly) {
                await verifyWorkroomBrief(page);
                await page.setViewport({ width: 393, height: 852, isMobile: true, hasTouch: true });
                await page.evaluate(() => renderChatMessages());
                await verifyWorkroomBrief(page);
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'brief does not create mobile overflow');
                console.log('Workroom brief starts collapsed, toggles open and closed, and fits the mobile viewport.');
                return;
            }
            assert.equal(await page.evaluate(() => document.querySelector('#starmap')?.dataset.motion || ''), '', 'legacy starfield does not start a permanent paint loop');
            if (frontendReliefOnly) {
                const effects = await page.evaluate(async () => {
                    const html = document.documentElement, previousTheme = html.dataset.visualTheme;
                    html.dataset.visualTheme = 'legacy';
                    triggerStarEffects('我爱沈望', '回应');
                    const canvas = document.querySelector('#starmap'), context = canvas.getContext('2d');
                    const x = Math.round(canvas.width * .5), y = Math.round(canvas.height * .4);
                    const paintedAlpha = context.getImageData(x, y, 1, 1).data[3];
                    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                    const clearedAlpha = context.getImageData(x, y, 1, 1).data[3];
                    html.dataset.visualTheme = previousTheme;
                    return { paintedAlpha, clearedAlpha };
                });
                assert.ok(effects.paintedAlpha > 0, 'message-triggered nebula still paints on demand');
                assert.equal(effects.clearedAlpha, 0, 'one-shot chat effect clears without a permanent frame loop');
                const resonance = await page.evaluate(async () => {
                    const core = document.querySelector('#resonanceCore'), input = document.querySelector('#chatInput');
                    let mutations = 0;
                    const observer = new MutationObserver(records => { mutations += records.length; });
                    observer.observe(core, { attributes: true, attributeFilter: ['class'] });
                    for (let index = 0; index < 20; index++) input.dispatchEvent(new Event('input'));
                    await new Promise(resolve => setTimeout(resolve, 260));
                    observer.disconnect();
                    return { mutations, userTyping: core.classList.contains('user-typing') };
                });
                assert.ok(resonance.mutations <= 4, 'resonance core DOM updates are throttled');
                assert.equal(resonance.userTyping, true, 'trailing input keeps the resonance pulse current');
                const glass = await page.evaluate(async () => {
                    const toastNode = document.querySelector('#toast');
                    const initialToast = getComputedStyle(toastNode).backdropFilter;
                    toastNode.classList.add('show');
                    const visibleToast = getComputedStyle(toastNode).backdropFilter;
                    toastNode.classList.add('is-hiding'); toastNode.classList.remove('show');
                    const closingToast = getComputedStyle(toastNode).backdropFilter;
                    toastNode.classList.remove('is-hiding');
                    await togglePhysioPanel();
                    const panel = document.querySelector('#physioPanel');
                    const openPanel = getComputedStyle(panel).backdropFilter;
                    await togglePhysioPanel();
                    const closingPanel = getComputedStyle(panel).backdropFilter;
                    await new Promise(resolve => setTimeout(resolve, 340));
                    const closedPanel = getComputedStyle(panel).backdropFilter;
                    return { initialToast, visibleToast, closingToast, openPanel, closingPanel, closedPanel };
                });
                assert.equal(glass.initialToast, 'none');
                assert.match(glass.visibleToast, /blur\(12px\)/);
                assert.equal(glass.closingToast, glass.visibleToast, 'toast keeps its glass through the exit animation');
                assert.match(glass.openPanel, /blur\(5px\)/);
                assert.equal(glass.closingPanel, glass.openPanel, 'drawer keeps its glass through the exit animation');
                assert.equal(glass.closedPanel, 'none');
                assert.deepEqual(errors, []);
                console.log('Legacy starfield stays idle, chat effects still paint on demand, resonance updates are throttled, and hidden glass layers stop filtering after exit.');
                return;
            }
            for (const endpoint of ['/api/tools-status', '/api/mcp/servers', '/api/toy-status']) assert.equal(requests.includes(endpoint), false);
            await page.waitForFunction(() => document.querySelector('#modelSelect')?.value === 'fixture-model');
            modelReplyMode = 'slow-error';
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => document.querySelector('#modelSelect')?.value === 'fixture-model');
            assert.equal(await page.evaluate(() => document.querySelector('#modelSelect').title), '正在后台更新模型列表');
            await sleep(1600);
            assert.equal(await page.evaluate(() => document.querySelector('#modelSelect').value), 'fixture-model', 'failed refresh keeps the last successful model list');
            assert.match(await page.evaluate(() => document.querySelector('#modelSelect').title), /上次成功结果/);
            modelReplyMode = 'success';
            const idleMusicChecks = requests.filter(endpoint => endpoint === '/api/music/status').length;
            assert.equal(idleMusicChecks, 2, 'music performs one startup recovery check per page load');
            await sleep(3200);
            assert.equal(requests.filter(endpoint => endpoint === '/api/music/status').length, idleMusicChecks, 'closed idle music panel must not keep polling');
            await page.evaluate(() => window.SyzygyMusic.open());
            await page.waitForFunction(expected => performance.getEntriesByType('resource').filter(entry => entry.name.includes('/api/music/status')).length > expected, {}, idleMusicChecks);
            await page.evaluate(() => { document.querySelector('#syzygy-music').shadowRoot.querySelector('.panel').hidden = true; });
            await verifyWorkroomBrief(page);
            await page.waitForSelector('#chatWindow .msg.sys strong');
            assert.equal(await page.evaluate(() => activeChatId), 'main');
            assert.equal(await page.evaluate(() => chatSessions.find(session => session.id === 'main').messages.length), 80);
            await page.evaluate(() => revealEarlierChatMessages());
            const anchorCheck = await page.evaluate(async () => {
                const win = document.getElementById('chatWindow');
                // Cancel delayed bottom-follow callbacks, then read near the top.
                _chatScrollGestureVersion++;
                win.scrollTop = 120;
                const before = captureChatScrollAnchor(win);
                await revealEarlierChatMessages();
                const after = captureChatScrollAnchor(win);
                return { before, after };
            });
            assert.ok(anchorCheck.before.messageId);
            assert.equal(anchorCheck.after.messageId, anchorCheck.before.messageId, 'prepending history preserves the message being read');
            assert.ok(Math.abs(anchorCheck.after.offset - anchorCheck.before.offset) < 2, 'history keeps the same reading position');
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
            await page.evaluate(() => goView('album'));
            await page.waitForFunction(() => typeof window.albumLoad === 'function' && document.querySelector('#sec-album')?.getAttribute('aria-busy') === null);
            assert.equal(await page.evaluate(() => document.querySelector('#sec-album').classList.contains('active')), true);
            assert.ok(resources.some(url => url.includes('/home-tools.js?v=1')), 'album view loads the secondary script on demand');
            assert.ok(resources.some(url => url.includes('/home-tools.css?v=1')), 'album view loads the secondary stylesheet on demand');
            assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#albumGrid')).display), 'grid');
            await page.evaluate(() => goView('ledger'));
            await page.waitForFunction(() => document.querySelector('#ledgerBalance')?.textContent === '¥12.34');
            await page.evaluate(() => goView('calendar'));
            await page.waitForFunction(() => document.querySelectorAll('#calGrid .cal-cell').length >= 28);
            await page.evaluate(() => goView('state'));
            await page.waitForFunction(() => document.querySelector('#stateView')?.textContent === '还没有记录过状态');
            assert.equal(resources.filter(url => url.includes('/home-tools.js?v=1')).length, 1, 'secondary script loads once across tool pages');
            assert.equal(resources.filter(url => url.includes('/home-tools.css?v=1')).length, 1, 'secondary stylesheet loads once across tool pages');
            console.log('Desktop/mobile navigation, Markdown rendering and on-demand device refresh passed.');
        }
        assert.deepEqual(errors, []);
    } finally {
        if (browser) await browser.close();
        ws.close(); await new Promise(resolve => server.close(resolve));
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
