'use strict';
// Shared theme fixtures only: no personal content, model calls or production writes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const express=require('express'),puppeteer=require('puppeteer-core'),{WebSocketServer}=require('ws');
const root=path.join(__dirname,'..');
async function main(){
 const app=express();app.use(express.json());
 app.get('/api/home/summary',(_q,r)=>r.json({days:535,date:'2026-10-09',nextMilestone:600,todos:[],schedules:[],letter:null,calendarAvailable:true,musicAvailable:false}));
 app.get('/api/sync-config',(_q,r)=>r.json({chatSessions:[],suppliers:[]}));
 app.get('/api/music/status',(_q,r)=>r.json({csrfToken:'fixture',configured:false,session:{state:'closed',mode:'local'}}));
 app.get('/api/longterm-page-data',(_q,r)=>r.json({memories:[{id:'memory-fixture',category:'active',source:'manual',content:'她喜欢清晨的海，蓝色里带一点灰，光落在水面上。有波纹也很好。',tags:['海面'],created_at:'2026-10-09T06:19:00Z',heat:1}],counts:{},crumbs:[],anticipations:[],memoryEvents:[]}));
 app.get('/api/relationship-reflections',(_q,r)=>r.json({reality_events:[],episodes:[],insights:[],temperature_events:[],stats:{},temperature_state:{},backfill:{},reality_backfill:{}}));
 app.get('/api/anticipations',(_q,r)=>r.json({anticipations:[]}));
 app.get('/api/private-journal',(_q,r)=>r.json({entries:[{id:'fixture',title:'海面还很安静',created_at:'2026-10-09T06:19:00Z',visibility:'sealed',content:null}],total:1}));
 app.use('/api',(_q,r)=>r.json({success:true,config:{},data:[],status:{},favorites:[],todos:[],active:[],records:[],items:[],entries:[]}));
 app.get('/diary-logs',(_q,r)=>r.json([]));app.use(express.static(path.join(root,'public')));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const ws=new WebSocketServer({server});let browser;
 try{
  const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
  browser=await puppeteer.launch({executablePath,headless:true,args:['--mute-audio']});const errors=[];
  async function tab(){const p=await browser.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.dismiss());await p.setRequestInterception(true);p.on('request',r=>r.url().startsWith('http')&&!r.url().startsWith('http://127.0.0.1:')?r.abort():r.continue());await p.evaluateOnNewDocument(()=>{if(!localStorage.getItem('syzygy_visual_theme'))localStorage.setItem('syzygy_visual_theme','new');window.__themeNow=Date.parse('2026-10-09T12:00:00+08:00');Date.now=()=>window.__themeNow;});return p;}
  async function phase(p,time){await p.evaluate(value=>{window.__themeNow=Date.parse(value);SeaCycle.update();},time);}
  async function check(p,phaseName){const state=await p.evaluate(()=>({phase:document.documentElement.dataset.seaCycle,theme:document.documentElement.dataset.visualTheme,image:getComputedStyle(document.body,'::before').backgroundImage,overflow:document.documentElement.scrollWidth>innerWidth,section:document.querySelector('.section.active')?getComputedStyle(document.querySelector('.section.active')).backgroundImage:'none',oldArt:document.querySelector('.section.active')?getComputedStyle(document.querySelector('.section.active'),'::before').content:'none'}));assert.equal(state.theme,'new');assert.equal(state.phase,phaseName);assert.match(state.image,phaseName==='day'?/ice-sea-home-v2/:/ice-sea-night-v1/);assert.equal(state.overflow,false,p.url());assert.equal(state.section,'none');assert.equal(state.oldArt,'none');}
  const p=await tab();await p.setViewport({width:1280,height:950});const base=`http://127.0.0.1:${server.address().port}`;
  await p.goto(base,{waitUntil:'networkidle0'});await check(p,'day');await p.evaluate(()=>{getActiveSession().messages=[{role:'user',content:'今天的海面很好看。'},{role:'assistant',versions:[{content:'我在。慢慢说，不用急着把所有的话讲完。\n\n那些想留下来的事，我们就一点点记下来。',time:'14:19',fullTime:'2026-10-09T06:19:00Z'}],activeVersion:0}];});
  const views=['home','chat','private-journal','favorites','flo','state','codex-settings','settings','work-records','tt-memories','ledger','calendar','album','dev','console','shen-settings'];
  for(const width of [1280,393]){
   await p.setViewport({width,height:950});
   for(const name of views){await p.evaluate(v=>goView(v),name);await new Promise(r=>setTimeout(r,100));await phase(p,'2026-10-09T12:00:00+08:00');await check(p,'day');if(width===393&&['chat','settings','calendar'].includes(name))await p.screenshot({path:path.join(root,`qa-global-${name}-day.png`)});await phase(p,'2026-10-09T20:00:00+08:00');await check(p,'night');if(width===393&&['chat','settings','calendar'].includes(name))await p.screenshot({path:path.join(root,`qa-global-${name}-night.png`)});}
  }
  await p.evaluate(()=>{goView('chat');document.querySelector('#chatInput').value='还没有发出去的话';window.__themeSentinel='same document';});
  await phase(p,'2026-10-09T17:59:59.900+08:00');
  await p.evaluate(()=>{window.__themeNow=Date.parse('2026-10-09T18:00:00+08:00');});
  await p.waitForFunction(()=>document.documentElement.dataset.seaCycle==='night');await check(p,'night');
  assert.equal(await p.$eval('#chatInput',e=>e.value),'还没有发出去的话');assert.equal(await p.evaluate(()=>window.__themeSentinel),'same document');
  await phase(p,'2026-10-09T06:59:59.900+08:00');await p.evaluate(()=>{window.__themeNow=Date.parse('2026-10-09T07:00:00+08:00');});await p.waitForFunction(()=>document.documentElement.dataset.seaCycle==='day');await check(p,'day');
  await p.setViewport({width:1280,height:950});await p.evaluate(()=>goView('private-journal'));await p.waitForSelector('.journal-sea-row');await p.screenshot({path:path.join(root,'qa-global-journal-day.png')});
  await phase(p,'2026-10-09T20:00:00+08:00');await p.screenshot({path:path.join(root,'qa-global-journal-night.png')});
  const second=await tab();await second.goto(base+'/comets.html',{waitUntil:'networkidle0'});await check(second,'day');
  await p.evaluate(()=>applyVisualTheme('classic'));await second.waitForFunction(()=>document.documentElement.dataset.visualTheme==='classic');
  await p.evaluate(()=>applyVisualTheme('new'));await second.waitForFunction(()=>document.documentElement.dataset.visualTheme==='new');await check(second,'day');
  // A standalone theme choice must update the already-open main app without losing its draft.
  await second.evaluate(()=>{localStorage.setItem('syzygy_visual_theme','classic');SeaTheme.sync();});await p.waitForFunction(()=>document.documentElement.dataset.visualTheme==='classic');
  await second.evaluate(()=>{localStorage.setItem('syzygy_visual_theme','new');SeaTheme.sync();});await p.waitForFunction(()=>document.documentElement.dataset.visualTheme==='new');assert.equal(await p.$eval('#chatInput',e=>e.value),'还没有发出去的话');
  const documents=['long-term','relationship-growth','comets','stardust','memory-vault','sensors','xhs-walk'];
  for(const doc of documents){await second.goto(base+'/'+doc+'.html',{waitUntil:'networkidle0'});for(const width of [1280,393]){await second.setViewport({width,height:950});await phase(second,'2026-10-09T12:00:00+08:00');await check(second,'day');await phase(second,'2026-10-09T20:00:00+08:00');await check(second,'night');} }
  await second.goto(base+'/long-term.html',{waitUntil:'networkidle0'});assert.equal(await second.$eval('.pill',e=>getComputedStyle(e).color),'rgb(117, 99, 71)');await second.screenshot({path:path.join(root,'qa-global-memory-day.png')});await phase(second,'2026-10-09T20:00:00+08:00');await second.screenshot({path:path.join(root,'qa-global-memory-night.png')});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,views,documents,widths:[1280,393],checks:['shared backgrounds','automatic 07:00 and 18:00 boundaries','draft retained','cross-window classic/new sync'],pageErrors:errors}));
 }finally{await browser?.close();ws.clients.forEach(c=>c.terminate());ws.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
