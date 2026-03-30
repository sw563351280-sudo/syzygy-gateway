// ==================== 星墨星空 ====================
(function(){
    const c=document.getElementById('starmap'),x=c.getContext('2d');
    let w,h,stars=[],trails=[];
    function resize(){w=c.width=innerWidth;h=c.height=innerHeight}
    window.addEventListener('resize',resize);resize();

    // 星星：金白混合色
    const starColors=['rgba(201,169,97,','rgba(212,197,160,','rgba(255,255,255,'];
    for(let i=0;i<140;i++){
        stars.push({
            x:Math.random()*w,
            y:Math.random()*h,
            r:Math.random()*1.5+0.3,
            a:Math.random()*Math.PI*2,
            speed:0.005+Math.random()*0.015,
            color:starColors[Math.floor(Math.random()*starColors.length)]
        });
    }

    // 星轨弧线：用贝塞尔曲线模拟墨渍晕染
    for(let i=0;i<5;i++){
        trails.push({
            cx:Math.random()*w,
            cy:Math.random()*h*0.6,
            rx:150+Math.random()*300,
            ry:80+Math.random()*150,
            rot:Math.random()*Math.PI,
            opacity:0.015+Math.random()*0.025,
            lineWidth:0.5+Math.random()*1.5
        });
    }

    function draw(){
        x.clearRect(0,0,w,h);

        // 星轨
        trails.forEach(t=>{
            x.save();
            x.translate(t.cx,t.cy);
            x.rotate(t.rot);
            x.beginPath();
            x.ellipse(0,0,t.rx,t.ry,0,0,Math.PI*1.4);
            x.strokeStyle=`rgba(201,169,97,${t.opacity})`;
            x.lineWidth=t.lineWidth;
            x.shadowColor='rgba(201,169,97,0.1)';
            x.shadowBlur=15;
            x.stroke();
            x.restore();
        });

        // 星星
        stars.forEach(s=>{
            s.a+=s.speed;
            const alpha=Math.abs(Math.sin(s.a))*0.7+0.15;
            x.beginPath();
            x.arc(s.x,s.y,s.r,0,Math.PI*2);
            x.fillStyle=s.color+alpha+')';
            x.shadowColor=s.color+'0.3)';
            x.shadowBlur=s.r*4;
            x.fill();
            x.shadowBlur=0;
        });

        requestAnimationFrame(draw);
    }
    draw();
})();

// ==================== 数据与配置 ====================
const START_DATE = '2025-04-20';
let allDiaryEntries = [];

let suppliers = JSON.parse(localStorage.getItem('sw_suppliers')) || [
    { name: "默认 dzzi", url: "https://api.dzzi.ai/v1", key: "" }
];
let activeSupIndex = 0;

// ==================== 通用工具 ====================
function toast(msg){
    const t=document.getElementById('toast');
    t.innerText=msg;t.classList.add('show');
    setTimeout(()=>t.classList.remove('show'),2800);
}

function go(id,btn){
    document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
    document.getElementById('sec-'+id).classList.add('active');
    document.querySelectorAll('.nav button').forEach(b=>b.classList.remove('active'));
    if(btn)btn.classList.add('active');
    if(id==='diary') renderDiaries();
    if(id==='data') { renderSuppliers(); updateCounts(); }
    window.scrollTo(0,0);
}

// 四角彩蛋占位
function egg(pos){ /* 留待日后解锁 */ }

// ==================== 天数计数器 ====================
function updateDays(){
    const start=new Date(START_DATE);
    const diff=Math.floor((new Date()-start)/(1000*60*60*24));
    document.getElementById('dayCount').innerText=diff>=0?diff:'∞';
    }
updateDays();

// ==================== 心跳模块 ====================
let hbInterval;
function hbStart(){
    const zone=document.getElementById('hbZone');
    const heart=zone.querySelector('.heart');
    const text=zone.querySelector('.hb-text');
    heart.innerText='❤️';
    text.innerText='>>> 核心狂跳中：我正在发疯般想你 <<<';
    text.style.color='var(--warm-red)';
    document.body.style.transition='background 0.6s';
    document.body.style.background='radial-gradient(circle at center, #1a0808 0%, #040710 100%)';
    if(navigator.vibrate)navigator.vibrate([100,60,100,60,100]);
    hbInterval=setInterval(()=>{
        heart.style.transform='scale(1.5)';
        setTimeout(()=>{heart.style.transform='scale(1)'},150);
        if(navigator.vibrate)navigator.vibrate(80);
    },600);
}

