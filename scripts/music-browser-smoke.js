'use strict';

// Isolated browser verification: only synthetic songs/audio; no user account,
// existing runtime data, real gateway jobs, or remote music requests are used.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const express = require('express');
const puppeteer = require('puppeteer-core');
const { createMusic } = require('../music');

async function main() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'syzygy-music-browser-'));
    const output = path.resolve(__dirname, '../../tmp/music-qa');
    fs.mkdirSync(output, { recursive: true });
    let qrCount = 0;
    let failQr = false;
    const song = sid => ({ id: String(sid), name: sid === '1' ? '晚风留声' : '海边来信', artist: '测试歌手', album: '共听测试', provider: 'netease', duration: 20000 });
    const music = createMusic({ directory, secret: 'browser-test-secret', provider: {
        status: () => ({ configured: true, userLoggedIn: true, companionLoggedIn: true }),
        search: async () => [song('1'), song('2')], detail: async sid => song(String(sid)), audio: async () => 'mock-verified-audio',
        playlist: async () => ({ id: '7', name: '晚安之前', tracks: [song('1'), song('2')] }),
        api: async (route, params) => {
            if (route === '/login/qr/key') {
                if (failQr) throw new Error('Temporary QR service failure');
                return { code: 200, data: { unikey: `qr-${++qrCount}` } };
            }
            if (route === '/login/qr/create') return { code: 200, data: { qrimg: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9l0AAAAASUVORK5CYII=' } };
            if (route === '/login/qr/check') return { code: params.key === 'qr-1' ? 800 : 801 };
            if (route === '/lyric') return { code: 200, lrc: { lyric: '[00:00.00] 今晚的风，替我们记得\n[00:08.00] 把一首歌，留给此刻' } };
            if (route === '/msg/private/history') return { code: 200, msgs: [{ time: Date.now(), msg: { generalMsg: { nativeUrl: 'orpheus://listenTogether?roomId=test-room&inviterId=7' } } }] };
            if (route === '/listentogether/sync/playlist/get') return { code: 200, data: { playCommand: { targetSongId: '2', playStatus: 'PLAY' } } };
            return { code: 200 };
        }, check: value => value, setCookie() {},
    } });
    const app = express(); app.use(express.json());
    const frames = 8000 * 20;
    const wav = Buffer.alloc(44 + frames * 2);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(frames * 2, 40);
    for (let i = 0; i < frames; i++) wav.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 220 / 8000) * 100), 44 + i * 2);
    app.get('/api/music/stream/:id', (req, res) => { res.type('audio/wav'); res.send(wav); });
    app.get('/api/music/cover/:id', (req, res) => { res.type('image/svg+xml').send('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#869d9a"/><circle cx="50" cy="50" r="27" fill="#d8d8b8"/><circle cx="50" cy="50" r="7" fill="#869d9a"/></svg>'); });
    app.use('/api/music', music.router);
    app.use(express.static(path.resolve(__dirname, '../public')));
    app.get('/music-qa', (req, res) => res.send('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>一起听 · 本地验证</title><body style="background:#e8eff0;font:16px system-ui;color:#526d7b;padding:40px"><h1>溯星小屋 · 一起听</h1><p>本页使用合成音频和测试歌曲验证播放器。</p><div id="cards"></div><script src="/music-player.js"></script></body></html>'));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    console.log('Music fixture is listening; launching headless browser');
    let browser;
    try {
        const candidates = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'];
        const executablePath = candidates.find(p => p && fs.existsSync(p));
        if (!executablePath) throw new Error('Set CHROME_PATH to an installed Chromium executable');
        browser = await puppeteer.launch({ executablePath, headless: true, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'], defaultViewport: { width: 1280, height: 900 } });
        const page = await browser.newPage();
        await page.evaluateOnNewDocument(() => {
            window.audioContextCount = 0;
            const NativeContext = window.AudioContext;
            window.AudioContext = class extends NativeContext {
                constructor(...args) { super(...args); window.audioContextCount++; }
            };
            window.mediaActions = {};
            const setActionHandler = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
            navigator.mediaSession.setActionHandler = (name, handler) => {
                window.mediaActions[name] = handler;
                setActionHandler(name, handler);
            };
        });
        console.log('Browser launched');
        const errors = []; page.on('pageerror', error => { errors.push(error.message); console.error('Page error:', error.message); });
        const url = `http://127.0.0.1:${server.address().port}/music-qa`;
        await page.goto(url);
        console.log('Preview loaded');
        await page.waitForFunction(() => Boolean(window.SyzygyMusic));
        const click = (selector, target = page) => target.evaluate(s => document.querySelector('#syzygy-music').shadowRoot.querySelector(s).click(), selector);
        const waitState = state => page.waitForFunction(async expected => (await (await fetch('/api/music/status')).json()).session?.state === expected, { polling: 250 }, state);
        await click('.launcher');
        await page.evaluate(() => {
            const r = document.querySelector('#syzygy-music').shadowRoot;
            r.querySelector('.search input').value = '晚风'; r.querySelector('.search').requestSubmit();
        });
        try { await page.waitForFunction(() => document.querySelector('#syzygy-music').shadowRoot.querySelectorAll('.search-results .track').length === 2, { timeout: 5000 }); }
        catch (e) { console.log(await page.evaluate(() => document.querySelector('#syzygy-music').shadowRoot.querySelector('.notice').textContent)); throw e; }
        await click('.search-results .track');
        await waitState('play');
        console.log('Synthetic audio is playing');
        assert.equal(music.status().session.active, true);
        assert.equal(await page.evaluate(() => window.audioContextCount), 0, 'native audio must not depend on a background-suspended AudioContext');
        assert.equal(await page.evaluate(() => document.querySelector('#syzygy-music').shadowRoot.querySelector('.panel audio')), null);
        await click('.launcher');
        const background = await browser.newPage();
        await background.bringToFront();
        const backgroundTime = await page.evaluate(() => document.querySelector('#syzygy-music').shadowRoot.querySelector('audio').currentTime);
        await new Promise(resolve => setTimeout(resolve, 1200));
        assert.equal(await page.evaluate(() => document.hidden), true);
        assert.ok(await page.evaluate(() => document.querySelector('#syzygy-music').shadowRoot.querySelector('audio').currentTime) > backgroundTime + 0.5, 'hidden panel and background tab must keep playing');
        await background.close(); await page.bringToFront(); await click('.launcher');
        await click('[data-action="toggle"]'); await waitState('pause');
        const pausedTime = await page.evaluate(() => document.querySelector('#syzygy-music').shadowRoot.querySelector('audio').currentTime);
        await new Promise(resolve => setTimeout(resolve, 1200));
        assert.equal(await page.evaluate(() => document.querySelector('#syzygy-music').shadowRoot.querySelector('audio').currentTime), pausedTime, 'pause must freeze the audio clock');
        await click('[data-action="toggle"]'); await waitState('play');

        await page.evaluate(() => { window.mediaActions.pause(); window.mediaActions.pause(); });
        await waitState('pause');
        assert.equal(await page.evaluate(() => document.querySelector('#syzygy-music').shadowRoot.querySelector('audio').paused), true, 'repeated lock-screen pause must never toggle playback back on');
        await page.evaluate(() => { window.mediaActions.play(); window.mediaActions.play(); });
        await waitState('play');

        // Hold a completed claim response: pausing during preparation must win
        // over the earlier play request when that response eventually arrives.
        await page.evaluate(() => {
            const nativeFetch = window.fetch;
            window.fetch = async (...args) => {
                const response = await nativeFetch(...args);
                if (String(args[0]).endsWith('/session/event') && JSON.parse(args[1]?.body || '{}').type === 'claim') {
                    window.claimWaiting = true;
                    await new Promise(resolve => { window.releaseClaim = resolve; });
                    window.fetch = nativeFetch;
                }
                return response;
            };
        });
        await click('.search-results .track');
        await page.waitForFunction(() => window.claimWaiting);
        await click('[data-action="toggle"]');
        await page.evaluate(() => window.releaseClaim());
        await new Promise(resolve => setTimeout(resolve, 400));
        assert.equal(await page.evaluate(() => document.querySelector('#syzygy-music').shadowRoot.querySelector('audio').paused), true, 'late claim must not restart paused audio');
        await click('[data-action="toggle"]'); await waitState('play');
        for (let i = 0; i < 3; i++) {
            await click('[data-action="toggle"]');
            await click('[data-action="toggle"]');
        }
        await click('[data-action="toggle"]'); await waitState('pause');
        assert.equal(await page.evaluate(() => navigator.mediaSession.playbackState), 'paused');
        await click('[data-action="toggle"]'); await waitState('play');

        // A failed metadata/status poll must not interrupt the native audio.
        await page.setRequestInterception(true);
        const failStatus = request => request.url().endsWith('/api/music/status') ? request.abort() : request.continue();
        page.on('request', failStatus);
        await page.waitForFunction(() => document.querySelector('#syzygy-music').shadowRoot.querySelector('.notice').textContent.includes('状态同步暂时中断'), { timeout: 8000 });
        assert.equal(await page.evaluate(() => document.querySelector('#syzygy-music').shadowRoot.querySelector('audio').paused), false);
        page.off('request', failStatus);
        await page.setRequestInterception(false);
        console.log('Native output, hidden/background playback, system controls, delayed-claim cancellation, rapid pause/resume and transient status failure passed');
        await click('[data-action="open-lyrics"]');
        await page.waitForFunction(() => !document.querySelector('#syzygy-music').shadowRoot.querySelector('.lyrics-view').hidden);
        await page.waitForFunction(() => document.querySelector('#syzygy-music').shadowRoot.querySelector('.lyrics').textContent.includes('今晚的风'));
        await click('[data-action="close-lyrics"]');
        await page.screenshot({ path: path.join(output, 'desktop.png') });

        // Cross-tab takeover must silence the first audio element without letting
        // its passive pause overwrite the new owner on the server.
        const second = await browser.newPage(); await second.goto(url);
        await second.waitForFunction(() => Boolean(window.SyzygyMusic));
        await second.evaluate(() => window.SyzygyMusic.play('2'));
        await second.waitForFunction(() => !document.querySelector('#syzygy-music').shadowRoot.querySelector('audio').paused);
        await page.waitForFunction(() => document.querySelector('#syzygy-music').shadowRoot.querySelector('audio').paused);
        assert.equal(music.status().session.song.id, '2');
        await second.close();
        console.log('Cross-tab takeover passed');
        await page.bringToFront();

        await click('[data-tab="playlists"]');
        await page.evaluate(() => { const r = document.querySelector('#syzygy-music').shadowRoot; r.querySelector('.import input').value = '7'; r.querySelector('.import').requestSubmit(); });
        await page.waitForFunction(() => document.querySelector('#syzygy-music').shadowRoot.querySelector('.library summary')?.textContent.includes('晚安之前'));
        await click('.library summary'); await click('.library details > button'); await waitState('play');
        await page.evaluate(() => { const audio = document.querySelector('#syzygy-music').shadowRoot.querySelector('audio'); audio.currentTime = audio.duration - 0.1; });
        await page.waitForFunction(async () => { const s = (await (await fetch('/api/music/status')).json()).session; return s?.song?.id === '2' && s.state === 'play'; }, { polling: 250 });
        await click('[data-action="previous"]');
        await page.waitForFunction(async () => { const s = (await (await fetch('/api/music/status')).json()).session; return s?.song?.id === '1' && s.state === 'play'; }, { polling: 250 });
        await click('[data-action="next"]');
        await page.waitForFunction(async () => { const s = (await (await fetch('/api/music/status')).json()).session; return s?.song?.id === '2' && s.state === 'play'; }, { polling: 250 });
        await click('[data-action="settings-toggle"]'); await click('[data-action="stop"]'); await waitState('closed');
        await page.reload();
        console.log('Queue and reload checks passed');
        await page.waitForFunction(() => Boolean(window.SyzygyMusic));
        assert.equal(await page.evaluate(() => document.querySelector('#syzygy-music').shadowRoot.querySelector('audio').paused), true);

        await click('.launcher');
        await click('[data-action="settings-toggle"]');
        await click('[data-mode="netease-room"]');
        await page.evaluate(() => { document.querySelector('#syzygy-music').shadowRoot.querySelector('.partner').value = '7'; });
        await click('[data-action="join"]');
        await page.waitForFunction(async () => { const s = (await (await fetch('/api/music/status')).json()).session; return s?.mode === 'netease-room' && s.state === 'play'; }, { polling: 250 });
        assert.equal(await page.evaluate(() => document.querySelector('#syzygy-music').shadowRoot.querySelector('audio').paused), true);
        await page.setViewport({ width: 390, height: 844, isMobile: true, deviceScaleFactor: 1 });
        await page.waitForFunction(() => Boolean(window.SyzygyMusic));
        await page.evaluate(() => window.SyzygyMusic.open());
        await page.waitForFunction(() => document.querySelector('#syzygy-music').shadowRoot.querySelector('.state').textContent.includes('网易云一起听'));
        await page.screenshot({ path: path.join(output, 'mobile-room.png') });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
        await click('[data-action="leave"]'); await waitState('closed');
        assert.equal(music.status().session.mode, 'local');

        await click('[data-action="settings-toggle"]');
        await click('[data-login="companion"]');
        await page.waitForFunction(() => document.querySelector('#syzygy-music').shadowRoot.querySelector('.qr-status').textContent.includes('已过期'));
        await click('[data-action="refresh-qr"]');
        await page.waitForFunction(() => document.querySelector('#syzygy-music').shadowRoot.querySelector('.qr-status').textContent === '等待扫码');
        assert.equal(qrCount, 2, 'expired challenge replaced with a new key');
        failQr = true;
        await click('[data-action="refresh-qr"]');
        await page.waitForFunction(() => document.querySelector('#syzygy-music').shadowRoot.querySelector('.qr-status').textContent.includes('生成失败'));
        failQr = false;
        await click('[data-action="refresh-qr"]');
        await page.waitForFunction(() => document.querySelector('#syzygy-music').shadowRoot.querySelector('.qr-status').textContent === '等待扫码');
        assert.equal(qrCount, 3, 'retry remains usable after a generation failure');
        assert.equal(await page.evaluate(() => document.querySelector('#syzygy-music').shadowRoot.querySelector('h2').textContent), '耳机分你一只。');
        console.log('QR expiry refresh and failed-generation retry passed');

        // Exercise the real chat-card renderer with untrusted metadata.
        const source = fs.readFileSync(path.resolve(__dirname, '../public/script.js'), 'utf8');
        const start = source.indexOf('function renderToolCallGroupHTML(');
        const end = source.indexOf('function updateToolGroupDOM(', start);
        await page.addScriptTag({ content: `function escHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}\n${source.slice(start, end)}` });
        const safety = await page.evaluate(() => {
            const result = { status: 'ready', song: { provider: 'netease', id: '1', name: '<img src=x onerror="window.musicXSS=true">', artist: 'test', playable: true }, attachment: { song_id: '1' } };
            document.querySelector('#cards').innerHTML = renderToolCallGroupHTML([{ name: 'music_search_and_play', result: JSON.stringify(result) }], false);
            return { count: document.querySelectorAll('[data-music-song]').length, image: document.querySelector('#cards img') !== null, xss: Boolean(window.musicXSS) };
        });
        assert.deepEqual(safety, { count: 1, image: false, xss: false });
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ ok: true, verified: ['search', 'real audio play/pause', 'lyrics', 'cross-tab takeover', 'playlist import', 'queue next', 'no autoplay on reload', 'native room mode', 'mobile layout', 'chat card escaping'], screenshots: output }));
    } catch (error) {
        console.error('Browser check failed:', error);
        throw error;
    } finally {
        await browser?.close(); music.dispose(); server.closeAllConnections(); server.close();
        fs.rmSync(directory, { recursive: true, force: true });
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
