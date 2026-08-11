'use strict';

const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const XHS_HOSTS = new Set(['xhslink.com', 'www.xhslink.com', 'xhslink.cn', 'www.xhslink.cn', 'xiaohongshu.com', 'www.xiaohongshu.com']);
const XHS_HTTP_SHORT_HOSTS = new Set(['xhslink.cn', 'www.xhslink.cn']);
const XHS_MEDIA_HOST_SUFFIXES = ['.xhscdn.com', '.xiaohongshu.com'];

function parseHttpsUrl(value) {
    try {
        const url = new URL(String(value || '').trim());
        return url.protocol === 'https:' ? url : null;
    } catch (_) {
        return null;
    }
}

// iOS Copy Link can emit http://xhslink.cn/... although this short host
// redirects only over HTTPS. Normalize this one trusted host before checking
// the allowlist; arbitrary HTTP URLs stay rejected.
function parseXhsShareUrl(value) {
    try {
        const url = new URL(String(value || '').trim());
        if (url.protocol === 'http:' && XHS_HTTP_SHORT_HOSTS.has(url.hostname.toLowerCase())) {
            url.protocol = 'https:';
        }
        return url.protocol === 'https:' ? url : null;
    } catch (_) {
        return null;
    }
}

function isXhsHost(hostname) {
    return XHS_HOSTS.has(String(hostname || '').toLowerCase());
}

function isAllowedXhsUrl(value) {
    const url = value instanceof URL ? value : parseXhsShareUrl(value);
    return Boolean(url && isXhsHost(url.hostname));
}

function isAllowedXhsMediaUrl(value) {
    const url = value instanceof URL ? value : parseHttpsUrl(value);
    if (!url) return false;
    const host = url.hostname.toLowerCase();
    return XHS_MEDIA_HOST_SUFFIXES.some(suffix => host.endsWith(suffix));
}

function extractXhsUrl(text) {
    const match = String(text || '').match(/https?:\/\/(?:www\.)?(?:xhslink\.(?:com|cn)|xiaohongshu\.com)\/[^\s<>"']+/i);
    if (!match) return null;
    // Strip punctuation before URL parsing. Mobile share text commonly puts a
    // Chinese comma immediately after the short link.
    const raw = match[0].split(/[，。！？、）)】]/u, 1)[0].replace(/[，。！？、）)】]+$/u, '');
    const normalized = parseXhsShareUrl(raw);
    if (normalized) return normalized.toString();
    return raw;
}

async function fetchWithSafeRedirects(fetchImpl, input, options = {}) {
    const maxRedirects = options.maxRedirects || 5;
    let current = input instanceof URL ? input : parseXhsShareUrl(input);
    if (!isAllowedXhsUrl(current)) throw new Error('只支持小红书分享链接');

    for (let hop = 0; hop <= maxRedirects; hop++) {
        const response = await fetchImpl(current, {
            method: 'GET',
            redirect: 'manual',
            headers: { 'User-Agent': MOBILE_UA, Accept: 'text/html,application/xhtml+xml' },
            signal: options.signal,
        });
        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get('location');
            if (!location) throw new Error('小红书跳转缺少地址');
            current = new URL(location, current);
            if (!isAllowedXhsUrl(current)) throw new Error('小红书跳转到了不受支持的地址');
            continue;
        }
        return { response, url: current.toString() };
    }
    throw new Error('小红书跳转次数过多');
}

async function readTextLimited(response, maxBytes = 3 * 1024 * 1024) {
    const reader = response.body?.getReader?.();
    if (!reader) return response.text();
    const chunks = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) throw new Error('小红书页面过大');
        chunks.push(value);
    }
    return new TextDecoder().decode(Buffer.concat(chunks.map(chunk => Buffer.from(chunk))));
}

