'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function browserFixture() {
    const storage = new Map(), wallpapers = new Map(), listeners = new Map(), properties = new Map();
    const objectUrls = [], revokedUrls = [];
    let wallpaperReads = 0;
    const style = { setProperty: (key, value) => properties.set(key, value), removeProperty: key => properties.delete(key) };
    const html = { dataset: {}, style };
    const body = { dataset: {} };
    const meta = { content: '' };
    const document = {
        documentElement: html, body, readyState: 'loading', head: { append() {} },
        querySelector: selector => selector === 'meta[name="theme-color"]' ? meta : null,
        createElement: () => ({ name: '', content: '' }), addEventListener() {}
    };
    const request = result => {
        const value = { result };
        queueMicrotask(() => value.onsuccess?.());
        return value;
    };
    const database = {
        createObjectStore() {},
        transaction() {
            return { objectStore: () => ({
                get: key => { wallpaperReads += 1; return request(wallpapers.get(key)); },
                put: (value, key) => { wallpapers.set(key, value); return request(key); },
                delete: key => { wallpapers.delete(key); return request(undefined); }
            }) };
        }
    };
    const indexedDB = { open() {
        const value = { result: database };
        queueMicrotask(() => { value.onupgradeneeded?.(); value.onsuccess?.(); });
        return value;
    } };
    const window = {
        document, indexedDB, location: { pathname: '/' },
        addEventListener(type, listener) { (listeners.get(type) || listeners.set(type, []).get(type)).push(listener); },
        dispatchEvent(event) { for (const listener of listeners.get(event.type) || []) listener(event); }
    };
    const localStorage = {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, String(value))
    };
    const context = vm.createContext({
        window, document, localStorage, indexedDB, location: window.location, Blob, console,
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
        MutationObserver: class { observe() {} },
        URL: {
            createObjectURL: (() => { let id = 0; return () => { const url = `blob:fixture-${++id}`; objectUrls.push(url); return url; }; })(),
            revokeObjectURL: url => revokedUrls.push(url)
        },
        setTimeout, clearTimeout, queueMicrotask
    });
    return { context, window, html, body, properties, wallpapers, storage, objectUrls, revokedUrls, wallpaperReads: () => wallpaperReads };
}

test('the house has one appearance and keeps day/night wallpaper inheritance explicit', async () => {
    const fixture = browserFixture();
    fixture.storage.set('syzygy_visual_theme', 'classic');
    fixture.storage.set('syzygy_home_layout', 'classic');
    const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'site-theme.js'), 'utf8');
    vm.runInContext(source, fixture.context);
    const theme = fixture.window.SeaTheme;

    assert.equal(theme.selected(), 'new');
    assert.equal(fixture.html.dataset.visualTheme, 'new');
    assert.deepEqual(JSON.parse(JSON.stringify(theme.settings())), {
        version: 1, cardTransparency: 32, dayDim: 0, nightDim: 0, blur: 0, exceptions: {}, revision: 0
    });

    theme.setAdjustments({ cardTransparency: 200, dayDim: -4, nightDim: 35, blur: 7 });
    assert.equal(theme.settings().cardTransparency, 85);
    assert.equal(theme.settings().dayDim, 0);
    assert.equal(theme.settings().nightDim, 35);
    assert.equal(fixture.properties.get('--sea-background-blur'), '7px');

    await theme.inspectWallpapers('home');
    assert.equal(fixture.wallpaperReads(), 4, 'one scope should load its unique candidates once');
    await theme.inspectWallpapers('home');
    assert.equal(fixture.wallpaperReads(), 4, 'cached wallpaper candidates should not hit IndexedDB again');

    await theme.saveWallpaper('global', 'day', new Blob(['day'], { type: 'image/png' }));
    const inheritedNight = await theme.wallpaper('global', 'night');
    assert.equal(inheritedNight.phase, 'day');
    assert.equal(inheritedNight.scope, 'global');
    const firstUrl = theme.wallpaperUrl(inheritedNight);
    assert.equal(theme.wallpaperUrl(inheritedNight), firstUrl, 'the same stored wallpaper should share one object URL');
    await theme.saveWallpaper('global', 'day', new Blob(['new-day'], { type: 'image/png' }));
    assert.ok(fixture.revokedUrls.includes(firstUrl), 'replacing a wallpaper should revoke its old object URL');

    fixture.body.dataset.view = 'chat';
    assert.equal(theme.scope(), 'chat');
    await theme.saveWallpaper('chat', 'night', new Blob(['night'], { type: 'image/png' }));
    assert.deepEqual(Object.keys(theme.settings().exceptions), ['chat']);
    assert.equal((await theme.wallpaper('chat', 'night')).direct, true);

    await theme.removeWallpaper('chat', 'night');
    assert.deepEqual(Object.keys(theme.settings().exceptions), []);
    assert.equal((await theme.wallpaper('chat', 'night')).phase, 'day');
});

test('appearance page exposes confirmed uploads instead of the retired theme chooser', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const controller = fs.readFileSync(path.join(__dirname, '..', 'public', 'appearance-settings.js'), 'utf8');
    assert.match(html, /id="appearanceController"/);
    assert.doesNotMatch(html, /data-visual-theme-option|applyVisualTheme\(/);
    assert.match(controller, /data-wallpaper-confirm/);
    assert.match(controller, /SeaTheme\.saveWallpaper/);
    assert.match(controller, /SeaTheme\.clearExceptions/);
    assert.match(controller, /requestAnimationFrame/);
    assert.match(controller, /SeaTheme\.previewAdjustments/);
    assert.match(controller, /document\.body\.dataset\.view !== 'settings'/);
});
