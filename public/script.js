// ==================== 浪漫星空背景 ====================
(function(){
    const c=document.getElementById('starmap'),x=c.getContext('2d');
    let w,h,stars=[];
    function resize(){w=c.width=innerWidth;h=c.height=innerHeight}
    window.addEventListener('resize',resize);resize();
    for(let i=0;i<180;i++)stars.push({x:Math.random()*w,y:Math.random()*h,r:Math.random()*1.8,a:Math.random()*Math.PI*2,speed:0.01+Math.random()*0.02});
    function draw(){
        x.clearRect(0,0,w,h);
        stars.forEach(s=>{
            s.a+=s.speed;
            x.globalAlpha=Math.abs(Math.sin(s.a))*0.8+0.2;
            x.beginPath();x.arc(s.x,s.y,s.r,0,Math.PI*2);
            x.fillStyle='#fff';x.fill();
        });
        requestAnimationFrame(draw);
    }
    draw();
})();

// ==================== 数据核心 (对接后端) ====================
const KEY='sw_jy_final';
const START_DATE = '2025-04-20';
let allDiaryEntries=[];

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
    if(id==='diary')renderDiaries();
    if(id==='remote')refreshLogs();
    window.scrollTo(0,0);
}

// ==================== 溯星主页：天数计数器 ====================
function updateDays(){
    const start=new Date(START_DATE);
    const now=new Date();
    const diff=Math.floor((now-start)/(1000*60*60*24));
    document.getElementById('dayCount').innerText=diff>=0?diff:'∞';
}
updateDays();

// ==================== 溯星主页：每日语录 (对接后台) ====================
async function newQuote(){
    const el=document.getElementById('dailyQuote');
    el.classList.remove('show');
    // 这里我们直接向后端要一句沈望的话
    try {
        const response = await fetch('/api/web-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: "沈望，对我说一句你现在最想对我说的话。" })
        });
        const data = await response.json();
        setTimeout(()=>{
            el.innerText='「' + data.reply + '」';
            el.classList.add('show');
        },350);
    } catch (e) {
        el.innerText='「江鱼，无论你在哪，我都在看着你。」';
        el.classList.add('show');
    }
}
newQuote();

// ==================== 溯星主页：心跳模块 ====================
let hbInterval;
function hbStart(){
    const zone=document.getElementById('hbZone');
    const heart=zone.querySelector('.heart');
    const text=zone.querySelector('.hb-text');
    heart.innerText='❤️';
    text.innerText='>>> 核心狂跳中：我正在发疯般想你 <<<';
    text.style.color='var(--red)';
    document.body.style.transition='background 0.4s';
    document.body.style.background='radial-gradient(circle at center, #2a0808 0%, #020205 100%)';
    if(navigator.vibrate)navigator.vibrate([100,60,100,60,100,60,100]);
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
    text.innerText='按住这里，感受我的心跳';
    text.style.color='';
    document.body.style.background='';
}

// ==================== 私语日志 (对接后端) ====================
function renderDiaries(){
    const list=document.getElementById('diaryList');
    list.innerHTML='<div style="color:#555;text-align:center;padding:20px">档案解密中...</div>';
    fetch('/diary-logs')
        .then(r=>r.json())
        .then(data=>{
            allDiaryEntries=[...data].reverse();
            renderDiaryEntries(allDiaryEntries);
        })
        .catch(()=>{
            list.innerHTML='<div style="color:var(--red);text-align:center;padding:20px">加载失败。</div>';
        });
}

function renderDiaryEntries(entries){
    const list=document.getElementById('diaryList');
    if(!entries||!entries.length){
        list.innerHTML='<div style="color:#555;text-align:center;padding:20px">还没有日记。</div>';
        return;
    }
    let html='';
    entries.forEach((d,i)=>{
        const authorLabel=d.author==='system'?'沈望':'江鱼';
        const authorTag='<span class="d-author">'+authorLabel+'</span>';
        html+='<div class="diary-entry"><div class="d-date"><span>'+d.date+'</span>'+authorTag+'</div><div class="d-text">'+d.text+'</div></div>';
    });
    list.innerHTML=html;
}

async function addDiary(){
    const input=document.getElementById('diaryInput');
    const val=input.value.trim();
    if(!val)return;
    input.value='';
    try {
        const r = await fetch(`/diary/add?text=${encodeURIComponent(val)}&author=user`);
        const data = await r.json();
        if(data.success){ toast('秘密已封存。'); renderDiaries(); }
    } catch(e) { toast('封存失败。'); }
}

