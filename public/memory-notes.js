/* Opt-in presentation only. Existing memory APIs and mutations remain shared. */
(() => {
    'use strict';
    if (document.documentElement.dataset.visualTheme !== 'new') return;
    const $ = id => document.getElementById(id);
    const paths = {
        pencil:'<path d="m16 3 5 5-12 12-6 1 1-6L16 3Zm-10 11 5 5M14 5l5 5"/>',
        search:'<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',
        filter:'<path d="M3 7h18M3 17h18"/><circle cx="9" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>'
    };
    const icon = name => '<svg class="notes-icon" viewBox="0 0 24 24" aria-hidden="true">'+paths[name]+'</svg>';
    const chinaParts = value => {
        const date = new Date(value);
        if (!Number.isFinite(date.getTime())) return null;
        return Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone:'Asia/Shanghai', year:'numeric', month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).formatToParts(date).map(p => [p.type,p.value]));
    };
    const period = hour => hour < 5 ? '凌晨' : hour < 8 ? '清晨' : hour < 12 ? '上午' : hour < 18 ? '午后' : '夜';
    const compactDate = value => { const p=chinaParts(value); return p ? `${Number(p.month)}.${Number(p.day)} ${period(Number(p.hour))}` : ''; };
    const fullDate = value => { const p=chinaParts(value); return p ? `${p.year}年${Number(p.month)}月${Number(p.day)}日 ${period(Number(p.hour))} ${p.hour}:${p.minute}` : ''; };
    const dayKey = value => { const p=chinaParts(value); return p ? `${p.year}-${p.month}-${p.day}` : 'unknown'; };
    const dayLabel = value => {
        const p=chinaParts(value);
        if (!p) return '未注明日期';
        const weekday=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',weekday:'short'}).format(new Date(value));
        const year=chinaParts(Date.now())?.year;
        return `${p.year!==year?p.year+'年':''}${Number(p.month)}月${Number(p.day)}日 · ${weekday}`;
    };
    let expanded=false, order='time', selected=[], rendered=0, lastDay=null, observer;
    const total=$('totalCount');
    total.className='notes-total'; total.parentElement.removeChild(total);
    document.querySelector('.hero h2').append(total);
    const search=$('searchInput'), wrap=document.createElement('div'); wrap.className='notes-search-wrap';
    search.before(wrap); wrap.innerHTML=icon('search'); wrap.append(search); search.placeholder='搜索记忆…'; search.setAttribute('aria-label','搜索全部记忆');
    const add=document.querySelector('.add'); add.innerHTML=icon('pencil')+'<span>写入</span>'; add.setAttribute('aria-label','写入记忆');
    const filter=document.createElement('button'); filter.type='button'; filter.className='notes-filter'; filter.innerHTML=icon('filter')+'<span>筛选</span>'; filter.setAttribute('aria-label','筛选与整理'); filter.setAttribute('aria-haspopup','dialog');
    add.after(filter);
    document.querySelector('.pill-roleplay>span:not(.pill-icon)').textContent='卡带';
    const tools=document.createElement('dialog'); tools.className='notes-tools'; tools.setAttribute('aria-label','筛选与整理');
    tools.innerHTML='<h2>筛选与整理</h2>'; tools.append(document.querySelector('.sort'));
    const inbox=document.createElement('button'); inbox.type='button'; inbox.className='notes-inbox-button'; inbox.textContent='记忆收件箱';
    inbox.addEventListener('click',()=>{tools.close();openInbox();}); tools.append(inbox);
    const close=document.createElement('button'); close.type='button'; close.className='notes-tools-close'; close.textContent='收起'; close.addEventListener('click',()=>tools.close()); tools.append(close); document.body.append(tools);
    filter.addEventListener('click',()=>{inbox.textContent=MEMORY_EVENTS.length?'记忆收件箱 · '+MEMORY_EVENTS.length:'记忆收件箱';tools.showModal();});
    tools.addEventListener('click',e=>{if(e.target===tools){const r=tools.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)tools.close();}});
    const list=$('memoryList');
    function note(m) {
        const id=esc(m.id), shown=m.category==='roleplay'?stripMemoryLead(m.content):shenRecord(m.content), tags=(m.tags||[]).filter(Boolean);
        const foot=[tags.join('/'),compactDate(m.created_at),sourceLabel(m.source),m.category==='archived'?'冰封':''].filter(Boolean).map(esc).join(' · ');
        const action=(name,label)=>`<button type="button" data-memory-action="${name}">${label}</button>`;
        const actions=m.category==='archived'?action('restore','解封')+action('delete','删除'):action('edit','编辑')+action('resolved',m.resolved?'取消解决标记':'标记解决')+action('delete','删除');
        const selector=multiSelectMode?`<label class="mem-check"><input type="checkbox" aria-label="选择这条记忆" data-memory-check${selectedMemoryIds.has(m.id)?' checked':''}></label>`:'';
        const origin=m.source_quote?`<button type="button" class="notes-origin-toggle" data-memory-action="quote" aria-expanded="false" aria-controls="quote-${id}">${icon('pencil')}原话</button>`:'';
        return `<article class="memory-card cat-${esc(m.category)}${multiSelectMode?' selecting':''}" id="card-${id}" data-memory-id="${id}" data-category="${esc(m.category)}" data-source="${esc(m.source)}" data-heat="${Number(m.liveHeat??m.heat??.5)}">
            ${selector}<details class="notes-menu"><summary aria-label="这条记忆的操作">${icon('pencil')}</summary><div class="notes-menu-actions">${actions}</div></details>
            <div class="memory-content" id="content-${id}">${esc(shown)}</div>
            <footer class="notes-foot">${origin}${origin&&foot?'<span>·</span>':''}<span class="notes-foot-info" title="${esc(fullDate(m.created_at))}">${foot}</span></footer>
            ${m.source_quote?`<blockquote class="notes-quote" id="quote-${id}" hidden><time>${esc(fullDate(m.source_at||m.created_at))}</time>${esc(m.source_quote)}</blockquote>`:''}
            <div id="edit-${id}" style="display:none;margin-top:10px"><textarea id="ta-${id}" aria-label="记忆正文" rows="3">${esc(stripMemoryLead(m.content))}</textarea><input id="tags-${id}" aria-label="记忆标签" value="${esc(tags.join(', '))}"><button class="btn-save" data-memory-action="save">保存</button> <button class="tiny" data-memory-action="cancel">取消</button></div>
        </article>`;
    }
    function matches() {
        const q=search.value.trim().toLocaleLowerCase();
        return ALL_MEMS.filter(m=>m.category===currentCat&&(currentSource==='all'||m.source===currentSource)&&[m.content,m.source_quote,...(m.tags||[])].filter(Boolean).join(' ').toLocaleLowerCase().includes(q)).sort((a,b)=>order==='heat'?(b.liveHeat??b.heat??.5)-(a.liveHeat??a.heat??.5):(Date.parse(b.created_at)||0)-(Date.parse(a.created_at)||0));
    }
    function rows(memories) {
        return memories.map(m=>{
            const day=dayKey(m.created_at), heading=order==='time'&&day!==lastDay?'<h3 class="notes-day">'+esc(dayLabel(m.created_at))+'</h3>':'';
            lastDay=day;return heading+note(m);
        }).join('');
    }
    function isRecent() { return !expanded&&!search.value.trim()&&currentCat==='active'&&currentSource==='all'&&order==='time'; }
    function appendMore() {
        observer?.disconnect(); $('notesMore')?.remove();
        const end=Math.min(selected.length,rendered+40);
        list.insertAdjacentHTML('beforeend',rows(selected.slice(rendered,end))); rendered=end; addMore(); updateBatchUI();
    }
    function addMore() {
        if (rendered>=selected.length) return;
        const more=document.createElement('button'); more.type='button'; more.id='notesMore'; more.className='notes-expand';
        const recent=isRecent(); more.textContent=recent?`展开全部 ${selected.length} 条 →`:'继续翻页 →';
        more.addEventListener('click',()=>{if(recent){expanded=true;appendMore();}else appendMore();});list.append(more);
        // Never auto-expand the ten recent notes. Full results stream in batches.
        if (!recent&&'IntersectionObserver' in window) {
            observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))appendMore();},{rootMargin:'120px'});
            observer.observe(more);
        }
    }
    function paint() {
        observer?.disconnect(); selected=matches(); rendered=Math.min(selected.length,isRecent()?10:40); lastDay=null;
        list.innerHTML=rows(selected.slice(0,rendered))||'<div class="notes-empty">'+(search.value.trim()?'没有找到这段记忆。':'这里还没有记忆。')+'</div>';
        addMore(); updateBatchUI();
    }
    renderMemoryList=paint;
    filterAll=paint;
    setFilter=function(btn,cat,source){document.querySelectorAll('.pill').forEach(x=>x.classList.toggle('active',x===btn));currentCat=cat;currentSource=source;expanded=false;paint();};
    sortByHeat=function(){order='heat';expanded=true;paint();tools.close();};
    sortByTime=function(){order='time';expanded=false;paint();tools.close();};
    const originalToggle=toggleMultiSelect;
    toggleMultiSelect=function(force){tools.close();originalToggle(force);};
    list.addEventListener('change',e=>{if(e.target.matches('[data-memory-check]'))toggleMemorySelected(e.target.closest('[data-memory-id]').dataset.memoryId,e.target.checked);});
    list.addEventListener('click',e=>{
        const button=e.target.closest('[data-memory-action]');if(!button)return;
        const card=button.closest('[data-memory-id]'),id=card.dataset.memoryId,m=ALL_MEMS.find(x=>String(x.id)===id);if(!m)return;
        const action=button.dataset.memoryAction;
        if(action==='quote'){const quote=$('quote-'+id);quote.hidden=!quote.hidden;button.setAttribute('aria-expanded',String(!quote.hidden));return;}
        card.querySelector('.notes-menu').open=false;
        if(action==='edit'){startEdit(id);$('ta-'+id).focus();}
        else if(action==='cancel')cancelEdit(id);
        else if(action==='save')saveEdit(id);
        else if(action==='resolved')toggleResolved(id,!!m.resolved);
        else if(action==='restore')restoreMemory(id);
        else if(action==='delete')(m.category==='archived'?deleteArchivedMemory:deleteMemory)(id);
    });
    document.addEventListener('click',e=>document.querySelectorAll('.notes-menu[open]').forEach(menu=>{if(!menu.contains(e.target))menu.open=false;}));
    document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.notes-menu[open]').forEach(menu=>menu.open=false);});
    window.addEventListener('storage',e=>{if(e.key==='syzygy_visual_theme'||e.key==='syzygy_home_layout')location.reload();});
    window.MemoryNotes=Object.freeze({fullDate});
    if(ALL_MEMS.length)paint();
})();