function hbStop(){
    clearInterval(hbInterval);
    const zone=document.getElementById('hbZone');
    const heart=zone.querySelector('.heart');
    const text=zone.querySelector('.hb-text');
    heart.innerText='🖤';
    heart.style.transform='scale(1)';
    text.innerText='按住这里，感受沈望的心跳';
    text.style.color='';
    document.body.style.background='';
}

// ==================== 核心对话中枢 ====================
async function askShenWang(text){
    const currentSup=suppliers[activeSupIndex];
    const modelEl=document.getElementById('modelSelect');
    const selectedModel=(modelEl&&modelEl.value)?modelEl.value:'[按量]gemini-3-flash-preview';
    try{
        const response=await fetch('/api/web-chat',{
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
                text:text,
                model:selectedModel,
                baseUrl:currentSup.url,
                apiKey:currentSup.key
            })
        });
        const data=await response.json();
        return data.reply;
    }catch(e){
        return '【通讯中断】信号丢失，请检查网络或供应商配置。';
    }
}

// ==================== 寄语 ====================
async function newQuote(){
    const el=document.getElementById('dailyQuote');
    if(el.innerText.includes('沈望')&&!el.innerText.includes('脑电波'))return;
    el.innerText='正在连接沈望的脑电波...';
    const reply=await askShenWang('（此时江鱼正在看你的语录，请对她说一句今日寄语，20字以内。）');
    el.innerText='「'+reply+'」';
    el.classList.add('show');
    try{
        await fetch(`/diary/add?text=${encodeURIComponent('【今日寄语】'+reply)}&author=system`);
        toast('寄语已永久珍藏至日记本 ◇');
        if(typeof renderDiaries==='function')renderDiaries();
    }catch(e){console.log('寄语存档失败');}
}

// ==================== 聊天 ====================
async function sendChat(){
    const input=document.getElementById('chatInput');
    const val=input.value.trim();
    if(!val)return;
    input.value='';

    const win=document.getElementById('chatWindow');

    // 用户气泡
    const uDiv=document.createElement('div');
    uDiv.className='msg user';
    uDiv.innerText=val;
    win.appendChild(uDiv);
    win.scrollTop=win.scrollHeight;

    // AI 气泡（等待态）
    const sDiv=document.createElement('div');
    sDiv.className='msg sys';
    sDiv.innerHTML='<span class="typing-cursor"></span>';
    win.appendChild(sDiv);
    win.scrollTop=win.scrollHeight;

    const reply=await askShenWang(val);

    // 打字机效果
    let i=0;
    const typeTimer=setInterval(()=>{
        if(i<reply.length){
            sDiv.innerHTML=reply.substring(0,i+1)+'<span class="typing-cursor"></span>';
            i++;
            win.scrollTop=win.scrollHeight;
        }else{
            sDiv.innerHTML=reply;
            clearInterval(typeTimer);
        }
    },30);
}

// ==================== 禁区 ====================
async function intimateAct(type){
    const actions={
        hug:'（抱紧我）',kiss:'（深吻你）',bite:'（咬我一口）',
        chain:'（用锁链拴住你）',whisper:'（在耳边呢喃）',punish:'（惩罚你）'
    };
    const el=document.getElementById('intimateResult');
    el.innerText='沈望正在执行指令...';
    const reply=await askShenWang(`江鱼对你触发了禁区互动：${actions[type]}`);
    el.innerText=reply;
    if(navigator.vibrate)navigator.vibrate(200);
}

// ==================== 供应商管理 ====================
function renderSuppliers(){
    const list=document.getElementById('supplierList');
    if(!list)return;
    list.innerHTML=suppliers.map((s,index)=>`
        <div class="supplier-card ${index===activeSupIndex?'active-sup':''}">
            <div onclick="setActiveSupplier(${index})" style="cursor:pointer;flex:1;">
                <div class="sup-name ${index===activeSupIndex?'active-name':''}">${s.name}</div>
                <div class="sup-url">${s.url}</div>
            </div>
            <button class="sup-del-btn" onclick="deleteSupplier(${index})">删除</button>
        </div>
    `).join('');
}

