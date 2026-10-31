'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const puppeteer = require('puppeteer-core');
const { createXhsMcp } = require('../xhs-mcp');
(async () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-ui-'));
 let calls = 0, browser, server;
 const gate = createXhsMcp({dataDir:dir,interval:0,invoke:async(name,args)=>{ calls++; return {content:[{type:'text',text: name === 'get_login_qrcode' ? '扫码入口已准备' : '操作成功'}]}; }});
 try {
  const app = express();
  app.use('/api/xhs-mcp',require('../xhs-mcp-router')(gate,async()=>({contentType:'image/png',buffer:Buffer.from('fixture')}),100));
  app.use(express.static(path.join(__dirname,'../public')));
  server = app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const pending = JSON.parse(await gate.execute('like_feed',{feed_id:'note-one'}));
  assert.equal(calls,0);
  for (const headers of [{}, {Origin:'https://foreign.example','X-XHS-Confirm':'1'}, {Origin:origin}]) {
   const r=await fetch(`${origin}/api/xhs-mcp/approval/${pending.id}`,{method:'POST',headers});assert.equal(r.status,403);
  }
  browser=await puppeteer.launch({executablePath:'/var/lib/syzygy-xhs/.cache/xiaohongshu-mcp/browser/148.0.7778.215/browser/chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const page=await browser.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewport({width:393,height:852});
  await page.goto(`${origin}${pending.confirmation_url}`,{waitUntil:'networkidle0'});
  assert.equal(calls,0);assert.equal(await page.$eval('#confirm',b=>b.disabled),false);
  assert.match(await page.$eval('#details',e=>e.textContent),/note-one/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.click('#confirm');await page.waitForFunction(()=>document.getElementById('result').textContent.includes('操作成功'));
  assert.equal(calls,1);
  await page.reload({waitUntil:'networkidle0'});assert.equal(await page.$eval('#confirm',b=>b.disabled),true);assert.equal(calls,1);
  await page.goto(`${origin}/xhs-connect.html`,{waitUntil:'networkidle0'});assert.equal(calls,1);
  await page.click('#qr');await page.waitForFunction(()=>document.getElementById('result').textContent.includes('扫码入口已准备'));assert.equal(calls,2);
  assert.deepEqual(errors,[]);
  console.log('PASS: mobile confirmation, no automatic writes, exact action once, reload lock, CSRF rejection, explicit QR and no page errors');
 } finally {await browser?.close();server?.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