function extractBalancedObject(source, marker) {
    const markerIndex = source.indexOf(marker);
    if (markerIndex < 0) return null;
    const start = source.indexOf('{', markerIndex + marker.length);
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < source.length; i++) {
        const ch = source[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') { inString = true; continue; }
        if (ch === '{') depth++;
        if (ch === '}') {
            depth--;
            if (depth === 0) return source.slice(start, i + 1);
        }
    }
    return null;
}

function parseInitialState(html) {
    const raw = extractBalancedObject(String(html || ''), 'window.__INITIAL_STATE__');
    if (!raw) throw new Error('页面里没有找到笔记数据');
    try { return JSON.parse(raw); }
    catch (_) {
        try { return JSON.parse(raw.replace(/\bundefined\b/g, 'null')); }
        catch (error) { throw new Error('笔记数据解析失败: ' + error.message); }
    }
}

function findNoteData(state) {
    const candidates = [
        state?.noteData?.data?.noteData,
        state?.noteData?.data?.normalNotePreloadData?.noteData,
        state?.noteData?.data?.noteDataMap && Object.values(state.noteData.data.noteDataMap)[0],
        state?.normalNotePreloadData?.noteData,
    ];
    return candidates.find(note => note && typeof note === 'object') || null;
}

function pickImageUrl(image) {
    const infos = Array.isArray(image?.infoList) ? image.infoList : [];
    const preferred = infos.find(info => info?.imageScene === 'WB_DFT') || infos[0] || image;
    return preferred?.url || preferred?.urlDefault || preferred?.urlPre || preferred?.originUrl || null;
}

function pickVideoUrl(note) {
    const video = note?.video || {};
    const stream = video?.media?.stream || {};
    for (const codec of ['h264', 'h265', 'av1']) {
        const item = Array.isArray(stream[codec]) ? stream[codec][0] : null;
        if (item?.masterUrl) return item.masterUrl;
        if (item?.backupUrls?.[0]) return item.backupUrls[0];
    }
    if (video?.consumer?.originVideoKey) return `https://sns-video-bd.xhscdn.com/${video.consumer.originVideoKey}`;
    return video?.url || null;
}

function normalizeNote(note, canonicalUrl) {
    const images = (Array.isArray(note?.imageList) ? note.imageList : [])
        .map(pickImageUrl)
        .filter(url => isAllowedXhsMediaUrl(url))
        .slice(0, 9);
    const videoUrl = pickVideoUrl(note);
    const user = note?.user || note?.author || {};
    const interact = note?.interactInfo || {};
    return {
        canonical_url: canonicalUrl,
        note_id: note?.noteId || note?.id || '',
        title: String(note?.title || '').trim(),
        desc: String(note?.desc || note?.content || '').trim(),
        author: String(user?.nickname || user?.nickName || '').trim(),
        avatar: isAllowedXhsMediaUrl(user?.avatar) ? user.avatar : null,
        images,
        video_url: isAllowedXhsMediaUrl(videoUrl) ? videoUrl : null,
        type: videoUrl ? 'video' : 'image',
        interact: {
            liked_count: interact?.likedCount || interact?.liked_count || '',
            collected_count: interact?.collectedCount || interact?.collected_count || '',
            comment_count: interact?.commentCount || interact?.comment_count || '',
        },
    };
}

async function readXhsNote(fetchImpl, url, options = {}) {
    const { response, url: canonicalUrl } = await fetchWithSafeRedirects(fetchImpl, url, options);
    if (!response.ok) throw new Error(`小红书页面请求失败 ${response.status}`);
    const state = parseInitialState(await readTextLimited(response, options.maxHtmlBytes));
    const note = findNoteData(state);
    if (!note) throw new Error('没有找到笔记正文');
    return normalizeNote(note, canonicalUrl);
}

module.exports = {
    MOBILE_UA,
    extractBalancedObject,
    extractXhsUrl,
    findNoteData,
    isAllowedXhsMediaUrl,
    isAllowedXhsUrl,
    normalizeNote,
    parseInitialState,
    readXhsNote,
};