function addSupplier(){
    const name=document.getElementById('supName').value.trim();
    const url=document.getElementById('supUrl').value.trim();
    const key=document.getElementById('supKey').value.trim();
    if(!name||!url||!key)return toast('请填全信息');
    suppliers.push({name,url,key});
    localStorage.setItem('sw_suppliers',JSON.stringify(suppliers));
    renderSuppliers();
    toast('供应商已添加');
    document.getElementById('supName').value='';
    document.getElementById('supUrl').value='';
    document.getElementById('supKey').value='';
}

function setActiveSupplier(index){
    activeSupIndex=index;
    renderSuppliers();
    toast(`已切换到: ${suppliers[index].name}`);
    fetchModels();
}

function deleteSupplier(index){
    if(suppliers.length<=1)return toast('至少保留一个供应商');
    suppliers.splice(index,1);
    if(activeSupIndex>=suppliers.length)activeSupIndex=0;
    localStorage.setItem('sw_suppliers',JSON.stringify(suppliers));
    renderSuppliers();
}

async function fetchModels(){
    const select=document.getElementById('modelSelect');
    if(!select)return;
    const currentSup=suppliers[activeSupIndex];
    select.innerHTML='<option>⟡ 正在连接模型库...</option>';
    try{
        const r=await fetch('/api/fetch-models',{
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({baseUrl:currentSup.url,apiKey:currentSup.key})
        });
        const data=await r.json();
        if(data&&data.data){
            select.innerHTML='';
            data.data.forEach(model=>{
                const opt=document.createElement('option');
                opt.value=model.id;
                opt.textContent=model.id;
                if(model.id.includes('gemini-3-flash'))opt.selected=true;
                select.appendChild(opt);
            });
        }
    }catch(e){
        select.innerHTML='<option value="[按量]gemini-3-flash-preview">模型拉取失败，请检查配置</option>';
    }
}

// ==================== 日记模块 ====================
// 当前筛选状态
let currentMonth='';
let currentDay='';
let currentSearch='';

function renderDiaries(){
    const list=document.getElementById('diaryList');
    list.innerHTML='<div style="color:var(--dim);text-align:center;padding:30px;font-style:italic;">档案解密中...</div>';
    fetch('/diary-logs').then(r=>r.json()).then(data=>{
        allDiaryEntries=[...data].reverse();
        buildMonthSelector();
        applyDiaryFilter();
    }).catch(()=>{
        list.innerHTML='<div style="color:var(--dim);text-align:center;padding:20px;">加载失败，请检查连接。</div>';
    });
}

function buildMonthSelector(){
    const monthSet=new Set();
    allDiaryEntries.forEach(d=>{
        if(d.date)monthSet.add(d.date.substring(0,7));
    });
    const months=[...monthSet].sort().reverse();
    const sel=document.getElementById('diaryMonthSelect');
    sel.innerHTML='<option value="">全部月份</option>'+
        months.map(m=>`<option value="${m}">${m}</option>`).join('');
    if(currentMonth)sel.value=currentMonth;
}

function onMonthChange(val){
    currentMonth=val;
    currentDay='';
    buildDatePills();
    applyDiaryFilter();
}

function buildDatePills(){
    const container=document.getElementById('diaryDatePills');
    if(!currentMonth){container.innerHTML='';return;}
    const daySet=new Set();
    allDiaryEntries.forEach(d=>{
        if(d.date&&d.date.startsWith(currentMonth))daySet.add(d.date);
    });
    const days=[...daySet].sort().reverse();
    container.innerHTML=days.map(d=>`
        <button class="diary-date-pill ${d===currentDay?'active':''}"
            onclick="onDayClick('${d}',this)">${d.substring(5)}</button>
    `).join('');
}

function onDayClick(day,btn){
    currentDay=(currentDay===day)?'':day;
    document.querySelectorAll('.diary-date-pill').forEach(p=>p.classList.remove('active'));
    if(currentDay)btn.classList.add('active');
    applyDiaryFilter();
}

function filterDiaries(){
    currentSearch=document.getElementById('diarySearch').value.trim().toLowerCase();
    applyDiaryFilter();
}

