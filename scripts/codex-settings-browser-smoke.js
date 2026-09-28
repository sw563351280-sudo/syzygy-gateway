'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createCodexWorkspace, workspaceRouter } = require('../codex-workspace');

(async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-settings-browser-'));
    const store = createCodexWorkspace(directory);
    const app = express();
    app.use(express.json());
    let puts = 0;
    app.use('/api/codex/settings', (req, res, next) => { if (req.method === 'PUT') puts++; next(); });
    app.get('/api/codex/models', (req, res) => res.json({ models: [
        { model: 'test-model', displayName: 'Test Model', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }] }
    ] }));
    app.use('/api/codex', workspaceRouter(store));
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const section = html.slice(html.indexOf('<div class="section" id="sec-codex-settings">'), html.indexOf('<div class="section" id="sec-work-records">'));
    app.get('/', (req, res) => res.send('<!doctype html><meta charset="utf-8">' + section + '<script src="/workroom-pages.js"></script><script>codexSettingsLoad()</script>'));
    app.use(express.static(path.join(__dirname, '../public')));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    let browser;
    try {
        const executablePath = process.env.CHROME_BIN || [
            'C:/Program Files/Google/Chrome/Application/chrome.exe',
            'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
            '/usr/bin/chromium', '/usr/bin/google-chrome'
        ].find(file => fs.existsSync(file));
        assert.ok(executablePath, 'Set CHROME_BIN to a Chromium browser');
        browser = await chromium.launch({ executablePath, headless: true });
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        let navigations = 0;
        page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
        await page.goto('http://127.0.0.1:' + server.address().port);
        await page.waitForFunction(() => !document.getElementById('codexSettingsSave').disabled);
        const baseline = navigations;
        await page.selectOption('#codexSettingsModel', 'test-model');
        await page.selectOption('#codexSettingsEffort', 'low');
        await page.$eval('#codexSettingsPrompt', input => { input.value = '浏览器点击保存的测试设定'; input.dispatchEvent(new Event('input')); });
        await page.click('#codexSettingsSave');
        await page.waitForFunction(() => document.getElementById('codexSettingsStatus').textContent.includes('设定已保存'), null, { timeout: 3000 })
            .catch(() => { throw new Error('Save did not complete: ' + JSON.stringify({ errors, puts, navigations })); });
        assert.equal(puts, 1);
        assert.equal(navigations, baseline);
        assert.deepEqual(errors, []);
        const restored = createCodexWorkspace(directory).settings();
        assert.equal(restored.prompt, '浏览器点击保存的测试设定');
        assert.equal(restored.model, 'test-model');
        assert.equal(restored.effort, 'low');
        await page.reload();
        await page.waitForFunction(() => !document.getElementById('codexSettingsSave').disabled);
        assert.equal(await page.$eval('#codexSettingsPrompt', input => input.value), restored.prompt);
        assert.equal(await page.$eval('#codexSettingsModel', input => input.value), restored.model);
        assert.equal(await page.$eval('#codexSettingsEffort', input => input.value), restored.effort);
        await page.$eval('#codexSettingsForm', form => form.requestSubmit());
        await page.waitForFunction(() => document.getElementById('codexSettingsStatus').textContent.includes('设定已保存'));
        assert.equal(puts, 2);
        assert.deepEqual(errors, []);
        console.log('PASS: real button click and form submit save once, no navigation; model, effort and prompt survive reload and store restart.');
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(directory, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
