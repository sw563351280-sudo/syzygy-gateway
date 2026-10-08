/* New presentation over the existing reflections API; no automatic backfills. */
(() => {
    'use strict';
    if(document.documentElement.dataset.visualTheme!=='new')return;
    const $=id=>document.getElementById(id);
    const intro=document.querySelector('.intro');
    document.querySelector('.top h1').textContent='成长';
    document.querySelector('.top p').textContent='正在连起来的线';
    document.querySelector('.intro h2').textContent='一起走过的事';
    const nav=document.createElement('nav'); nav.className='layer-nav'; nav.setAttribute('aria-label','记忆库分类');
    for(const [text,url,active] of [['恒星','long-term.html',false],['成长','relationship-growth.html',true],['星尘','stardust.html',false],['彗星','comets.html',false]]){
        const a=document.createElement('a');a.textContent=text;a.href='/'+url+'?pwd='+encodeURIComponent(PWD);
        if(active){a.className='on';a.setAttribute('aria-current','page');}nav.append(a);
    }
    document.querySelector('.top').append(nav);
    const stats=document.querySelector('.stats');
    const reality=$('realityCount'),temperature=$('temperatureState'),episodes=$('episodeCount'),insights=$('insightCount');
    stats.replaceChildren();
    for(const [number,text] of [[reality,' 段现实经历'],[episodes,' 段相处过程'],[insights,' 条心得']]){
        const span=document.createElement('span');span.className='stat';span.append(number,document.createTextNode(text));stats.append(span);
    }
    const state=document.createElement('span');state.className='stat growth-temperature';state.append(document.createTextNode('此刻：'),temperature);stats.append(state);
    const toggle=document.createElement('button');toggle.type='button';toggle.className='growth-tools-toggle';toggle.setAttribute('aria-haspopup','dialog');toggle.setAttribute('aria-controls','growthTools');
    toggle.innerHTML='<svg class="growth-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h18M3 17h18"/><circle cx="9" cy="7" r="3"/><circle cx="16" cy="17" r="3"/></svg><span>整理</span>';
    intro.append(toggle);
    const tools=document.createElement('dialog');tools.id='growthTools';tools.className='growth-tools';tools.setAttribute('aria-labelledby','growthToolsTitle');
    const title=document.createElement('h2');title.id='growthToolsTitle';title.textContent='整理';tools.append(title,document.querySelector('.organizer'));
    const close=document.createElement('button');close.type='button';close.className='growth-tools-close';close.textContent='收起';close.addEventListener('click',()=>tools.close());tools.append(close);document.body.append(tools);
    toggle.addEventListener('click',()=>tools.showModal());
    tools.addEventListener('close',()=>toggle.setAttribute('aria-expanded','false'));
    toggle.addEventListener('click',()=>toggle.setAttribute('aria-expanded','true'));
    tools.addEventListener('click',event=>{if(event.target===tools){const r=tools.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)tools.close();}});
    function dateParts(value){
        const date=new Date(value);if(!value||!Number.isFinite(date.getTime()))return null;
        return Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
    }
    function shortDate(value){const p=dateParts(value);if(!p)return'';const h=Number(p.hour);return `${Number(p.month)}.${Number(p.day)} ${h<5?'凌晨':h<8?'清晨':h<12?'上午':h<18?'午后':'夜'}`;}
    fmt=function(value){
        const p=dateParts(value);if(!p)return'';
        const currentYear=new Date().toLocaleDateString('en-GB',{timeZone:'Asia/Shanghai',year:'numeric'}),h=Number(p.hour);
        return `${p.year!==currentYear?p.year+'年':''}${Number(p.month)}月${Number(p.day)}日 · ${h<5?'凌晨':h<8?'清晨':h<12?'上午':h<18?'午后':'夜'} ${p.hour}:${p.minute}`;
    };
    let renderedView;
    const originalRender=render;
    const originalStartBackfill=startBackfill;
    startBackfill=async function(kind){try{await originalStartBackfill(kind);}catch(_){say('整理暂时未能开始，请稍后再试。');}};
    render=function(){
        const preserve=renderedView===VIEW;
        const states=new Map(preserve?[...$('content').querySelectorAll('.episode')].map(el=>[el.dataset.growthId,el.open]):[]);
        DATA.temperature_events=newestFirst(DATA.temperature_events,item=>item.occurred_at||item.updated_at||item.created_at);
        DATA.insights=newestFirst(DATA.insights);
        originalRender();
        const items=VIEW==='reality'?DATA.reality_events:VIEW==='episodes'?DATA.episodes:VIEW==='temperature'?DATA.temperature_events:DATA.insights;
        $('content').querySelectorAll('.episode').forEach((chapter,index)=>{
            const item=items[index],id=VIEW+':'+(item.id||item._id||index);chapter.dataset.growthId=id;
            if(states.has(id))chapter.open=states.get(id);
            const keywords=chapter.querySelector('.themes');
            const tags=[...keywords.querySelectorAll('.theme')].map(el=>el.textContent);
            keywords.textContent=[tags.join(' · '),shortDate(item.updated_at||item.created_at)].filter(Boolean).join(' · ');
            keywords.hidden=!keywords.textContent;
        });
        $('content').querySelectorAll('.event details summary').forEach(summary=>summary.textContent='当时的原话');
        const empty=$('content').querySelector('.empty');
        if(empty)empty.textContent=VIEW==='reality'?'这里还没有写下新的经历。':VIEW==='episodes'?'这一页，还等着我们慢慢写。':VIEW==='temperature'?'暂时没有新的变化。':'有些事，走过之后才慢慢懂。';
        const running=!!(DATA.backfill?.running||DATA.reality_backfill?.running);
        tools.classList.toggle('has-running',running);toggle.querySelector('span').textContent=running?'整理中':'整理';
        renderedView=VIEW;
    };
    if(Object.keys(DATA.stats||{}).length||DATA.reality_events?.length||DATA.episodes?.length)render();
    window.GrowthSea=Object.freeze({tools});
})();
