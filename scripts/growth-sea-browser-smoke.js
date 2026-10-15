'use strict';
// Local fixtures only. Never read real reflections or invoke a model.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const express=require('express'),puppeteer=require('puppeteer-core');
const root=path.join(__dirname,'..');
const reality=[
    {id:'older',title:'她的绘画与表达',summary:'那些画里的线条，慢慢成为她认识自己的方式。',subjects:['绘画','创作'],status:'active',updated_at:'2026-10-06T14:14:00Z',milestones:[]},
    {id:'newest',title:'把海面留在小屋里',summary:'从第一张海面的效果图，到昼夜之间的切换，我们一点点把小屋改成喜欢的样子。',subjects:['小屋','海面','一起做的事'],status:'active',updated_at:'2026-10-07T12:53:00Z',milestones:[
        {occurred_at:'2026-10-06T14:14:59Z',stage:'beginning',summary:'一起挑了海面，也留下那句熟悉的话：山河仍在，幸而有你。',source_quote:'保留原话 <img src=x onerror="window.injected=true">'},
        {occurred_at:'2026-10-07T12:53:59Z',stage:'milestone',summary:'白天的冰蓝和夜里的深海，都留在同一个家里。',source_quote:'想把喜欢的样子留下来。'}]},
    {id:'book',title:'把共同记忆留成一本书',summary:'不急着整理出答案，先把走过的过程留下来。',subjects:['共同记忆','小屋'],status:'completed',updated_at:'2026-10-05T06:00:00Z',milestones:[]},
    {id:'song',title:'一起听过的那些歌',summary:'后来再听见，还是会想起第一次分享的那一晚。',subjects:['共听','日常'],status:'active',updated_at:'2026-10-04T14:00:00Z',milestones:[]}
];
const fixture={reality_events:reality,episodes:[{id:'episode',title:'慢慢把话说清楚',summary:'在一次次相处里，找到彼此舒服的节奏。',themes:['相处','倾听'],status:'resolved',updated_at:'2026-10-07T12:00:00Z',events:[{occurred_at:'2026-10-07T12:00:00Z',stage:'resolution',summary:'把想法说出来，也等对方说完。',source_quote:'可以慢一点。'}]}],insights:[{id:'lesson',title:'先听完，再回答',confidence:'developing',observation:'有时候，她只是想把今天的事讲完。',lesson:'先陪她把话说完。',next_time:'等她停下来，再问她想怎么做。',support_memory_ids:['one'],updated_at:'2026-10-07T12:00:00Z'}],temperature_events:[{from:'neutral',to:'warm',occurred_at:'2026-10-07T12:00:59Z',summary:'共同完成了一件想做的事。',source_quote:'这样就很好。'}],stats:{reality_events:51,episodes:33,insights:17},temperature_state:{value:'warm'},backfill:{running:false},reality_backfill:{running:false}};
async function main(){
    const app=express();app.use(express.json());let readFails=false,writeFails=false,empty=false,confirmAction=false;const writes=[];
    app.get('/api/relationship-reflections',(_q,r)=>readFails?r.status(503).json({error:'fixture unavailable'}):r.json(empty?{...fixture,reality_events:[],episodes:[],insights:[],temperature_events:[]}:fixture));
    app.post(['/api/reality-events/backfill','/api/relationship-reflections/backfill'],(q,r)=>{writes.push({path:q.path,body:q.body});if(writeFails)return r.status(503).json({error:'fixture failure'});fixture.reality_backfill={running:true,scanned:1,total:20};r.json({success:true,backfill:{total:20}});});
    app.use(express.static(path.join(root,'public')));
    const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let browser;
    try{
        const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
        browser=await puppeteer.launch({executablePath,headless:true});const page=await browser.newPage(),errors=[];
        page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>confirmAction?d.accept():d.dismiss());
        await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith('http')&&!r.url().startsWith('http://127.0.0.1:')?r.abort():r.continue());
        const url=`http://127.0.0.1:${server.address().port}/relationship-growth.html`;
        await page.setViewport({width:1536,height:1024});await page.goto(url,{waitUntil:'networkidle0'});await page.evaluate(()=>document.fonts.ready);
        assert.equal(await page.$eval('.top h1',e=>e.textContent),'成长');
        assert.equal(await page.$eval('.layer-nav [aria-current]',e=>e.textContent),'成长');
        assert.equal(await page.$eval('.episode-title h3',e=>e.textContent),'把海面留在小屋里');
        assert.equal(await page.$$eval('.episode[open]',e=>e.length),1);
        assert.match(await page.$eval('.event-date',e=>e.textContent),/20:53$/,'China time, minute precision');
        assert.equal(await page.$eval('.episode',e=>getComputedStyle(e).borderLeftWidth),'0px','no outside coloured edge');
        assert.equal(await page.$eval('.badge',e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)');
        assert.equal(await page.$eval('.notice',e=>getComputedStyle(e).display),'none');
        assert.equal(writes.length,0,'no automatic backfill');
        await page.screenshot({path:path.join(root,'qa-growth-sea-1536.png')});
        await page.click('.episode .event details summary');assert.equal(await page.$eval('.event details',e=>e.open),true);
        assert.equal(await page.evaluate(()=>window.injected),undefined);
        await page.click('.episode .event details summary');
        await page.focus('.episode-head');await page.keyboard.press('Enter');assert.equal(await page.$eval('.episode',e=>e.open),false);
        await page.evaluate(()=>loadData());assert.equal(await page.$eval('.episode',e=>e.open),false,'refresh preserves chapter state');
        await page.click('.episode-head');
        for(const [tab,selector] of [['episodeTab','.episode'],['temperatureTab','.insight'],['insightTab','.next-time'],['realityTab','.episode']]){
            await page.click('#'+tab);assert.ok(await page.$(selector));
            assert.equal(await page.$eval('#'+tab,e=>e.classList.contains('on')),true);
        }
        await page.click('.growth-tools-toggle');assert.equal(await page.$eval('#growthTools',e=>e.open),true);
        await page.click('#growthTools button[onclick="setLimit(\'MAX\')"]');assert.equal(await page.$eval('#limitInput',e=>e.value),'MAX');
        await page.click('#realityOrganizeBtn');assert.equal(writes.length,0,'cancel does not start a job');
        confirmAction=true;await page.click('#realityOrganizeBtn');await page.waitForFunction(()=>document.querySelector('.growth-tools-toggle span').textContent==='整理中');
        assert.deepEqual(writes[0].body,{limit:'max'});assert.equal(await page.$eval('#realityOrganizeBtn',e=>e.disabled),true);
        fixture.reality_backfill={running:false};await page.evaluate(()=>loadData());
        assert.equal(await page.$eval('#realityOrganizeBtn',e=>e.disabled),false);
        writeFails=true;await page.click('#realityOrganizeBtn');await page.waitForFunction(()=>toast.textContent.includes('fixture failure'));
        await page.keyboard.press('Escape');assert.equal(await page.$eval('#growthTools',e=>e.open),false);
        assert.equal(await page.$eval('.growth-tools-toggle',e=>e===document.activeElement),true);
        await page.evaluate(()=>{clearTimeout(say.timer);toast.style.display='none';});
        for(const width of [1024,393,320]){
            await page.setViewport({width,height:900});await page.click('#realityTab');
            assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no overflow '+width);
            await page.screenshot({path:path.join(root,`qa-growth-sea-${width}.png`)});
            for(const tab of ['episodeTab','temperatureTab','insightTab']){await page.click('#'+tab);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'tab fits '+tab+' '+width);}
            await page.click('.growth-tools-toggle');assert.ok(await page.$eval('#growthTools',e=>e.scrollWidth<=e.clientWidth));
            await page.screenshot({path:path.join(root,`qa-growth-tools-${width}.png`)});await page.keyboard.press('Escape');
        }
        empty=true;await page.evaluate(()=>loadData());assert.match(await page.$eval('#content',e=>e.textContent),/走过之后/);
        readFails=true;await page.evaluate(()=>loadData());assert.ok(await page.$('.growth-retry'));
        readFails=false;empty=false;await page.click('.growth-retry');await page.waitForSelector('.next-time');
        assert.equal(await page.$eval('.top h1',e=>e.textContent),'记忆脉络');
        assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,widths:[1536,1024,393,320],checks:['shared sea','plain paper without edge','four categories','source quotes','chapter keyboard and refresh','manual backfill cancel/success/failure','mobile dialogs','read retry','single appearance']}));
    }finally{await browser?.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
