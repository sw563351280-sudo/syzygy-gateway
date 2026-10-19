'use strict';
// Synthetic localhost fixtures only; no provider calls or real chat data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const express = require('express');
const puppeteer = require('puppeteer-core');
const { WebSocketServer } = require('ws');
const baseline = process.argv.includes('--baseline');
async function main() {
    const app = express();
    app.use(express.json());
    app.get('/api/sync-config', (_req, res) => res.json({ _version: 1, suppliers: [], activeChatId: 'main', chatSessions: [{ id: 'main', name: 'fixture', messages: [] }] }));
    app.get('/api/music/status', (_req, res) => res.json({ configured: false, session: { mode: 'local', state: 'idle', offers: [] } }));
    app.use('/api', (_req, res) => res.json({ success: true, data: [], tasks: [], favorites: [], briefs: [], tools: {}, servers: [], config: {} }));
    if (baseline) app.get('/script.js', (_req, res) => res.type('js').send(execFileSync('git', ['show', '67763e0:public/script.js'], { cwd: path.join(__dirname, '..') })));
    app.use(express.static(path.join(__dirname, '../public')));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const ws = new WebSocketServer({ server });
    let browser;
    try {
        const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(p => p && fs.existsSync(p));
        browser = await puppeteer.launch({ executablePath, headless: true, defaultViewport: { width: 393, height: 852 } });
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const origin = 'http://127.0.0.1:' + server.address().port;
        await page.setRequestInterception(true);
        page.on('request', req => req.url().startsWith('http') && !req.url().startsWith(origin) ? req.abort() : req.continue());
        await page.goto(origin, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof _dataVersion !== 'undefined' && _dataVersion > 0);
        // Slow the CPU to expose repeated work on a mobile-sized viewport.
        const client = await page.target().createCDPSession();
        await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        const metrics = await page.evaluate(async () => {
            const marker = createThinkingMarker('');
            document.body.appendChild(marker.element);
            const startThinking = performance.now();
            for (let i = 0; i < 200; i++) marker.update(('synthetic reasoning\n').repeat(2000) + i);
            const thinkingMs = performance.now() - startThinking;
            const collapsedBytes = marker.detail.innerHTML.length;
            marker.element.querySelector('button').click();
            const openedLatest = marker.detail.textContent.endsWith('199');
            marker.update('updated while open <safe>');
            const liveThinking = marker.detail.textContent === 'updated while open <safe>';
            marker.element.querySelector('button').click();
            marker.update('latest after closing');
            marker.element.querySelector('button').click();
            const reopenedLatest = marker.detail.textContent === 'latest after closing';
            marker.element.remove();

            const room = ensureWorkroomSession();
            activeChatId = room.id;
            document.body.dataset.view = 'chat';
            document.getElementById('sec-chat').classList.add('active');
            workroomCodexTurnId = 'fixture-turn';
            workroomCodexTimeline = [];
            workroomCodexReply = '';
            workroomCodexSavedForTurn = false;
            let paints = 0;
            const original = workroomCodexTimelineHTML;
            workroomCodexTimelineHTML = (...args) => { paints++; return original(...args); };
            const start = performance.now();
            for (let i = 0; i < 200; i++) {
                workroomAppendCodexText('synthetic stream ' + i + '\n');
                workroomUpdateLiveReply();
            }
            const burstMs = performance.now() - start;
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const burstPaints = paints;
            const latestVisible = workroomCodexLiveBubble.textContent.includes('synthetic stream 199');
            document.getElementById('sec-chat').classList.remove('active');
            for (let i = 0; i < 100; i++) { workroomAppendCodexText('hidden update\n'); workroomUpdateLiveReply(); }
            await new Promise(resolve => requestAnimationFrame(resolve));
            const hiddenPaints = paints - burstPaints;
            document.getElementById('sec-chat').classList.add('active');
            workroomUpdateLiveReply();
            await new Promise(resolve => requestAnimationFrame(resolve));
            const returnCaughtUp = workroomCodexLiveBubble.textContent.includes('hidden update');
            // A completed turn must not be recreated by a previously queued paint.
            workroomAppendCodexText('completed tail');
            workroomUpdateLiveReply();
            workroomSaveCodexReply();
            workroomUpdateLiveReply(); // Returning to the tab after completion.
            await new Promise(resolve => requestAnimationFrame(resolve));
            const finalSaved = room.messages.some(m => m.versions?.[0]?.content.includes('completed tail'));
            const duplicateLiveBubble = Boolean(workroomCodexLiveBubble?.isConnected);
            return { thinkingMs, collapsedBytes, openedLatest, liveThinking, reopenedLatest, burstMs, burstPaints, latestVisible, hiddenPaints, returnCaughtUp, finalSaved, duplicateLiveBubble };
        });
        assert.deepEqual(errors, []);
        for (const key of ['openedLatest', 'liveThinking', 'reopenedLatest', 'latestVisible', 'returnCaughtUp', 'finalSaved']) assert.equal(metrics[key], true, key);
        if (!baseline) {
            assert.equal(metrics.collapsedBytes, 0);
            assert.equal(metrics.burstPaints, 1);
            assert.equal(metrics.hiddenPaints, 0);
            assert.equal(metrics.duplicateLiveBubble, false);
        }
        console.log(JSON.stringify({ baseline, cpuSlowdown: 4, ...metrics, pageErrors: errors }));
    } finally {
        if (browser) await browser.close();
        ws.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
