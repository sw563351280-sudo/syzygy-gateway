'use strict';
// Local synthetic app only: no production data, providers or background jobs.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const express = require('express');
const puppeteer = require('puppeteer-core');
const { WebSocketServer } = require('ws');
const { createChatRequestLifecycle } = require('../chat-request-lifecycle');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
    const app = express(); app.use(express.json());
    let mode = 'waiting', closed = 0, posts = 0;
    const messages = [{ _id: 'seed-user', role: 'user', content: '之前的问题' }, { _id: 'seed-reply', role: 'assistant', content: '之前的回复' }];
    app.get('/api/sync-config', (_req, res) => res.json({ _version: 1, activeChatId: 'main',
        suppliers: [{ name: 'fixture', url: 'https://fixture.invalid/v1', key: 'fixture-key' }],
        chatSessions: [{ id: 'main', name: '测试', messages }] }));
    app.post('/api/sync-config', (_req, res) => res.json({ success: true, _version: 2 }));
    app.post('/api/chat-messages', (_req, res) => res.json({ success: true, _version: 2, inserted: 1, updated: 0 }));
    app.post('/api/fetch-models', (_req, res) => res.json({ data: [{ id: 'fixture-model' }] }));
    app.get('/api/todos', (_req, res) => res.json({ active: [], shen: [], fish: [] }));
    app.get('/api/favorites', (_req, res) => res.json({ favorites: [] }));
    app.get('/api/period', (_req, res) => res.json({ status: { inPeriod: false }, records: [] }));
    app.get('/api/music/status', (_req, res) => res.json({ csrfToken: 'fixture', configured: false, session: { mode: 'local', state: 'idle', offers: [] } }));
    app.get('/api/music/session', (_req, res) => res.json({ mode: 'local', state: 'idle', offers: [] }));
    app.get('/diary-logs', (_req, res) => res.json([]));
    app.post('/v1/chat/completions', (req, res) => {
        posts++;
        const lifecycle = createChatRequestLifecycle(req, res, { heartbeatMs: 30 });
        lifecycle.signal.addEventListener('abort', () => closed++);
        if (!req.body.stream) return; // Delayed JSON fixture: cancelled before response headers.
        lifecycle.startStream();
        const event = content => 'data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\n\n';
        if (mode === 'partial' || mode === 'broken') res.write(event('已经收到的半段回复'));
        if (mode === 'success') res.end(event('正常完整回复') + 'data: ' + JSON.stringify({ syzygy_usage: { total: 29700, read: 29500, write: 200, output: 134 } }) + '\n\ndata: [DONE]\n\n');
        if (mode === 'error') res.end('data: [ERROR]测试供应商错误\n\n');
        if (mode === 'broken') res.end();
    });
    app.use('/api', (_req, res) => res.json({ success: true, tools: {}, servers: [], state: 'disconnected', config: {}, tasks: [], data: [] }));
    app.use(express.static(path.join(__dirname, '../public')));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const sockets = new WebSocketServer({ server });
    let browser;
    try {
        const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => p && fs.existsSync(p));
        browser = await puppeteer.launch({ executablePath, headless: true, args: ['--mute-audio', '--no-sandbox', '--disable-setuid-sandbox'], defaultViewport: { width: 393, height: 852 } });
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.setRequestInterception(true);
        page.on('request', r => r.url().startsWith('http') && !r.url().startsWith('http://127.0.0.1:') ? r.abort() : r.continue());
        await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.getElementById('modelSelect')?.value === 'fixture-model');
        await page.evaluate(() => openCommunication());
        const idle = () => page.waitForFunction(() => !activeChatRequest && !_isStreamingReply);
        const send = async () => {
            const previous = posts;
            await page.type('#chatInput', '测试发送');
            await page.click('#chatSendBtn');
            for (let i = 0; i < 100 && posts === previous; i++) await sleep(20);
            assert.ok(posts > previous, 'message reached fixture gateway');
        };
        const stop = async () => { await page.click('#chatSendBtn'); await idle(); };
        const snapshot = () => page.evaluate(() => ({ messages: structuredClone(getActiveSession().messages), label: document.getElementById('chatSendBtn').getAttribute('aria-label'), text: document.getElementById('chatWindow').innerText }));

        await send();
        assert.equal(await page.$eval('#chatSendBtn', e => e.getAttribute('aria-label')), '停止生成');
        assert.equal(await page.$eval('#chatSendBtn', e => !!e.querySelector('rect')), true);
        const previewDirectory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'syzygy-chat-stop-'));
        await page.screenshot({ path: path.join(previewDirectory, 'generating-mobile.png') });
        await stop();
        let state = await snapshot();
        assert.equal(state.label, '发送消息');
        assert.equal(state.messages.at(-1).role, 'user', 'stop before first token creates no fake failed reply');
        for (let i = 0; i < 30 && closed < 1; i++) await sleep(20);
        assert.equal(closed, 1, 'browser stop reaches server cancellation');

        mode = 'partial'; await send();
        await page.waitForFunction(() => document.getElementById('chatWindow').innerText.includes('半段回复'));
        await stop(); state = await snapshot();
        assert.equal(state.messages.at(-1).versions[0].content, '已经收到的半段回复');
        assert.equal(state.messages.at(-1).versions[0]._interrupted, '已停止生成');
        assert.ok(state.text.includes('已保留部分回复'));

        mode = 'waiting';
        const count = state.messages.at(-1).versions.length;
        await page.evaluate(() => regenerateAt(getActiveSession().messages.length - 1));
        await page.waitForFunction(() => !!activeChatRequest);
        await stop(); state = await snapshot();
        assert.equal(state.messages.at(-1).versions.length, count, 'empty cancelled regeneration preserves original version');

        mode = 'partial';
        await page.evaluate(() => regenerateAt(getActiveSession().messages.length - 1));
        await page.waitForFunction(() => document.querySelector('#chatWindow .typing-cursor'));
        await stop(); state = await snapshot();
        assert.equal(state.messages.at(-1).versions.length, count + 1, 'partial regeneration becomes a separate version');
        assert.equal(state.messages.at(-1).versions.at(-1).content, '已经收到的半段回复');

        mode = 'success'; await send(); await idle(); state = await snapshot();
        assert.equal(state.messages.at(-1).versions[0].content, '正常完整回复');
        assert.equal(state.messages.at(-1).versions[0].messageUsage.read, 29500);
        await page.evaluate(() => renderChatMessages());
        assert.match(await page.$eval('.message-usage summary', el => el.textContent), /命中 29.5k/);
        await page.click('.message-usage summary');
        assert.equal(await page.$eval('.message-usage', el => el.open), true);
        for (const light of [false, true]) {
            await page.evaluate(light => {
                document.body.classList.add('neu-mode');
                document.documentElement.dataset.visualTheme = 'new';
                document.documentElement.dataset.seaCycle = light ? 'day' : 'night';
                document.querySelector('.message-usage').open = false;
                forceScrollToChatBottom();
            }, light);
            await sleep(350);
            const styles = await page.$eval('.message-usage', el => {
                const bubble = el.parentElement.querySelector('.msg');
                return { color: getComputedStyle(el).color, parent: getComputedStyle(bubble).color,
                    opacity: getComputedStyle(el).opacity, fontSize: getComputedStyle(el).fontSize,
                    outside: !el.closest('.msg'), below: el.getBoundingClientRect().top >= bubble.getBoundingClientRect().bottom };
            });
            assert.equal(styles.color, styles.parent);
            assert.equal(styles.opacity, '0.45');
            assert.equal(styles.fontSize, '9px');
            assert.equal(styles.outside, true);
            assert.equal(styles.below, true);
            await page.screenshot({ path: path.join(previewDirectory, light ? 'usage-day.png' : 'usage-night.png') });
        }
        await page.setViewport({ width: 320, height: 740 });
        assert.equal(await page.$eval('.message-usage', el => el.scrollWidth <= el.clientWidth), true);
        await page.evaluate(() => regenerateAt(getActiveSession().messages.length - 1));
        await idle(); state = await snapshot();
        assert.equal(state.messages.at(-1).versions.at(-1).messageUsage.read, 29500);
        console.log('Usage previews: ' + previewDirectory);
        mode = 'error'; await send(); await idle(); state = await snapshot();
        assert.equal(state.messages.at(-1).role, 'user', 'empty transport failures stay temporary and out of chat history');
        assert.match(state.text, /测试供应商错误/);
        mode = 'broken'; await send(); await idle(); state = await snapshot();
        assert.equal(state.messages.at(-1).versions[0].content, '已经收到的半段回复');
        assert.match(state.messages.at(-1).versions[0]._interrupted, /提前断开/);

        await page.evaluate(() => { document.getElementById('streamToggle').checked = false; });
        mode = 'waiting'; const before = closed; await send(); await stop();
        for (let i = 0; i < 30 && closed === before; i++) await sleep(20);
        assert.equal(closed, before + 1, 'non-streaming request can also be stopped');
        await page.screenshot({ path: path.join(previewDirectory, 'idle-mobile.png') });
        await page.setViewport({ width: 1024, height: 900 });
        await page.screenshot({ path: path.join(previewDirectory, 'idle-desktop.png') });
        assert.deepEqual(errors, []);
        console.log('Screenshots: ' + previewDirectory);
        console.log('PASS: mobile send/stop, server cancellation, partial retention, regeneration, success, SSE error, truncated stream, non-streaming cancellation');
    } finally {
        await browser?.close();
        sockets.clients.forEach(socket => socket.terminate()); sockets.close();
        server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
