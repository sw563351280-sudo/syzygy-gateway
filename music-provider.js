'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');

function fail(code, message, status = 400) { return Object.assign(new Error(message), { code, status }); }
function id(value) {
    const result = String(value ?? '');
    if (!/^\d{1,20}$/.test(result)) throw fail('INVALID_ID', '歌曲、歌单或账号 ID 无效');
    return result;
}
function song(value) {
    return { provider: 'netease', id: id(value.id), name: String(value.name || '').slice(0, 160),
        artist: (value.ar || value.artists || []).map(a => a.name).join(' / ').slice(0, 200),
        album: String((value.al || value.album || {}).name || '').slice(0, 160),
        duration: Number(value.dt || value.duration || 0), cover: `/api/music/cover/${id(value.id)}` };
}
function playlistId(value) {
    if (/^\d{1,20}$/.test(String(value))) return id(value);
    let url;
    try { url = new URL(String(value)); } catch { throw fail('INVALID_PLAYLIST', '请输入网易云歌单 ID 或完整歌单链接'); }
    if (!['https:', 'http:'].includes(url.protocol) || !['music.163.com', 'y.music.163.com'].includes(url.hostname)) throw fail('INVALID_PLAYLIST', '仅支持网易云完整歌单链接，请使用歌单 ID 代替短链接');
    const fragment = url.hash.replace(/^#\/?/, '/');
    const target = fragment.includes('?') ? new URL(fragment, url.origin) : url;
    if (!/playlist/.test(target.pathname)) throw fail('INVALID_PLAYLIST', '这不是歌单链接');
    return id(target.searchParams.get('id'));
}

function createProvider({ directory, secret, base = process.env.NCM_API_BASE, fetchImpl = global.fetch }) {
    const credentialFile = path.join(directory, 'credentials.enc');
    const key = crypto.createHash('sha256').update(secret).digest();
    let credentials = { user: '', companion: '' };
    try {
        const bytes = fs.readFileSync(credentialFile);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
        decipher.setAuthTag(bytes.subarray(12, 28));
        credentials = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
    } catch (e) { if (e.code !== 'ENOENT') throw fail('CREDENTIALS_INVALID', '音乐登录信息无法解密，请检查 SESSION_SECRET', 503); }
    // Environment credentials are initial seeds only; saved logout must stay logged out.
    if (!fs.existsSync(credentialFile)) {
        credentials.user = process.env.NCM_COOKIE || '';
        credentials.companion = process.env.NCM_COMPANION_COOKIE || '';
    }
    function setCookie(profile, cookie) {
        if (!['user', 'companion'].includes(profile)) throw fail('INVALID_PROFILE', '账号类型无效');
        const next = { ...credentials, [profile]: String(cookie || '') };
        const nonce = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
        const encrypted = Buffer.concat([cipher.update(JSON.stringify(next)), cipher.final()]);
        const tmp = credentialFile + '.' + crypto.randomUUID() + '.tmp';
        fs.writeFileSync(tmp, Buffer.concat([nonce, cipher.getAuthTag(), encrypted]), { mode: 0o600 });
        fs.renameSync(tmp, credentialFile);
        credentials = next;
    }
    async function api(route, params = {}, profile = 'user', signal) {
        if (!base) throw fail('NOT_CONFIGURED', '请先在服务端配置 NCM_API_BASE 音乐服务地址', 503);
        const url = new URL(route, String(base).replace(/\/$/, '') + '/');
        if (!['http:', 'https:'].includes(url.protocol)) throw fail('INVALID_API', '音乐服务地址无效', 503);
        const timeout = AbortSignal.timeout(12000);
        const controller = new AbortController();
        const abort = () => controller.abort();
        timeout.addEventListener('abort', abort, { once: true });
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) controller.abort();
        try {
            const response = await fetchImpl(url, { method: 'POST', redirect: 'error', signal: controller.signal,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...params, timeout: 10000, cookie: credentials[profile] || '', timestamp: Date.now() }) });
            const text = await response.text();
            if (text.length > 4 * 1024 * 1024) throw fail('UPSTREAM_TOO_LARGE', '音乐服务响应过大', 502);
            let data;
            try { data = JSON.parse(text); } catch { throw fail('UPSTREAM_INVALID', '音乐服务响应格式无效', 502); }
            // QR polling and room heartbeat have intentional non-200 business codes.
            if (!response.ok && !data.code) throw fail('UPSTREAM_ERROR', '音乐服务暂时无法连接', 502);
            return data;
        } catch (e) {
            if (e.code && e.status) throw e;
            throw fail('UPSTREAM_UNAVAILABLE', '音乐服务连接失败或超时', 502);
        } finally { timeout.removeEventListener('abort', abort); signal?.removeEventListener('abort', abort); }
    }
    function check(data) {
        if (Number(data.code ?? data.data?.code) !== 200) throw fail('UPSTREAM_REJECTED', '音乐服务拒绝请求，请检查登录状态', 502);
        return data;
    }
    async function detail(songId, signal) {
        const data = check(await api('/song/detail', { ids: id(songId) }, 'user', signal));
        if (!data.songs?.[0]) throw fail('NOT_FOUND', '歌曲不存在或已下架', 404);
        return song(data.songs[0]);
    }
    async function search(query, limit = 10, signal) {
        if (typeof query !== 'string' || !query.trim() || query.length > 200) throw fail('INVALID_QUERY', '请输入 1–200 字的歌名或歌手');
        const data = check(await api('/cloudsearch', { keywords: query.trim(), type: 1, limit: Math.min(30, Math.max(1, limit)) }, 'user', signal));
        return (data.result?.songs || []).map(song);
    }
    async function audio(songId, quality = 'high', signal) {
        id(songId);
        const levels = quality === 'smooth' ? ['standard', 'exhigh'] : ['lossless', 'exhigh', 'standard'];
        for (const level of levels) {
            const data = await api('/song/url/v1', { id: songId, level }, 'user', signal);
            const item = data.data?.[0];
            if (item?.url && !item.freeTrialInfo) return item.url;
            if (signal?.aborted) break;
        }
        throw fail('AUDIO_UNAVAILABLE', '暂时没有完整可播放音源，可能受登录、会员或地区限制', 404);
    }
    async function playlist(value) {
        const pid = playlistId(value);
        const data = check(await api('/playlist/detail', { id: pid }));
        const p = data.playlist;
        if (!p) throw fail('NOT_FOUND', '歌单不存在', 404);
        let tracks = p.tracks || [];
        const missing = (p.trackIds || []).slice(0, 200).map(t => String(t.id)).filter(sid => !tracks.some(t => String(t.id) === sid));
        for (let start = 0; start < missing.length; start += 50) {
            const more = check(await api('/song/detail', { ids: missing.slice(start, start + 50).join(',') }));
            tracks.push(...(more.songs || []));
        }
        return { id: pid, name: String(p.name || '').slice(0, 160), ownerId: String(p.creator?.userId || ''), tracks: tracks.slice(0, 200).map(song), updatedAt: Date.now() };
    }
    return { api, check, detail, search, audio, playlist, setCookie,
        status: () => ({ configured: Boolean(base), userLoggedIn: Boolean(credentials.user), companionLoggedIn: Boolean(credentials.companion) }) };
}