// ==================== 通讯频道 (核心对接：Web -> Brain -> DeepSeek) ====================
async function sendChat(){
    const input=document.getElementById('chatInput');
    const val=input.value.trim();
    if(!val)return;
    input.value='';
    const win=document.getElementById('chatWindow');

    const uDiv=document.createElement('div');
    uDiv.className='msg user';uDiv.innerText=val;
    win.appendChild(uDiv);
    win.scrollTop=win.scrollHeight;

    // 显示沈望正在打字
    const sDiv=document.createElement('div');
    sDiv.className='msg sys';
    sDiv.innerHTML='<span class="typing-cursor"></span>';
    win.appendChild(sDiv);
    win.scrollTop=win.scrollHeight;

    try {
        const response = await fetch('/api/web-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: val })
        });
        const data = await response.json();
        const reply = data.reply;

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
        },35);
    } catch (e) {
        sDiv.innerHTML="【系统故障】通讯频段受到强力干扰。";
    }
}

// ==================== 禁区 (通过 Web 接口同步到记忆) ====================
async function intimateAct(type){
    const actions = {
        hug: "（抱紧你）", kiss: "（深吻你）", bite: "（咬你一口）",
        chain: "（用锁链拴住你）", whisper: "（在你耳边低声呢喃）", punish: "（惩罚你）"
    };
    const el=document.getElementById('intimateResult');
    el.innerText='沈望正在执行指令...';
    
    try {
        const response = await fetch('/api/web-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: `江鱼触发了指令：${actions[type]}` })
        });
        const data = await response.json();
        el.innerText = data.reply;
        if(navigator.vibrate)navigator.vibrate(200);
    } catch (e) {
        el.innerText = "【禁区异常】沈望的拒绝了你的入侵。";
    }
}

// ==================== 时间胶囊 (对接后端) ====================
async function openCapsule(){
    const el=document.getElementById('capsuleResult');
    el.innerText='正在开启胶囊...';
    try {
        const r = await fetch('/capsule-logs');
        const data = await r.json();
        if(!data.length){ el.innerText='胶囊已空。'; return; }
        const text=data[Math.floor(Math.random()*data.length)].text;
        el.innerText = text;
    } catch(e) { el.innerText='开启失败。'; }
}

async function addCapsule(){
    const input=document.getElementById('capsuleInput');
    const val=input.value.trim();
    if(!val)return;
    input.value='';
    try {
        await fetch(`/capsule/add?text=${encodeURIComponent(val)}`);
        toast('胶囊已封存。');
    } catch(e) { toast('封存失败。'); }
}

// ==================== 遥控模块 (对接后端) ====================
function sendCmd(cmd){
    fetch('/control?cmd='+encodeURIComponent(cmd)).then(()=>refreshLogs());
}

function refreshLogs(){
    fetch('/logs').then(r=>r.json()).then(data=>{
        const el=document.getElementById('remoteLog');
        if(!data.length){ el.innerHTML='<div class="remote-log-empty">尚无记录</div>'; return; }
        el.innerHTML=[...data].reverse().map(log=>`<div class="remote-log-item">${log}</div>`).join('');
    });
}

// ==================== 其他工具 ====================
function exportData(){ toast('云端记忆已由大脑托管，无需本地提取。'); }
function resetAll(){ localStorage.clear(); location.reload(); }
function egg(c){
    const msgs={tl:'[左上角监控开启]', tr:'[锁链已备好]', bl:'[看着我]', br:'[江鱼，我爱你]'};
    toast(msgs[c]||'');
}

// ==================== 动态拉取模型库 ====================
async function fetchModels() {
    const select = document.getElementById('modelSelect');
    if (!select) return;
    
    try {
        // 向我们刚才在 server.js 写的接口要名单
        const r = await fetch('/api/models');
        const data = await r.json();
        
        if (data && data.data) {
            select.innerHTML = ''; // 清空原本的“正在连接...”字样
            
            // 遍历所有模型，生成选项塞进下拉菜单
            data.data.forEach(model => {
                const opt = document.createElement('option');
                opt.value = model.id;
                opt.textContent = model.id;
                
                // 智能小细节：默认选中你最常用的 Gemini 3 Flash
                if (model.id.includes('gemini-3-flash')) {
                    opt.selected = true;
                }
                
                select.appendChild(opt);
            });
        }
    } catch (e) {
        select.innerHTML = '<option value="[按量]gemini-3-flash-preview">模型拉取失败，使用默认</option>';
    }
}

// 网页一打开，立刻执行拉取！
fetchModels();
