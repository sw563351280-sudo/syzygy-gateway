'use strict';
// Fixture server only; never read real care records or invoke a model.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const express = require('express'), puppeteer = require('puppeteer-core');
const root = path.join(__dirname, '..');
async function main() {
    const fixture = [
        { id: 'one', entity: '那本书', content: '后来找到想要的版本了吗？', context: '她前一天提到想买一本小说，店里只有另一个版本。她说先不急，明天再看看。', source_quote: '那家店只有另一个版本，我明天再看看。<img src=x onerror="window.injected=true">', reason: '想知道她后来有没有找到喜欢的那一版。', source_at: '2026-10-08T14:30:59Z', due_at: '2026-10-10T02:00:59Z', status: 'open', attempts: 0 },
        { id: 'legacy', entity: '旧牵挂', content: '那个东西后来怎么样了？', status: 'open', attempts: 1 },
        { id: 'resolved', entity: '已经结束', content: '不再显示', status: 'resolved' },
    ];
    let readFails = false, writeFails = false, empty = false; const writes = [];
    const app = express();
    app.get('/api/anticipations', (_q, r) => readFails ? r.status(503).json({ error: 'fixture read failure' }) : r.json({ anticipations: empty ? [] : fixture }));
    app.post('/api/anticipations/:id/resolve', (q, r) => {
        writes.push(q.params.id);
        if (writeFails) return r.status(503).json({ error: 'fixture write failure' });
        fixture.find(x => x.id === q.params.id).status = 'resolved'; r.json({ success: true });
    });
    app.use(express.static(path.join(root, 'public')));
    const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); let browser;
    try {
        const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
        browser = await puppeteer.launch({ executablePath, headless: true });
        const page = await browser.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
        await page.setRequestInterception(true); page.on('request', r => r.url().startsWith('http') && !r.url().startsWith('http://127.0.0.1:') ? r.abort() : r.continue());
        await page.evaluateOnNewDocument(() => { Date.now = () => Date.parse('2026-10-09T20:00:00+08:00'); if (!localStorage.getItem('syzygy_visual_theme')) localStorage.setItem('syzygy_visual_theme', 'new'); });
        await page.setViewport({ width: 1536, height: 1024 });
        const url = `http://127.0.0.1:${server.address().port}/comets.html?pwd=fixture`;
        await page.goto(url, { waitUntil: 'networkidle0' }); await page.evaluate(() => document.fonts.ready);
        assert.equal(await page.$$eval('.comet', x => x.length), 2);
        assert.match(await page.$eval('.care-context', x => x.textContent), /只有另一个版本/);
        assert.match(await page.$eval('.care-reason', x => x.textContent), /后来有没有找到/);
        assert.match(await page.$eval('.care-source summary', x => x.textContent), /22:30$/);
        assert.match(await page.$eval('.due', x => x.textContent), /10:00$/);
        assert.match(await page.$eval('.care-missing', x => x.textContent), /没有留下原始背景/);
        assert.match(await page.$eval('body', x => getComputedStyle(x, '::before').backgroundImage), /ice-sea-night/);
        assert.equal(await page.$eval('.comet', x => getComputedStyle(x).borderLeftWidth), '0px');
        assert.equal(await page.$eval('.hero p', x => getComputedStyle(x).display), 'none');
        assert.equal(await page.$eval('#growth', x => x.getAttribute('href')), '/relationship-growth.html?pwd=fixture');
        await page.click('.care-source summary'); assert.equal(await page.$eval('.care-source', x => x.open), true);
        assert.equal(await page.evaluate(() => window.injected), undefined);
        await page.click('.care-source summary');
        for (const width of [1536, 1024, 393, 320]) {
            await page.setViewport({ width, height: 900 });
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no overflow ' + width);
            await page.screenshot({ path: path.join(root, `qa-comets-${width}.png`) });
        }
        await page.focus('.care-actions summary'); await page.keyboard.press('Enter');
        assert.equal(await page.$eval('.care-actions', x => x.open), true);
        await page.keyboard.press('Escape'); assert.equal(await page.$eval('.care-actions', x => x.open), false);
        writeFails = true; await page.click('.care-actions summary'); await page.click('[data-resolve="one"]');
        await page.waitForFunction(() => document.getElementById('careStatus').textContent.includes('没有记下'));
        assert.equal(await page.$$eval('.comet', x => x.length), 2);
        assert.equal(await page.$eval('[data-resolve="one"]', x => x.disabled), false);
        writeFails = false; await page.click('[data-resolve="one"]'); await page.waitForFunction(() => document.querySelectorAll('.comet').length === 1);
        assert.deepEqual(writes, ['one', 'one']);
        readFails = true; await page.reload({ waitUntil: 'networkidle0' }); assert.ok(await page.$('.care-retry'));
        readFails = false; await page.click('.care-retry'); await page.waitForSelector('.comet');
        empty = true; await page.reload({ waitUntil: 'networkidle0' }); assert.match(await page.$eval('.empty', x => x.textContent), /没有悬着/);
        empty = false; await page.evaluate(() => localStorage.setItem('syzygy_visual_theme', 'classic')); await page.reload({ waitUntil: 'networkidle0' });
        assert.equal(await page.$eval('html', x => x.dataset.visualTheme), 'classic');
        assert.equal(await page.$eval('.hero p', x => getComputedStyle(x).display), 'block');
        assert.match(await page.$eval('body', x => getComputedStyle(x).backgroundImage), /gradient/);
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ ok: true, checks: ['sea shell', 'context and reason', 'source quote escaped', 'legacy missing source', 'minute precision', 'keyboard and touch actions', 'write failure retained', 'read retry', 'empty state', 'classic rollback'], widths: [1536, 1024, 393, 320] }));
    } finally { await browser?.close(); await new Promise(r => server.close(r)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