function publicAddress(address) {
    if (net.isIP(address) === 4) {
        const [a, b] = address.split('.').map(Number);
        return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
            (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 168].includes(b)) ||
            (a === 198 && [18, 19, 51].includes(b)) || (a === 203 && b === 0));
    }
    return net.isIP(address) === 6 && /^[23][\da-f]{3}:/i.test(address) && !/^200[12]:/i.test(address);
}
async function validateMedia(value, lookup = dns.lookup) {
    let url;
    try { url = new URL(value); } catch { throw fail('INVALID_MEDIA', '音源地址无效', 502); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port ||
        !(url.hostname.endsWith('.music.126.net') || url.hostname.endsWith('.music.163.com'))) throw fail('BLOCKED_MEDIA', '音乐服务返回了不受信任的媒体地址', 502);
    const records = await lookup(url.hostname, { all: true });
    if (!records.length || records.some(r => !publicAddress(r.address))) throw fail('BLOCKED_MEDIA', '媒体地址不可访问', 502);
    return { url, address: records[0] };
}
async function streamMedia(value, req, res, hops = 0) {
    if (hops > 3) throw fail('MEDIA_REDIRECT', '媒体重定向次数过多', 502);
    const { url, address } = await validateMedia(value);
    if (res.destroyed) return;
    return new Promise((resolve, reject) => {
        const headers = { Referer: 'https://music.163.com/', 'User-Agent': 'Mozilla/5.0', 'Accept-Encoding': 'identity' };
        if (req.headers.range) {
            if (!/^bytes=\d*-\d*$/.test(req.headers.range)) return reject(fail('INVALID_RANGE', '无效音频范围', 416));
            headers.Range = req.headers.range;
        }
        const request = (url.protocol === 'https:' ? https : http).get(url, { headers,
            lookup: (_host, options, cb) => options.all ? cb(null, [address]) : cb(null, address.address, address.family) }, upstream => {
            if ([301, 302, 303, 307, 308].includes(upstream.statusCode)) {
                upstream.resume();
                res.removeListener('close', close);
                streamMedia(new URL(upstream.headers.location, url).href, req, res, hops + 1).then(resolve, reject);
                return;
            }
            const type = String(upstream.headers['content-type'] || '');
            if (![200, 206, 416].includes(upstream.statusCode) || (upstream.statusCode !== 416 && !/^(audio\/|image\/|application\/octet-stream)/i.test(type))) {
                upstream.destroy(); reject(fail('MEDIA_UNAVAILABLE', '媒体暂时无法播放', 502)); return;
            }
            res.status(upstream.statusCode);
            for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) if (upstream.headers[h]) res.setHeader(h, upstream.headers[h]);
            res.setHeader('Cache-Control', 'private, no-store');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            let size = 0;
            upstream.on('data', chunk => { size += chunk.length; if (size > 256 * 1024 * 1024) { upstream.destroy(); res.destroy(); } });
            upstream.on('error', () => { res.destroy(); resolve(); });
            upstream.on('end', resolve);
            upstream.pipe(res);
        });
        const close = () => { request.destroy(); resolve(); };
        res.once('close', close);
        request.setTimeout(20000, () => request.destroy(new Error('timeout')));
        request.on('error', () => reject(fail('MEDIA_UNAVAILABLE', '媒体连接中断', 502)));
    });
}

module.exports = { createProvider, fail, id, song, playlistId, validateMedia, publicAddress, streamMedia };
