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
  const executablePath=[process.env.PUPPETEER_EXECUTABLE_PATH,'/snap/bin/chromium','/usr/bin/chromium','/usr/bin/google-chrome','C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(fs.existsSync);
  browser=await puppeteer.launch({executablePath,headless:true,args:['--mute-audio','--no-sandbox','--disable-setuid-sandbox']});const errors=[];
  async function tab(){const p=await browser.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.dismiss());await p.setRequestInterception(true);p.on('request',r=>r.url().startsWith('http')&&!r.url().startsWith('http://127.0.0.1:')?r.abort():r.continue());await p.evaluateOnNewDocument(()=>{window.__themeNow=Date.parse('2026-10-09T12:00:00+08:00');Date.now=()=>window.__themeNow;});return p;}
  async function phase(p,time){await p.evaluate(value=>{window.__themeNow=Date.parse(value);SeaCycle.update();},time);}
  async function check(p,phaseName){const state=await p.evaluate(()=>({phase:document.documentElement.dataset.seaCycle,theme:document.documentElement.dataset.visualTheme,image:getComputedStyle(document.body,'::before').backgroundImage,rootImage:getComputedStyle(document.documentElement).backgroundImage,bodyBackground:getComputedStyle(document.body).backgroundColor,themeMeta:document.querySelector('meta[name="theme-color"]'),overflow:document.documentElement.scrollWidth>innerWidth,section:document.querySelector('.section.active')?getComputedStyle(document.querySelector('.section.active')).backgroundImage:'none',oldArt:document.querySelector('.section.active')?getComputedStyle(document.querySelector('.section.active'),'::before').content:'none'}));assert.equal(state.theme,'new');assert.equal(state.phase,phaseName);const expected=phaseName==='day'?/(ice-sea-home-v2|blob:)/:/(ice-sea-night-v1|blob:)/;assert.match(state.image,expected);assert.match(state.rootImage,expected,'root canvas must carry the wallpaper into the iOS status area');assert.equal(state.bodyBackground,'rgba(0, 0, 0, 0)');assert.equal(state.themeMeta,null,'a solid theme-color must not cover the translucent iOS status area');assert.equal((state.image.match(/linear-gradient/g)||[]).length,1,'only the dim layer may cover the full-viewport wallpaper');assert.equal(state.overflow,false,p.url());assert.equal(state.section,'none');assert.equal(state.oldArt,'none');}
  const p=await tab();await p.setViewport({width:1280,height:950});const base=`http://127.0.0.1:${server.address().port}`;
  await p.goto(base,{waitUntil:'networkidle0'});await check(p,'day');
  const firstDailyLine=await p.$eval('#seaDailyLine',e=>({text:e.textContent,height:e.getBoundingClientRect().height,stored:localStorage.getItem('syzygy_home_daily_line_v1')}));
  assert.ok(firstDailyLine.text);assert.ok(firstDailyLine.stored);await p.click('#seaDailyLine');await new Promise(r=>setTimeout(r,220));
  const changedDailyLine=await p.$eval('#seaDailyLine',e=>({text:e.textContent,height:e.getBoundingClientRect().height,stored:localStorage.getItem('syzygy_home_daily_line_v1')}));
  assert.notEqual(changedDailyLine.text,firstDailyLine.text,'manual change must not repeat the current line');assert.equal(changedDailyLine.height,firstDailyLine.height,'short and long lines keep a stable two-line slot');
  await p.reload({waitUntil:'networkidle0'});assert.equal(await p.$eval('#seaDailyLine',e=>e.textContent),changedDailyLine.text,'the chosen line stays fixed across same-day refreshes');
  const homeText=await p.evaluate(()=>({hero:getComputedStyle(document.querySelector('.home-v2-hero')).textShadow,today:getComputedStyle(document.querySelector('.sea-today')).textShadow,updates:getComputedStyle(document.querySelector('.sea-updates')).textShadow}));
  assert.deepEqual(homeText,{hero:'none',today:'none',updates:'none'},'home text should stay crisp without contrast shadows');
  assert.equal(await p.$eval('#appearanceController',e=>e.childElementCount),0,'hidden appearance previews should stay lazy');
  await p.evaluate(()=>{getActiveSession().messages=[{role:'user',content:'今天的海面很好看。'},{role:'assistant',versions:[{content:'我在。慢慢说，不用急着把所有的话讲完。\n\n那些想留下来的事，我们就一点点记下来。',time:'14:19',fullTime:'2026-10-09T06:19:00Z'}],activeVersion:0}];});
  await p.evaluate(()=>goView('settings'));await p.waitForSelector('[data-appearance-range="cardTransparency"]');
  const slider=await p.evaluate(async()=>{
   const input=document.querySelector('[data-appearance-range="cardTransparency"]'),same=input,before=localStorage.getItem('syzygy_appearance_v1');let changes=0;
   addEventListener('sea-appearance-change',()=>changes++);input.value='61';input.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(requestAnimationFrame);
   const root=getComputedStyle(document.documentElement),during=localStorage.getItem('syzygy_appearance_v1'),nodeStayed=document.querySelector('[data-appearance-range="cardTransparency"]')===same,preview=root.getPropertyValue('--sea-card-opacity').trim(),glassBlur=root.getPropertyValue('--sea-glass-blur').trim(),composerOpacity=root.getPropertyValue('--sea-composer-opacity').trim();
   input.dispatchEvent(new Event('change',{bubbles:true}));
   return {before,during,after:localStorage.getItem('syzygy_appearance_v1'),nodeStayed,preview,glassBlur,composerOpacity,changes};
  });
  assert.equal(slider.during,slider.before,'range input should not persist while dragging');assert.notEqual(slider.after,slider.before);assert.equal(slider.nodeStayed,true);assert.equal(slider.preview,'0.39');assert.equal(slider.glassBlur,'4.7px');assert.equal(slider.composerOpacity,'0.47');assert.equal(slider.changes,1);
  await p.evaluate(()=>goView('chat'));
  const composer=await p.evaluate(()=>{const bar=document.querySelector('.chat-bottom-bar'),input=document.querySelector('#chatInput'),style=getComputedStyle(bar),glass=getComputedStyle(bar,'::before'),assistant=document.querySelector('.msg.sys'),assistantStyle=getComputedStyle(assistant),user=document.querySelector('.msg.user'),userStyle=getComputedStyle(user),top=getComputedStyle(document.querySelector('.chat-home-pill'));return {barBackground:style.backgroundColor,barBackdrop:style.backdropFilter,barBorder:style.borderTopColor,barShadow:style.boxShadow,inputBackground:getComputedStyle(input).backgroundColor,inputBackdrop:getComputedStyle(input).backdropFilter,inputTextShadow:getComputedStyle(input).textShadow,glassBackground:glass.backgroundColor,glassBackdrop:glass.backdropFilter,assistantBackground:assistantStyle.backgroundColor,assistantBackdrop:assistantStyle.backdropFilter,assistantBorder:assistantStyle.borderTopColor,assistantShadow:assistantStyle.boxShadow,assistantTextShadow:assistantStyle.textShadow,userBackground:userStyle.backgroundColor,userBackdrop:userStyle.backdropFilter,userTextShadow:userStyle.textShadow,topBackground:top.backgroundColor,topBackdrop:top.backdropFilter,topShadow:top.boxShadow};});
  assert.equal(composer.barBackdrop,'none');assert.equal(composer.inputBackdrop,'none');assert.equal(composer.barBackground,'rgba(0, 0, 0, 0)');assert.equal(composer.inputBackground,'rgba(0, 0, 0, 0)');assert.notEqual(composer.glassBackground,'rgba(0, 0, 0, 0)');
  assert.equal(composer.assistantBackground,'rgba(222, 238, 248, 0.39)');assert.equal(composer.userBackground,'rgba(201, 230, 239, 0.39)');assert.equal(composer.glassBackground,'rgba(222, 238, 248, 0.47)');assert.equal(composer.topBackground,'rgba(222, 238, 248, 0.39)');
  for(const value of [composer.assistantBackdrop,composer.userBackdrop,composer.glassBackdrop,composer.topBackdrop])assert.match(value,/blur\(4\.7px\)/);
  for(const value of [composer.assistantShadow,composer.barShadow,composer.topShadow])assert.match(value,/inset/,'glass edges keep a restrained inner highlight');
  assert.equal(composer.assistantBorder,composer.barBorder,'bubbles and composer share one bright glass edge');
  assert.equal(composer.assistantTextShadow,'none');assert.equal(composer.userTextShadow,'none');assert.equal(composer.inputTextShadow,'none');
  await p.evaluate(()=>SeaTheme.setAdjustments({cardTransparency:85,dayTextColor:'#e8e0d4'}));
  const clearGlass=await p.evaluate(()=>({bubble:getComputedStyle(document.querySelector('.msg.sys')).backgroundColor,bubbleBackdrop:getComputedStyle(document.querySelector('.msg.sys')).backdropFilter,input:getComputedStyle(document.querySelector('.chat-bottom-bar'),'::before').backgroundColor,color:getComputedStyle(document.querySelector('.msg.sys')).color}));
  assert.equal(clearGlass.bubble,'rgba(222, 238, 248, 0.15)');assert.equal(clearGlass.input,'rgba(222, 238, 248, 0.18)');assert.match(clearGlass.bubbleBackdrop,/blur\(1\.8px\)/);assert.equal(clearGlass.color,'rgb(232, 224, 212)');
  await p.evaluate(()=>SeaTheme.setAdjustments({cardTransparency:61,dayTextColor:'#1a3a5c'}));
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
  await p.evaluate(()=>SeaTheme.setAdjustments({cardTransparency:47,dayDim:12,nightDim:23,blur:4}));
  await second.waitForFunction(()=>getComputedStyle(document.documentElement).getPropertyValue('--sea-background-blur').trim()==='4px');
  assert.equal(await second.$eval('html',e=>getComputedStyle(e).getPropertyValue('--sea-card-opacity').trim()),'0.53');
  await p.evaluate(async()=>SeaTheme.saveWallpaper('global','day',new Blob(['global-day'],{type:'image/png'})));
  await second.waitForFunction(()=>getComputedStyle(document.body,'::before').backgroundImage.includes('blob:'));
  await p.evaluate(async()=>SeaTheme.saveWallpaper('chat','night',new Blob(['chat-night'],{type:'image/png'})));
  await p.evaluate(()=>goView('chat'));await phase(p,'2026-10-09T20:00:00+08:00');
  assert.deepEqual(await p.evaluate(async()=>({direct:(await SeaTheme.directWallpaper('chat','night')).size,exceptions:Object.keys(SeaTheme.settings().exceptions)})),{direct:10,exceptions:['chat']});
  await p.evaluate(async()=>SeaTheme.removeWallpaper('chat','night'));assert.deepEqual(await p.evaluate(()=>Object.keys(SeaTheme.settings().exceptions)),[]);
  assert.equal(await p.$eval('#chatInput',e=>e.value),'还没有发出去的话');
  const documents=['long-term','relationship-growth','comets','stardust','memory-vault','sensors','xhs-walk'];
  for(const doc of documents){await second.goto(base+'/'+doc+'.html',{waitUntil:'networkidle0'});for(const width of [1280,393]){await second.setViewport({width,height:950});await phase(second,'2026-10-09T12:00:00+08:00');await check(second,'day');await phase(second,'2026-10-09T20:00:00+08:00');await check(second,'night');} }
  await second.goto(base+'/long-term.html',{waitUntil:'networkidle0'});assert.equal(await second.$eval('.pill',e=>getComputedStyle(e).color),'rgb(117, 99, 71)');await second.screenshot({path:path.join(root,'qa-global-memory-day.png')});await phase(second,'2026-10-09T20:00:00+08:00');await second.screenshot({path:path.join(root,'qa-global-memory-night.png')});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,views,documents,widths:[1280,393],checks:['daily home line persistence and stable slot','full-viewport shared backgrounds','lazy appearance previews','range preview and commit','transparency-linked crystal glass bubbles, controls and composer','stable chat composer layer','automatic 07:00 and 18:00 boundaries','draft retained','cross-window adjustments','wallpaper inheritance and page exceptions'],pageErrors:errors}));
 }finally{await browser?.close();ws.clients.forEach(c=>c.terminate());ws.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
