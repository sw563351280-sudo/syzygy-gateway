'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require.resolve('../public/index.html'), 'utf8');
const script = fs.readFileSync(require.resolve('../public/script.js'), 'utf8');
const css = fs.readFileSync(require.resolve('../public/style.css'), 'utf8');
const workroomCss = fs.readFileSync(require.resolve('../public/workroom-pages.css'), 'utf8');

test('legacy Codex UI and executable client are removed while shared features remain', () => {
    assert.doesNotMatch(html, /devOpenCodex|devCodexPanel|devCodexLoginPanel|devRecentTaskCard|devOpenDashboard/);
    assert.doesNotMatch(script, /function devOpenCodex|function devSendCodexMessage|let devCodexSocket|devSetCodexImmersive/);
    assert.match(html, /id="sec-console"/);
    assert.match(html, /id="sec-codex-settings"/);
    assert.match(script, /function workroomDispatchToCodex/);
    assert.match(script, /function devDescribeCodexPermissions/);
});

test('home owns the two room entrances and chat toolbar has no room switch', () => {
    assert.ok(html.includes(`onclick="goView('chat')"`));
    assert.ok(html.includes('onclick="openWorkroom()"'));
    assert.ok(html.includes('id="chatSettingsTop"') && html.includes('onclick="openActiveChatSettings()"'));
    assert.doesNotMatch(html, /toggleWorkroom|id="sec-data"|goView('data')/);
    assert.doesNotMatch(html, /跨平台记忆注入|提取灵魂|重置本地缓存/);
    const rule = `${css}\n${workroomCss}`.match(/\.workroom-codex-bar\s*\{([^}]+)\}/)[1];
    assert.match(rule, /flex-wrap:\s*wrap/);
});

test('workroom composer removes thread menu and exposes TT memory drawer', () => {
    assert.doesNotMatch(html, /workroomStartNewCodexThread|workroom-more|workroomCodexConfig|普通发送只讨论/);
    assert.ok(html.includes(`goView('tt-memories')`));
    assert.match(html, /id="sec-tt-memories"/);
});

test('the same gear opens Shenwang settings in communication and Codex settings in workroom', () => {
    let active = true;
    const attributes = {};
    const top = { title: '', setAttribute(name, value) { attributes[name] = value; } };
    const chromeSource = script.slice(script.indexOf('function updateWorkroomChrome()'), script.indexOf('function escapeToolHtml'));
    const chromeContext = vm.createContext({ isWorkroomSession: () => active, ensureWorkroomSession: () => ({ codexTaskId: null }),
        document: { getElementById: id => id === 'chatSettingsTop' ? top : null, querySelectorAll: () => [] }, workroomApprovalQueue: [] });
    vm.runInContext(chromeSource, chromeContext);
    chromeContext.updateWorkroomChrome();
    assert.equal(top.title, 'Codex 设定');
    assert.equal(attributes['aria-label'], '打开Codex 设定');
    active = false;
    chromeContext.updateWorkroomChrome();
    assert.equal(top.title, '沈望设定');
    assert.equal(attributes['aria-label'], '打开沈望设定');

    const opened = [];
    const openSource = script.slice(script.indexOf('function openActiveChatSettings()'), script.indexOf('function updateWorkroomChrome()'));
    const openContext = vm.createContext({ isWorkroomSession: () => active, goView: view => opened.push(view) });
    vm.runInContext(openSource, openContext);
    openContext.openActiveChatSettings();
    active = true;
    openContext.openActiveChatSettings();
    assert.deepEqual(opened, ['shen-settings', 'codex-settings']);
});
