/* One appearance controller for every room in the house. */
(() => {
    'use strict';
    if (window.SeaTheme) return;

    const SETTINGS_KEY = 'syzygy_appearance_v1';
    const DB_NAME = 'syzygy-appearance';
    const STORE_NAME = 'wallpapers';
    const html = document.documentElement;
    const textColors = Object.freeze([
        Object.freeze({ name: '深蓝', value: '#1a3a5c' }),
        Object.freeze({ name: '月光白', value: '#e8e0d4' }),
        Object.freeze({ name: '雾蓝', value: '#7b9eb8' }),
        Object.freeze({ name: '琥珀', value: '#c4956a' }),
        Object.freeze({ name: '霜灰', value: '#787878' })
    ]);
    const defaultTextColors = Object.freeze({ day: '#1a3a5c', night: '#e8e0d4' });
    const allowedTextColors = new Map(textColors.map(color => [color.value.toLowerCase(), color.value]));
    const pageNames = Object.freeze({
        home: '首页', chat: '通讯', favorites: '收藏夹', 'private-journal': '锁页日记',
        calendar: '日历', album: '相册', flo: 'Flo', state: '状态', ledger: '共同账本', settings: '小屋设置',
        dev: '开发中枢', console: '控制台', 'shen-settings': '沈望设置',
        'codex-settings': 'TT 设置', 'work-records': '工作记录', 'tt-memories': 'TT 的小抽屉',
        'memory-vault': '记忆库', stardust: '星尘', 'relationship-growth': '共同成长',
        comets: '彗星', 'long-term': '长期记忆', 'xhs-walk': '散步'
    });
    const standaloneScopes = Object.freeze({
        '/memory-vault.html': 'memory-vault', '/memory-vault': 'memory-vault', '/memory.html': 'memory-vault', '/memory-manager.html': 'memory-vault',
        '/stardust.html': 'stardust', '/stardust': 'stardust', '/relationship-growth.html': 'relationship-growth', '/relationship-growth': 'relationship-growth',
        '/comets.html': 'comets', '/comets': 'comets', '/long-term.html': 'long-term', '/long-term': 'long-term', '/xhs-walk.html': 'xhs-walk', '/xhs-walk': 'xhs-walk'
    });
    let config = readConfig();
    let databasePromise;
    let refreshId = 0;
    let cacheEpoch = 0;
    const wallpaperCache = new Map();
    const pendingWallpaperReads = new Map();
    const wallpaperUrls = new Map();
    let themeWallpaperKeys = new Set();
    let previewWallpaperKeys = new Set();

    function clamp(value, min, max, fallback) {
        const number = Number(value);
        return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
    }
    function normalizeTextColor(value, fallback) {
        return allowedTextColors.get(String(value || '').toLowerCase()) || fallback;
    }
    function normalize(raw) {
        const source = raw && typeof raw === 'object' ? raw : {};
        const exceptions = {};
        if (source.exceptions && typeof source.exceptions === 'object') {
            for (const scope of Object.keys(source.exceptions)) if (pageNames[scope]) exceptions[scope] = true;
        }
        return {
            version: 1,
            cardTransparency: clamp(source.cardTransparency, 0, 85, 32),
            dayDim: clamp(source.dayDim, 0, 70, 0),
            nightDim: clamp(source.nightDim, 0, 70, 0),
            blur: clamp(source.blur, 0, 20, 0),
            dayTextColor: normalizeTextColor(source.dayTextColor, defaultTextColors.day),
            nightTextColor: normalizeTextColor(source.nightTextColor, defaultTextColors.night),
            exceptions,
            revision: Number(source.revision) || 0
        };
    }
    function readConfig() {
        try { return normalize(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); }
        catch (_) { return normalize(); }
    }
    function snapshot() { return JSON.parse(JSON.stringify(config)); }
    function persist(next, refreshWallpapers = false) {
        config = normalize({ ...next, revision: Math.max(Date.now(), config.revision + 1) });
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(config)); } catch (_) {}
        applyMetrics();
        if (refreshWallpapers) refresh();
        window.dispatchEvent(new CustomEvent('sea-appearance-change', { detail: snapshot() }));
        return snapshot();
    }
    function openDatabase() {
        if (!('indexedDB' in window)) return Promise.reject(Error('当前浏览器不能保存壁纸'));
        if (!databasePromise) databasePromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, 1);
            request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || Error('壁纸仓库打开失败'));
        });
        return databasePromise;
    }
    async function storeRequest(mode, action) {
        const database = await openDatabase();
        return new Promise((resolve, reject) => {
            const transaction = database.transaction(STORE_NAME, mode);
            const request = action(transaction.objectStore(STORE_NAME));
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || Error('壁纸仓库操作失败'));
        });
    }
    const keyFor = (scope, phase) => `${scope}:${phase}`;
    function revokeWallpaperUrl(key) {
        const entry = wallpaperUrls.get(key);
        if (entry) URL.revokeObjectURL(entry.url);
        wallpaperUrls.delete(key);
    }
    function invalidateWallpaper(key) {
        cacheEpoch += 1;
        pendingWallpaperReads.clear();
        wallpaperCache.delete(key);
        revokeWallpaperUrl(key);
    }
    function clearWallpaperCache() {
        cacheEpoch += 1;
        pendingWallpaperReads.clear();
        wallpaperCache.clear();
        wallpaperUrls.forEach(entry => URL.revokeObjectURL(entry.url));
        wallpaperUrls.clear();
        themeWallpaperKeys = new Set();
        previewWallpaperKeys = new Set();
    }
    async function readWallpaperBatch(keys) {
        const uniqueKeys = [...new Set(keys)];
        const missing = uniqueKeys.filter(key => !wallpaperCache.has(key) && !pendingWallpaperReads.has(key));
        if (missing.length) {
            const epoch = cacheEpoch;
            const batch = (async () => {
                const database = await openDatabase();
                return new Promise((resolve, reject) => {
                    const results = new Map();
                    const transaction = database.transaction(STORE_NAME, 'readonly');
                    const store = transaction.objectStore(STORE_NAME);
                    let remaining = missing.length;
                    let settled = false;
                    const fail = error => {
                        if (settled) return;
                        settled = true;
                        reject(error || Error('壁纸仓库操作失败'));
                    };
                    for (const key of missing) {
                        const request = store.get(key);
                        request.onsuccess = () => {
                            results.set(key, request.result instanceof Blob ? request.result : null);
                            remaining -= 1;
                            if (!remaining && !settled) { settled = true; resolve(results); }
                        };
                        request.onerror = () => fail(request.error);
                    }
                    transaction.onerror = () => fail(transaction.error);
                });
            })();
            for (const key of missing) {
                const pending = batch.then(results => {
                    const blob = results.get(key) || null;
                    if (cacheEpoch === epoch) wallpaperCache.set(key, blob);
                    return blob;
                }).finally(() => {
                    if (pendingWallpaperReads.get(key) === pending) pendingWallpaperReads.delete(key);
                });
                pendingWallpaperReads.set(key, pending);
            }
        }
        await Promise.all(uniqueKeys.map(async key => {
            if (!wallpaperCache.has(key)) await pendingWallpaperReads.get(key);
        }));
        return new Map(uniqueKeys.map(key => [key, wallpaperCache.get(key) || null]));
    }
    async function directBlob(scope, phase) {
        const key = keyFor(scope, phase);
        return (await readWallpaperBatch([key])).get(key);
    }
    function candidateKeys(scope, phase) {
        const candidates = phase === 'night'
            ? [[scope, 'night'], ['global', 'night'], [scope, 'day'], ['global', 'day']]
            : [[scope, 'day'], ['global', 'day']];
        return [...new Set(candidates.map(candidate => keyFor(...candidate)))];
    }
    function resolveFromCache(targetScope, targetPhase, keys, blobs) {
        for (const key of keys) {
            const blob = blobs.get(key);
            if (!(blob instanceof Blob)) continue;
            const [storedScope, storedPhase] = key.split(':');
            return { blob, key, scope: storedScope, phase: storedPhase, direct: storedScope === targetScope && storedPhase === targetPhase };
        }
        return null;
    }
    async function inspectWallpapers(targetScope) {
        const dayKeys = candidateKeys(targetScope, 'day');
        const nightKeys = candidateKeys(targetScope, 'night');
        const blobs = await readWallpaperBatch([...dayKeys, ...nightKeys]);
        return {
            direct: { day: blobs.get(keyFor(targetScope, 'day')), night: blobs.get(keyFor(targetScope, 'night')) },
            resolved: {
                day: resolveFromCache(targetScope, 'day', dayKeys, blobs),
                night: resolveFromCache(targetScope, 'night', nightKeys, blobs)
            }
        };
    }
    async function resolvedWallpaper(targetScope, phase) {
        return (await inspectWallpapers(targetScope)).resolved[phase];
    }
    function wallpaperUrl(wallpaper) {
        if (!wallpaper?.key || !(wallpaper.blob instanceof Blob)) return '';
        const current = wallpaperUrls.get(wallpaper.key);
        if (current?.blob === wallpaper.blob) return current.url;
        if (current) URL.revokeObjectURL(current.url);
        const url = URL.createObjectURL(wallpaper.blob);
        wallpaperUrls.set(wallpaper.key, { blob: wallpaper.blob, url });
        return url;
    }
    function releaseUnusedWallpaperUrls() {
        for (const key of wallpaperUrls.keys()) {
            if (!themeWallpaperKeys.has(key) && !previewWallpaperKeys.has(key)) revokeWallpaperUrl(key);
        }
    }
    function setPreviewWallpaperKeys(keys) {
        previewWallpaperKeys = new Set(keys || []);
        releaseUnusedWallpaperUrls();
    }
    function scope() {
        const bodyView = document.body?.dataset?.view;
        if (bodyView && pageNames[bodyView]) return bodyView;
        return standaloneScopes[location.pathname] || 'home';
    }
    function applyMetrics() {
        const opacity = 1 - config.cardTransparency / 100;
        const glassBlur = opacity * 12;
        const composerOpacity = Math.min(.82, Math.max(.08, opacity * 1.2));
        html.style.setProperty('--sea-card-opacity', opacity.toFixed(2));
        html.style.setProperty('--sea-surface-opacity', Math.max(.06, opacity * .56).toFixed(2));
        html.style.setProperty('--sea-glass-blur', `${glassBlur.toFixed(1)}px`);
        html.style.setProperty('--sea-composer-opacity', composerOpacity.toFixed(2));
        html.style.setProperty('--sea-day-dim', (config.dayDim / 100).toFixed(2));
        html.style.setProperty('--sea-night-dim', (config.nightDim / 100).toFixed(2));
        html.style.setProperty('--sea-background-blur', `${config.blur}px`);
        html.style.setProperty('--sea-background-scale', (1 + config.blur / 250).toFixed(3));
        html.style.setProperty('--sea-day-foreground', config.dayTextColor);
        html.style.setProperty('--sea-night-foreground', config.nightTextColor);
    }
    function updateChrome() {
        /* A solid theme-color becomes an opaque status-bar strip on older
           iOS releases. The translucent standalone bar should expose the
           wallpaper painted on the root canvas instead. */
        document.querySelector('meta[name="theme-color"]')?.remove();
    }
    async function refresh() {
        const id = ++refreshId;
        html.dataset.visualTheme = 'new';
        if (document.body) document.body.dataset.visualTheme = 'new';
        applyMetrics();
        const currentScope = scope();
        try {
            const wallpapers = await inspectWallpapers(currentScope);
            if (id !== refreshId) return;
            const activeKeys = new Set();
            for (const [phase, wallpaper] of Object.entries(wallpapers.resolved)) {
                if (wallpaper) {
                    const url = wallpaperUrl(wallpaper);
                    activeKeys.add(wallpaper.key);
                    html.style.setProperty(`--sea-${phase}-image`, `url("${url}")`);
                } else html.style.removeProperty(`--sea-${phase}-image`);
            }
            themeWallpaperKeys = activeKeys;
            releaseUnusedWallpaperUrls();
        } catch (error) {
            console.warn('[appearance] 自定义壁纸读取失败:', error.message);
        }
        window.SeaCycle?.update();
        updateChrome();
    }
    async function saveWallpaper(targetScope, phase, file) {
        if (!(file instanceof Blob) || !String(file.type).startsWith('image/')) throw Error('请选择图片文件');
        if (file.size > 24 * 1024 * 1024) throw Error('图片请不要超过 24 MB');
        if (!pageNames[targetScope] && targetScope !== 'global') throw Error('未知页面');
        if (!['day', 'night'].includes(phase)) throw Error('未知时段');
        const key = keyFor(targetScope, phase);
        await storeRequest('readwrite', store => store.put(file, key));
        invalidateWallpaper(key);
        wallpaperCache.set(key, file);
        const next = snapshot();
        if (targetScope !== 'global') next.exceptions[targetScope] = true;
        persist(next, true);
    }
    async function removeWallpaper(targetScope, phase) {
        const key = keyFor(targetScope, phase);
        await storeRequest('readwrite', store => store.delete(key));
        invalidateWallpaper(key);
        wallpaperCache.set(key, null);
        const next = snapshot();
        if (targetScope !== 'global') {
            const [day, night] = await Promise.all([directBlob(targetScope, 'day'), directBlob(targetScope, 'night')]);
            if (!(day instanceof Blob) && !(night instanceof Blob)) delete next.exceptions[targetScope];
        }
        persist(next, true);
    }
    async function clearExceptions() {
        const scopes = Object.keys(config.exceptions);
        await Promise.all(scopes.flatMap(target => ['day', 'night'].map(phase => storeRequest('readwrite', store => store.delete(keyFor(target, phase))))));
        for (const target of scopes) for (const phase of ['day', 'night']) {
            const key = keyFor(target, phase);
            invalidateWallpaper(key);
            wallpaperCache.set(key, null);
        }
        persist({ ...snapshot(), exceptions: {} }, true);
    }
    function setAdjustments(values) { return persist({ ...snapshot(), ...values }); }
    function previewAdjustments(values) {
        config = normalize({ ...snapshot(), ...values });
        applyMetrics();
        return snapshot();
    }

    window.SeaTheme = Object.freeze({
        selected: () => 'new', sync: refresh, refresh, updateChrome, settings: snapshot, setAdjustments, previewAdjustments,
        saveWallpaper, removeWallpaper, clearExceptions, directWallpaper: directBlob,
        wallpaper: resolvedWallpaper, inspectWallpapers, wallpaperUrl, setPreviewWallpaperKeys, scope, pages: pageNames,
        textColors, defaultTextColors
    });
    html.dataset.visualTheme = 'new';
    applyMetrics();
    window.addEventListener('storage', event => {
        if (event.key === SETTINGS_KEY || event.key === null) {
            config = readConfig();
            clearWallpaperCache();
            refresh();
            window.dispatchEvent(new CustomEvent('sea-appearance-change', { detail: snapshot() }));
        }
    });
    window.addEventListener('focus', refresh);
    window.addEventListener('pagehide', clearWallpaperCache);
    window.addEventListener('pageshow', event => { if (event.persisted) refresh(); });
    window.addEventListener('sea-cycle-change', updateChrome);
    document.addEventListener('DOMContentLoaded', () => {
        refresh();
        new MutationObserver(refresh).observe(document.body, { attributes: true, attributeFilter: ['data-view'] });
    }, { once: true });
    if (document.readyState !== 'loading') refresh();
})();