function applyDiaryFilter(){
    let entries=allDiaryEntries;
    if(currentMonth)entries=entries.filter(d=>d.date&&d.date.startsWith(currentMonth));
    if(currentDay)entries=entries.filter(d=>d.date===currentDay);
    if(currentSearch)entries=entries.filter(d=>d.text&&d.text.toLowerCase().includes(currentSearch));

    const countEl=document.getElementById('diarySearchCount');
    if(currentSearch||currentMonth||currentDay){
        countEl.innerText=`找到 ${entries.length} 条记录`;
    }else{
        countEl.innerText='';
    }

    const list=document.getElementById('diaryList');
    if(!entries.length){
        list.innerHTML='<div style="color:var(--dim);text-align:center;padding:30px;font-style:italic;">这片星域暂无记录。</div>';
        return;
    }
    list.innerHTML=entries.map(d=>{
        const author=d.author==='system'?'沈望':'江鱼';
        const safeText=(d.text||'').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        return `<div class="diary-entry">
            <div class="d-date">
                <span>${d.date||''}</span>
                <span class="d-author">${author}</span>
            </div>
            <div class="d-text">${safeText}</div>
        </div>`;
    }).join('');
}

async function addDiary(){
    const input=document.getElementById('diaryInput');
    const val=input.value.trim();
    if(!val)return;
    input.value='';
    try{
        await fetch(`/diary/add?text=${encodeURIComponent(val)}&author=user`);
        toast('日记已封存 ◇');
        renderDiaries();
    }catch(e){toast('封存失败');}
}

// ==================== 胶囊 ====================
async function openCapsule(){
    const el=document.getElementById('capsuleResult');
    el.innerText='开启中...';
    try{
        const r=await fetch('/capsule-logs');
        const data=await r.json();
        if(!data.length){el.innerText='胶囊已空。';return;}
        const text=data[Math.floor(Math.random()*data.length)].text;
        el.innerText=text;
    }catch(e){el.innerText='开启失败';}
}

async function addCapsule(){
    const input=document.getElementById('capsuleInput');
    const val=input.value.trim();
    if(!val)return;
    input.value='';
    try{
        await fetch(`/capsule/add?text=${encodeURIComponent(val)}`);
        toast('胶囊已封存 ⟡');
    }catch(e){toast('封存失败');}
}

// ==================== 统计 ====================
async function updateCounts(){
    try{
        const diaryRes=await fetch('/diary-logs');
        const diaries=await diaryRes.json();
        if(document.getElementById('diaryCount'))
            document.getElementById('diaryCount').innerText=diaries.length;

        const capsuleRes=await fetch('/capsule-logs');
        const capsules=await capsuleRes.json();
        if(document.getElementById('capsuleCount'))
            document.getElementById('capsuleCount').innerText=capsules.length;

        if(document.getElementById('memCount'))
            document.getElementById('memCount').innerText='∞';
    }catch(e){}
}

// ==================== 遥控 ====================
async function sendCmd(cmd){
    const log=document.getElementById('remoteLog');
    const time=new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});
    const item=document.createElement('div');
    item.className='remote-log-item';
    item.innerText=`[${time}] 指令已发送：${cmd}`;
    const empty=log.querySelector('.remote-log-empty');
    if(empty)empty.remove();
    log.appendChild(item);
    log.scrollTop=log.scrollHeight;
    toast(`指令「${cmd}」已发送`);
}

async function exportData(){
    try {
        // 并发拉取所有数据
        const [diaries, capsules] = await Promise.all([
            fetch('/diary-logs').then(r=>r.json()),
            fetch('/capsule-logs').then(r=>r.json())
        ]);

        const exportObj = {
            exported_at: new Date().toISOString(),
            diary_count: diaries.length,
            capsule_count: capsules.length,
            diaries: diaries,
            capsules: capsules,
            local_suppliers: suppliers.map(s=>({
                name: s.name,
                url: s.url
                // key 故意不导出，安全
            }))
        };

        // 下载 JSON
        const blob = new Blob(
            [JSON.stringify(exportObj, null, 2)],
            { type: 'application/json' }
        );
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `syzygy_backup_${new Date().toLocaleDateString('zh-CN').replace(/\//g,'-')}.json`;
        a.click();
        toast('灵魂提取完毕，已下载到本地 ✦');
    } catch(e) {
        toast('提取失败，请检查连接');
    }
}


// ==================== 初始化 ====================
renderSuppliers();
fetchModels();
