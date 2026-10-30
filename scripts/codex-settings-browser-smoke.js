'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const puppeteer = require('puppeteer-core');
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
    const waitForPuts = async expected => {
        const deadline = Date.now() + 3000;
        while (puts < expected && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
        assert.equal(puts, expected);
    };
    let browser;
    try {
        const executablePath = process.env.CHROME_BIN || [
            'C:/Program Files/Google/Chrome/Application/chrome.exe',
            'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
            '/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'
        ].find(file => fs.existsSync(file));
        assert.ok(executablePath, 'Set CHROME_BIN to a Chromium browser');
        browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        let navigations = 0;
        page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
        await page.goto('http://127.0.0.1:' + server.address().port);
        await page.waitForFunction(() => !document.getElementById('codexSettingsSave').disabled);
        const baseline = navigations;
        await page.select('#codexSettingsModel', 'test-model');
        await page.waitForFunction(() => document.getElementById('codexSettingsStatus').textContent.includes('模型已保存'), { timeout: 3000 })
            .catch(async () => { throw new Error('Model autosave did not complete: ' + JSON.stringify({ puts, errors, ui: await page.$eval('#codexSettingsForm', form => ({ status: form.querySelector('#codexSettingsStatus').textContent, model: form.querySelector('#codexSettingsModel').value, disabled: form.querySelector('#codexSettingsModel').disabled })) })); });
        await waitForPuts(1);
        await page.waitForFunction(() => !document.getElementById('codexSettingsModel').disabled);
        await page.select('#codexSettingsEffort', 'low');
        await waitForPuts(2);
        await page.waitForFunction(() => document.getElementById('codexSettingsStatus').textContent.includes('模型已保存'));
        await page.waitForFunction(() => !document.getElementById('codexSettingsEffort').disabled);
        await page.$eval('.codex-prompt-settings', details => { details.open = true; });
        await page.$eval('#codexSettingsPrompt', input => { input.value = '浏览器点击保存的测试设定'; input.dispatchEvent(new Event('input')); });
        const beforePromptSave = await page.$eval('#codexSettingsForm', form => ({ status: form.querySelector('#codexSettingsStatus').textContent, buttonDisabled: form.querySelector('#codexSettingsSave').disabled, loading: window.codexSettingsLoading, saveType: typeof window.codexSettingsSave }));
        await page.click('#codexSettingsSave');
        await page.waitForFunction(() => document.getElementById('codexSettingsStatus').textContent.includes('设定已保存'), { timeout: 3000 })
            .catch(async () => { throw new Error('Save did not complete: ' + JSON.stringify({ errors, puts, navigations, beforePromptSave, after: await page.$eval('#codexSettingsForm', form => ({ status: form.querySelector('#codexSettingsStatus').textContent, buttonDisabled: form.querySelector('#codexSettingsSave').disabled, modelDisabled: form.querySelector('#codexSettingsModel').disabled })) })); });
        assert.equal(puts, 3);
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
        assert.equal(puts, 4);
        assert.deepEqual(errors, []);
        console.log('PASS: model and effort save immediately without navigation; prompt save, reload, and store restart preserve the chosen model.');
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(directory, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
