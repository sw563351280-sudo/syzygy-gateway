'use strict';

// Bounded anonymous connectivity probe. It does not log in, join a room,
// persist user data, or print cookies / resolved media URLs.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { createProvider, validateMedia } = require('../music-provider');
const express = require('express');
const { streamMedia } = require('../music-provider');

async function main() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'syzygy-music-probe-'));
    const listener = net.createServer().listen(0, '127.0.0.1');
    await new Promise(resolve => listener.once('listening', resolve));
    const port = listener.address().port;
    await new Promise(resolve => listener.close(resolve));
    const child = spawn(process.execPath, ['start.js'], { cwd: path.resolve(__dirname, '../tools/music-api'),
        env: { ...process.env, NCM_SERVICE_PORT: String(port), NCM_STATE_DIR: directory, TEMP: directory, TMP: directory, TMPDIR: directory }, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
    let childError = false;
    child.on('error', () => { childError = true; });
    const results = { startup: false, search: false, detail: false, lyrics: false, fullAudio: false, qr: false };
    try {
        const base = `http://127.0.0.1:${port}`;
        for (let i = 0; i < 45; i++) {
            if (childError || child.exitCode !== null) throw new Error('Compatibility service exited during startup');
            try { const r = await fetch(base + '/inner/version', { signal: AbortSignal.timeout(1000) }); if (r.ok) { results.startup = true; break; } } catch {}
            await delay(1000);
        }
        if (!results.startup) throw new Error('Compatibility service did not start within 45 seconds');
        console.log('Compatibility service started on loopback; checking anonymous endpoints');
        const provider = createProvider({ directory, secret: 'temporary-probe-only', base });
        const songs = await provider.search('晴天 周杰伦', 3);
        results.search = songs.length > 0;
        if (songs[0]) {
            const detail = await provider.detail(songs[0].id);
            results.detail = Boolean(detail.name);
            const lyric = await provider.api('/lyric', { id: detail.id });
            results.lyrics = Boolean(lyric.lrc?.lyric);
            try { await validateMedia(await provider.audio(detail.id, 'smooth')); results.fullAudio = true; }
            catch (e) { results.audioStatus = e.code || 'UNAVAILABLE'; }
            if (results.fullAudio) {
                const media = await provider.audio(detail.id, 'smooth');
                const app = express();
                app.get('/stream', (req, res) => streamMedia(media, req, res).catch(() => { if (!res.headersSent) res.sendStatus(502); else res.destroy(); }));
                const proxy = app.listen(0, '127.0.0.1');
                await new Promise(resolve => proxy.once('listening', resolve));
                try {
                    const response = await fetch(`http://127.0.0.1:${proxy.address().port}/stream`, { headers: { Range: 'bytes=0-1023' }, signal: AbortSignal.timeout(20000) });
                    const bytes = await response.arrayBuffer();
                    results.range = response.status === 206 && Boolean(response.headers.get('content-range')) && bytes.byteLength === 1024;
                } finally { proxy.closeAllConnections(); proxy.close(); }
            }
        }
        // Generate an unclaimed QR to verify the endpoint; never print its key/image.
        const qr = await provider.api('/login/qr/key');
        if (qr.data?.unikey) {
            const image = await provider.api('/login/qr/create', { key: qr.data.unikey, qrimg: true });
            results.qr = /^data:image\/png;base64,/.test(image.data?.qrimg || '');
        }
    } catch (e) { results.error = e.code || e.message; }
    finally {
        if (child.exitCode === null) { child.kill(); await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(3000)]); }
        if (child.exitCode !== null || childError) fs.rmSync(directory, { recursive: true, force: true });
    }
    console.log(JSON.stringify(results));
    if (!results.startup || !results.search) process.exitCode = 1;
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
