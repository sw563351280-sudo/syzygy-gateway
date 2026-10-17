'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const puppeteer = require('puppeteer-core');
const { WebSocketServer } = require('ws');

async function main() {
    let version = 3;
    let providerPuts = 0;
    let preferencePuts = 0;
    let lastChatBody = null;
    let suppliers = [{ name: 'fixture', url: 'https://fixture.example/v1', key: 'old-key' }];
    let preferences = { shenReactionEnabled: true };
    const sessions = [{
        id: 'main', name: '主频道', messages: [
            { _id: 'fixture-user', role: 'user', shenReaction: '🐶', versions: [{ content: '旧消息', fullTime: new Date().toISOString() }], activeVersion: 0 },
            { _id: 'fixture-ai', role: 'assistant', versions: [{ content: '旧回复', fullTime: new Date().toISOString() }], activeVersion: 0 }
        ]
    }];
    const app = express();
    app.use(express.json({ limit: '4mb' }));
    app.get('/api/sync-config', (_req, res) => res.json({ _version: version, suppliers, preferences, chatSessions: sessions, activeSupIndex: 0, activeChatId: 'main' }));
    app.put('/api/provider-settings', (req, res) => {
        providerPuts++;
        suppliers = structuredClone(req.body.suppliers);
        res.json({ success: true, _version: ++version, activeSupIndex: req.body.activeSupIndex });
    });
    app.put('/api/chat-preferences', (req, res) => {
        preferencePuts++;
        preferences = { ...preferences, shenReactionEnabled: req.body.shenReactionEnabled };
        res.json({ success: true, _version: ++version, preferences });
    });
    app.post('/api/chat-messages', (req, res) => {
        for (const patch of req.body.sessions || []) {
            const session = sessions.find(item => item.id === patch.id);
            if (!session) continue;
            for (const message of patch.messages || []) {
                const index = session.messages.findIndex(item => item._id === message._id);
                if (index === -1) session.messages.push(structuredClone(message));
                else session.messages[index] = structuredClone(message);
            }
        }
        res.json({ success: true, _version: ++version });
    });
    app.post('/api/sync-config', (req, res) => {
        suppliers = structuredClone(req.body.suppliers || suppliers);
        res.json({ success: true, _version: ++version });
    });
    app.post('/api/fetch-models', (_req, res) => res.json({ data: [{ id: 'fixture-model' }] }));
    app.get('/api/shen-settings', (_req, res) => res.json({ version: 1, settings: { active: 'A', prompts: { A: 'A', B: 'B' }, updatedAt: 'fixture' } }));
    app.post(['/v1/chat/completions', '/via/:platform/v1/chat/completions'], (req, res) => {
        lastChatBody = req.body;
        const sourceMessageId = req.headers['x-message-id'];
        res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '收到啦。' } }] }) + '\n\n');
        res.write('data: ' + JSON.stringify({ type: 'shen_reaction', emoji: '🐾', sourceMessageId }) + '\n\n');
        res.end('data: [DONE]\n\n');
    });
    app.use('/api', (_req, res) => res.json({ success: true, data: [], active: [], shen: [], tools: {}, servers: [] }));
    app.use(express.static(path.join(__dirname, '../public')));

    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const ws = new WebSocketServer({ server });
    let browser;
    const errors = [];
    try {
        const executablePath = [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'].find(item => item && fs.existsSync(item));
        browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'], defaultViewport: { width: 393, height: 852 } });
        const page = await browser.newPage();
        page.on('pageerror', error => errors.push(error.message));
        const origin = 'http://127.0.0.1:' + server.address().port;
        await page.setRequestInterception(true);
        page.on('request', request => request.url().startsWith('http') && !request.url().startsWith(origin) ? request.abort() : request.continue());
        await page.goto(origin, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof _dataVersion !== 'undefined' && _dataVersion >= 3 && chatSessions.length > 0);

        await page.evaluate(() => goView('chat'));
        await page.waitForSelector('.shen-reaction');
        assert.equal(await page.$eval('.shen-reaction', element => element.textContent), '🐶');

        await page.evaluate(() => goView('settings'));
        await page.click('#shenReactionToggle');
        await page.waitForFunction(() => document.getElementById('shenReactionStatus').textContent.includes('已关闭'));
        assert.equal(preferences.shenReactionEnabled, false);
        await page.evaluate(() => goView('chat'));
        assert.equal(await page.$$('.shen-reaction').then(items => items.length), 0);

        await page.evaluate(() => goView('settings'));
        await page.click('#shenReactionToggle');
        await page.waitForFunction(() => document.getElementById('shenReactionStatus').textContent.includes('已开启'));
        await page.evaluate(() => goView('chat'));
        await page.waitForSelector('.shen-reaction');

        await page.evaluate(() => goView('shen-settings'));
        await page.waitForFunction(() => document.querySelectorAll('#supplierList .supplier-card').length === 1);
        await page.evaluate(() => editSupplier(0));
        await page.$eval('#supEditKey-0', input => { input.value = 'new-key'; });
        await page.evaluate(() => saveEditSupplier(0));
        await page.waitForFunction(() => suppliers[0].key === 'new-key' && !providerSettingsSaving);
        assert.equal(suppliers[0].key, 'new-key');
        assert.equal(providerPuts, 1);

        await page.evaluate(() => {
            goView('chat');
            document.getElementById('chatInput').value = '新消息';
            sendChat();
        });
        await page.waitForFunction(() => {
            const session = chatSessions.find(item => item.id === 'main');
            return session.messages.some(message => message.role === 'user' && message.shenReaction === '🐾');
        });
        const state = await page.evaluate(() => {
            const session = chatSessions.find(item => item.id === 'main');
            const user = [...session.messages].reverse().find(message => message.role === 'user');
            const assistant = [...session.messages].reverse().find(message => message.role === 'assistant');
            return { reaction: user.shenReaction, userId: user._id, assistant: getActiveVersion(assistant).content, rendered: [...document.querySelectorAll('.shen-reaction')].map(item => item.textContent) };
        });
        assert.equal(state.reaction, '🐾');
        assert.equal(state.assistant, '收到啦。');
        assert.ok(state.rendered.includes('🐾'));
        await page.screenshot({ path: '/tmp/syzygy-reaction-smoke.png', fullPage: false });
        assert.equal(lastChatBody.shenReactionEnabled, true);
        assert.ok(lastChatBody.messages.every(message => !String(message.content).includes('<REACT:')));
        assert.equal(preferencePuts, 2);
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ providerPuts, preferencePuts, reaction: state.reaction, keyPersisted: suppliers[0].key === 'new-key', pageErrors: errors }));
    } finally {
        if (browser) await browser.close();
        ws.close();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
