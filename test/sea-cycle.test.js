'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
const {phaseAt,nextBoundary}=require('../public/sea-cycle');
test('home day is exactly 07:00 inclusive through 18:00 exclusive in Shanghai',()=>{
    for(const [time,phase] of [
        ['2026-10-07T06:59:59.999+08:00','night'],
        ['2026-10-07T07:00:00+08:00','day'],
        ['2026-10-07T17:59:59.999+08:00','day'],
        ['2026-10-07T18:00:00+08:00','night'],
        ['2026-10-08T00:00:00+08:00','night']
    ])assert.equal(phaseAt(Date.parse(time)),phase,time);
});
test('open tabs schedule the next switch across midnight and month/year boundaries',()=>{
    for(const [time,next] of [
        ['2026-10-07T06:59:00+08:00','2026-10-07T07:00:00+08:00'],
        ['2026-10-07T07:00:00+08:00','2026-10-07T18:00:00+08:00'],
        ['2026-10-07T18:00:00+08:00','2026-10-08T07:00:00+08:00'],
        ['2026-12-31T23:59:00+08:00','2027-01-01T07:00:00+08:00']
    ])assert.equal(nextBoundary(Date.parse(time)),Date.parse(next),time);
});
test('a page actually switches at its timer and refreshes after returning from sleep',()=>{
    let now=Date.parse('2026-10-07T06:59:00+08:00'),scheduled;
    const listeners={},document={documentElement:{dataset:{}},hidden:false,addEventListener:(name,fn)=>listeners[name]=fn};
    const window={document,dispatchEvent:()=>{},addEventListener:(name,fn)=>listeners[name]=fn};
    class ClockDate extends Date { static now(){return now;} }
    vm.runInNewContext(fs.readFileSync(require.resolve('../public/sea-cycle'),'utf8'),{window,Date:ClockDate,Event:class{},setTimeout:(fn,delay)=>{scheduled={fn,delay};return 1;},clearTimeout:()=>{}});
    assert.equal(document.documentElement.dataset.seaCycle,'night');
    assert.equal(scheduled.delay,60050);
    now=Date.parse('2026-10-07T07:00:00.050+08:00');scheduled.fn();
    assert.equal(document.documentElement.dataset.seaCycle,'day');
    now=Date.parse('2026-10-07T20:00:00+08:00');listeners.visibilitychange();
    assert.equal(document.documentElement.dataset.seaCycle,'night');
});
