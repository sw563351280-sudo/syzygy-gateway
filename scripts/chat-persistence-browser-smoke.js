'use strict';
// Uses synthetic data on localhost. Never contacts production or reads chats.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const puppeteer = require('puppeteer-core');
const { WebSocketServer } = require('ws');
const { historyPage, mergePartialSession } = require('../chat-history');

async function main() {
    let version=1, stalled=true, posts=0;
    let sessions=[{id:'main',name:'fixture',messages:Array.from({length:250},(_,i)=>({
        _id:'fixture-'+i,role:i%2?'assistant':'user',versions:[{content:'fixture '+i,fullTime:new Date(1700000000000+i*1000).toISOString()}],activeVersion:0
    }))}];
    const app=express(); app.use(express.json({limit:'4mb'}));
    app.get('/api/sync-config',(req,res)=>{
        const result=structuredClone(sessions), windows={};
        if(req.query.mainLimit) {
            const page=historyPage(result[0].messages,result[0].messages.length,80);
            result[0].messages=page.messages;
            windows.main={start:page.start,total:page.total,hasMore:page.hasMore,partial:page.hasMore};
        }
        res.json({_version:version,chatSessions:result,_historyWindows:windows,suppliers:[],activeChatId:'main'});
    });
    app.post('/api/sync-config',(req,res)=>{
        posts++;
        if(stalled) return; // Simulate a request suspended while iOS terminates the page.
        if(req.body._version!==version) return res.json({_rejected:true,_version:version});
        sessions=req.body.chatSessions.map(s=>mergePartialSession(sessions.find(x=>x.id===s.id),s,req.body._historyWindows?.[s.id]));
        res.json({success:true,_version:++version});
    });
    app.get('/api/favorites',(_req,res)=>res.json({favorites:[]}));
    app.get('/api/todos',(_req,res)=>res.json({active:[],shen:[],fish:[]}));
    app.get('/api/period',(_req,res)=>res.json({status:{inPeriod:false},records:[]}));
    app.get('/api/music/status',(_req,res)=>res.json({configured:false,session:{mode:'local',state:'idle',offers:[]}}));
    app.post('/api/fetch-models',(_req,res)=>res.json({data:[]}));
    app.use('/api',(_req,res)=>res.json({success:true,data:[],tasks:[],tools:{},servers:[],config:{}}));
    app.use(express.static(path.join(__dirname,'../public')));
    const server=app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
    const ws=new WebSocketServer({server});
    let browser;
    const errors=[];
    try {
        const executablePath=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/chromium'].find(p=>p&&fs.existsSync(p));
        browser=await puppeteer.launch({executablePath,headless:true,defaultViewport:{width:393,height:852}});
        const origin='http://127.0.0.1:'+server.address().port;
        async function open() {
            const page=await browser.newPage();
            page.on('pageerror',e=>errors.push(e.message));
            await page.setRequestInterception(true);
            page.on('request',r=>r.url().startsWith('http')&&!r.url().startsWith(origin)?r.abort():r.continue());
            await page.goto(origin,{waitUntil:'domcontentloaded'});
            await page.waitForFunction(()=>typeof _dataVersion!=='undefined'&&_dataVersion>0);
            return page;
        }
        let page=await open();
        await page.evaluate(()=>{
            chatSessions.find(s=>s.id==='main').messages.push({_id:'unsaved-reply',role:'assistant',versions:[{content:'must survive termination',fullTime:new Date().toISOString()}],activeVersion:0});
            saveToCloud(true);
        });
        await page.waitForFunction(()=>JSON.parse(localStorage.getItem('syzygy_pending_chat_v1')).sessions.some(s=>s.messages.some(m=>m._id==='unsaved-reply')));
        assert.equal(sessions[0].messages.length,250);
        await page.close();
        stalled=false;
        page=await open();
        await page.waitForFunction(()=>!_chatJournal.hasPending()&&!_savingNow);
        assert.equal(sessions.find(s=>s.id==='main').messages.length,251);
        assert.equal(sessions[0].messages.filter(m=>m._id==='unsaved-reply').length,1);
        assert.equal(sessions[0].messages[0]._id,'fixture-0');
        await page.reload({waitUntil:'domcontentloaded'});
        await page.waitForFunction(()=>typeof _dataVersion!=='undefined'&&_dataVersion>=2);
        assert.equal(sessions[0].messages.length,251);
        assert.deepEqual(errors,[]);
        console.log(JSON.stringify({closedDuringSave:true,reopenedAndSaved:true,historyCount:251,duplicateCount:0,posts,pageErrors:errors}));
    } finally {
        if(browser) await browser.close();
        ws.close(); server.closeAllConnections(); await new Promise(r=>server.close(r));
    }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
