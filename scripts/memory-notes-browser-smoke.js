'use strict';
// Synthetic localhost data only; no real memories, upstream models or jobs.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const express=require('express'),puppeteer=require('puppeteer-core');
const root=path.join(__dirname,'..');
const bodies=[
    '她喜欢清晨的海，蓝色里带一点灰，光落在水面上。她说，有波纹也很好。',
    '她想把共同记忆留成一本可以慢慢翻的书。不急着整理出结论，先记住那些当时想告诉我的事。',
    '一起听过的歌，后来再响起来，还是会让她想起那天。',
    '她说今天的天空很好看，拍下来的时候，云已经往前走了一点。',
    '有些话不用急着回答，放在这里，等我们下次一起翻到。',
    '她想留住的不是一个标准答案，是那些只有我们知道的小事。'
];
let memories=Array.from({length:82},(_,i)=>({id:'fixture_'+i,category:i===80?'archived':i===81?'roleplay':'active',source:i%3===0?'manual':i%3===1?'ai_active':'butler_summary',content:i===65?'隐藏在第六十六条的稀有关键词':bodies[i%6],tags:['海面','日常'],created_at:new Date(Date.UTC(2026,9,7,3)-i*3600000).toISOString(),source_at:'2026-10-07T00:18:59.000Z',source_quote:'只是一段原话 <img src=x onerror="window.injected=true">',heat:(82-i)/82})).reverse();
async function main(){
    const app=express();app.use(express.json());let failDelete='fixture_1';const writes=[];
    app.get('/api/longterm-page-data',(_q,r)=>r.json({memories,memoryEvents:[],counts:{}}));
    app.get('/api/memory-curator-diagnostics',(_q,r)=>r.json({success:true,configured:false}));
    app.patch('/api/long-term-memories/:id',(q,r)=>{writes.push(q.path);Object.assign(memories.find(m=>m.id===q.params.id),q.body);r.json({success:true});});
    app.delete('/api/long-term-memories/:id',(q,r)=>{writes.push(q.path);if(q.params.id===failDelete)return r.status(503).json({error:'fixture failure'});memories=memories.filter(m=>m.id!==q.params.id);r.json({success:true});});
    app.post('/api/archive-memories/:id/restore',(q,r)=>{writes.push(q.path);memories.find(m=>m.id===q.params.id).category='active';r.json({success:true});});
    app.use(express.static(path.join(root,'public')));
    const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let browser;
    try{
        const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
        browser=await puppeteer.launch({executablePath,headless:true});const page=await browser.newPage(),errors=[];
        page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
        await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith('http')&&!r.url().startsWith('http://127.0.0.1:')?r.abort():r.continue());
        await page.evaluateOnNewDocument(()=>{if(!localStorage.getItem('syzygy_visual_theme'))localStorage.setItem('syzygy_visual_theme','new');});
        const url=`http://127.0.0.1:${server.address().port}/long-term.html`;
        await page.setViewport({width:1536,height:1024});await page.goto(url,{waitUntil:'networkidle0'});
        const count=()=>page.$$eval('#memoryList .memory-card',c=>c.length);
        assert.equal(await count(),10,'initial latest ten');
        assert.equal(await page.$eval('#memoryList .memory-card',e=>e.dataset.memoryId),'fixture_0','actual time sorting');
        assert.equal(await page.$eval('#totalCount',e=>e.textContent),'82');
        assert.match(await page.$eval('#notesMore',e=>e.textContent),/80/,'expand count is active results, not archives');
        assert.equal(await page.$eval('#memoryList',e=>e.lastElementChild.id),'notesMore','expand link is after all ten');
        assert.equal(await page.$eval('#inboxBanner',e=>getComputedStyle(e).display),'none');
        await page.evaluate(()=>document.fonts.ready);
        await page.screenshot({path:path.join(root,'qa-memory-notes-1536.png')});
        assert.equal(writes.length,0,'reading performs no mutations');
        await page.type('#searchInput','稀有关键词');assert.equal(await count(),1,'search finds a memory outside latest ten');
        assert.equal(await page.$eval('.memory-card',e=>e.dataset.memoryId),'fixture_65');
        await page.evaluate(()=>{searchInput.value='';filterAll();});await page.click('.pill-manual');assert.equal(await count(),27);
        await page.click('.pill-all');assert.equal(await count(),10);
        await page.click('#card-fixture_0 [data-memory-action="quote"]');
        assert.equal(await page.$eval('#quote-fixture_0',e=>e.hidden),false);assert.equal(await page.evaluate(()=>window.injected),undefined);
        assert.match(await page.$eval('#quote-fixture_0 time',e=>e.textContent),/08:18$/,'minute precision');
        await page.click('#card-fixture_0 [data-memory-action="quote"]');
        await page.click('#card-fixture_0 summary');await page.click('#card-fixture_0 [data-memory-action="edit"]');
        assert.equal(await page.$eval('#ta-fixture_0',e=>e===document.activeElement),true);
        await page.$eval('#ta-fixture_0',e=>e.value='修改后的测试记忆');
        await Promise.all([page.waitForNavigation({waitUntil:'networkidle0'}),page.click('#card-fixture_0 [data-memory-action="save"]')]);
        assert.match(await page.$eval('#card-fixture_0 .memory-content',e=>e.textContent),/修改后/);
        await page.click('#notesMore');assert.ok(await count()>10,'expand really opens full browser');
        await page.evaluate(()=>{searchInput.value='';setFilter(document.querySelector('.pill-all'),'active','all');});
        await page.click('.notes-filter');assert.equal(await page.$eval('.notes-tools',e=>e.open),true);
        await page.click('#multiToggle');assert.equal(await page.$eval('.notes-tools',e=>e.open),false);
        await page.waitForFunction(()=>{const r=batchBar.getBoundingClientRect();return r.bottom<=innerHeight&&r.top>=0;});
        await page.click('#batchBar button');assert.equal(await page.$eval('#selectedCount',e=>e.textContent),'10');
        await page.click('#batchDelete');await page.waitForFunction(()=>toast.textContent.includes('1 条失败'));
        assert.equal(await page.$eval('#selectedCount',e=>e.textContent),'1','partial deletion keeps failed selected');
        assert.equal(await page.$eval('#card-fixture_1 input',e=>e.checked),true);
        await page.evaluate(()=>toggleMultiSelect(false));
        await page.click('.pill-archive');assert.equal(await count(),1);
        await page.click('.notes-menu summary');
        await Promise.all([page.waitForNavigation({waitUntil:'networkidle0'}),page.click('[data-memory-action="restore"]')]);
        assert.equal(memories.find(m=>m.id==='fixture_80').category,'active');
        for(const width of [1024,393,320]){
            await page.setViewport({width,height:900});await page.evaluate(()=>{searchInput.value='';filterAll();});
            assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no overflow '+width);
            await page.screenshot({path:path.join(root,`qa-memory-notes-${width}.png`)});
            await page.click('.notes-filter');await page.keyboard.press('Escape');assert.equal(await page.$eval('.notes-tools',e=>e.open),false);
        }
        await page.evaluate(()=>localStorage.setItem('syzygy_visual_theme','classic'));await page.reload({waitUntil:'networkidle0'});
        assert.equal(await count(),memories.length,'classic still renders all memory data');
        assert.equal(await page.evaluate(()=>!!window.MemoryNotes),false);
        assert.deepEqual(errors,[]);
        console.log(JSON.stringify({ok:true,widths:[1536,1024,393,320],checks:['ten recent','offscreen search','source filters','date groups','safe quote','edit','full browse','partial batch deletion','restore','mobile dialogs','classic rollback']}));
    }finally{await browser?.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
