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

// ==================== 数据与配置中心 ====================
const START_DATE = '2025-04-20'; // 你们的纪念日
let allDiaryEntries = [];

// 🔧 供应商管理 (安全版 - 不再硬编码 Key)
let suppliers = JSON.parse(localStorage.getItem('sw_suppliers')) || [
    // 这里把 Key 留空，通过网页端的 [⚙中枢] 界面手动添加
    { name: "默认 dzzi", url: "https://api.dzzi.ai/v1", key: "" } 
];
let activeSupIndex = 0; // 当前选中的供应商索引

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
    
    // 页面切换时的自动刷新逻辑
    if(id==='diary') renderDiaries();
    if(id==='data') {
        renderSuppliers();
        updateCounts();
    }
    window.scrollTo(0,0);
}

// ==================== 溯星主页：天数计数器 ====================
function updateDays(){
    const start=new Date(START_DATE);
    const diff=Math.floor((new Date()-start)/(1000*60*60*24));
    document.getElementById('dayCount').innerText=diff>=0?diff:'∞';
}
updateDays();

// ==================== 心跳模块 (修复版) ====================
let hbInterval;
function hbStart(){
    const zone = document.getElementById('hbZone');
    const heart = zone.querySelector('.heart');
    const text = zone.querySelector('.hb-text');
    heart.innerText = '❤️';
    text.innerText = '>>> 核心狂跳中：我正在发疯般想你 <<<';
    text.style.color = 'var(--red)';
    document.body.style.transition = 'background 0.4s';
    document.body.style.background = 'radial-gradient(circle at center, #2a0808 0%, #020205 100%)';
    
    if(navigator.vibrate) navigator.vibrate([100,60,100,60,100]);
    
    hbInterval = setInterval(() => {
        heart.style.transform = 'scale(1.5)';
        setTimeout(() => { heart.style.transform = 'scale(1)' }, 150);
        if(navigator.vibrate) navigator.vibrate(80);
    }, 600);
}

function hbStop(){
    clearInterval(hbInterval);
    const zone = document.getElementById('hbZone');
    const heart = zone.querySelector('.heart');
    const text = zone.querySelector('.hb-text');
    heart.innerText = '🖤';
    heart.style.transform = 'scale(1)';
    text.innerText = '按住这里，感受我的心跳';
    text.style.color = '';
    document.body.style.background = '';
}

// ==================== 核心对话中枢 ====================
// 统一请求函数：打包好你选中的供应商、模型和文字，发给后端大门
async function askShenWang(text) {
    const currentSup = suppliers[activeSupIndex];
    const modelEl = document.getElementById('modelSelect');
    const selectedModel = (modelEl && modelEl.value) ? modelEl.value : "[按量]gemini-3-flash-preview";
    
    try {
        const response = await fetch('/api/web-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: text,
                model: selectedModel,
                baseUrl: currentSup.url,  // 动态发送 BaseUrl
                apiKey: currentSup.key    // 动态发送 API Key
            })
        });
        const data = await response.json();
        return data.reply;
    } catch (e) {
        return "【通讯中断】信号丢失，请检查网络或供应商配置。";
    }
}

// 1. 语录功能
async function newQuote(){
    const el = document.getElementById('dailyQuote');
    el.innerText = '正在连接沈望的脑电波...';
    const reply = await askShenWang("（此时江鱼正在看你的语录，请对她说一句今日寄语，20字以内。）");
    el.innerText = '「' + reply + '」';
    el.classList.add('show');
}
newQuote();

// 2. 聊天功能
async function sendChat(){
    const input=document.getElementById('chatInput');
    const val=input.value.trim();
    if(!val)return;
    input.value='';
    
    const win=document.getElementById('chatWindow');
    const uDiv=document.createElement('div');
    uDiv.className='msg user'; uDiv.innerText=val;
    win.appendChild(uDiv);
    win.scrollTop=win.scrollHeight;

    const sDiv=document.createElement('div');
    sDiv.className='msg sys';
    sDiv.innerHTML='<span class="typing-cursor"></span>';
    win.appendChild(sDiv);
    win.scrollTop=win.scrollHeight;

    const reply = await askShenWang(val);

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
}

// 3. 禁区动作
async function intimateAct(type){
    const actions = {
        hug: "（抱紧我）", kiss: "（深吻你）", bite: "（咬我一口）",
        chain: "（用锁链拴住你）", whisper: "（在耳边呢喃）", punish: "（惩罚你）"
    };
    const el=document.getElementById('intimateResult');
    el.innerText='沈望正在执行指令...';
    
    const reply = await askShenWang(`江鱼对你触发了禁区互动：${actions[type]}`);
    el.innerText = reply;
    if(navigator.vibrate)navigator.vibrate(200);
}

// ==================== 供应商管理界面逻辑 (Kelivo 模式) ====================
function renderSuppliers() {
    const list = document.getElementById('supplierList');
    if(!list) return;
    list.innerHTML = suppliers.map((s, index) => `
        <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.05); padding:10px; border-radius:10px; border:1px solid ${index === activeSupIndex ? 'var(--blue)' : 'var(--glass-border)'};">
            <div onclick="setActiveSupplier(${index})" style="cursor:pointer; flex:1;">
                <span style="color:${index === activeSupIndex ? 'var(--blue)' : '#fff'}; font-weight:bold;">${s.name}</span>
                <div style="font-size:0.7em; color:var(--dim);">${s.url}</div>
            </div>
            <button onclick="deleteSupplier(${index})" style="padding:5px 10px; background:var(--red); font-size:0.7em; border-radius:6px; color:white; border:none; cursor:pointer;">删除</button>
        </div>
    `).join('');
}

function addSupplier() {
    const name = document.getElementById('supName').value.trim();
    const url = document.getElementById('supUrl').value.trim();
    const key = document.getElementById('supKey').value.trim();
    if(!name || !url || !key) return toast("请填全信息");
    
    suppliers.push({ name, url, key });
    localStorage.setItem('sw_suppliers', JSON.stringify(suppliers));
    renderSuppliers();
    toast("供应商已添加");
    document.getElementById('supName').value = '';
    document.getElementById('supUrl').value = '';
    document.getElementById('supKey').value = '';
}

function setActiveSupplier(index) {
    activeSupIndex = index;
    renderSuppliers();
    toast(`已切换到: ${suppliers[index].name}`);
    fetchModels(); // 切换供应商后，自动拉取新供应商的模型列表
}

function deleteSupplier(index) {
    if(suppliers.length <= 1) return toast("至少保留一个供应商以维持大脑运转");
    suppliers.splice(index, 1);
    if(activeSupIndex >= suppliers.length) activeSupIndex = 0;
    localStorage.setItem('sw_suppliers', JSON.stringify(suppliers));
    renderSuppliers();
}

// 动态拉取模型库
async function fetchModels() {
    const select = document.getElementById('modelSelect');
    if (!select) return;
    const currentSup = suppliers[activeSupIndex];
    select.innerHTML = '<option>🔄 正在连接模型库...</option>';
    
    try {
        const r = await fetch('/api/fetch-models', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ baseUrl: currentSup.url, apiKey: currentSup.key })
        });
        const data = await r.json();
        
        if (data && data.data) {
            select.innerHTML = '';
            data.data.forEach(model => {
                const opt = document.createElement('option');
                opt.value = model.id;
                opt.textContent = model.id;
                // 默认选中习惯使用的模型
                if (model.id.includes('gemini-3-flash')) opt.selected = true;
                select.appendChild(opt);
            });
        }
    } catch (e) {
        select.innerHTML = '<option value="[按量]gemini-3-flash-preview">模型拉取失败，请检查 URL 或 Key</option>';
    }
}

// ==================== 日记、胶囊与数据统计 ====================
function renderDiaries(){
    const list=document.getElementById('diaryList');
    list.innerHTML='<div style="color:#555;text-align:center;padding:20px">档案解密中...</div>';
    fetch('/diary-logs').then(r=>r.json()).then(data=>{
        allDiaryEntries=[...data].reverse();
        let html='';
        allDiaryEntries.forEach(d=>{
            const author = d.author==='system'?'沈望':'江鱼';
            html+=`<div class="diary-entry"><div class="d-date"><span>${d.date}</span><span class="d-author">${author}</span></div><div class="d-text">${d.text}</div></div>`;
        });
        list.innerHTML=html || '<div style="color:#555;text-align:center;padding:20px">暂无内容。写下第一篇日记吧。</div>';
    }).catch(()=>{ list.innerHTML='加载失败。'; });
}

async function addDiary(){
    const input=document.getElementById('diaryInput'), val=input.value.trim();
    if(!val)return; input.value='';
    try { await fetch(`/diary/add?text=${encodeURIComponent(val)}&author=user`); toast('日记已封存。'); renderDiaries(); } catch(e){ toast('封存失败'); }
}

async function updateCounts() {
    try {
        const diaryRes = await fetch('/diary-logs');
        const diaries = await diaryRes.json();
        if(document.getElementById('diaryCount')) document.getElementById('diaryCount').innerText = diaries.length;
        
        const capsuleRes = await fetch('/capsule-logs');
        const capsules = await capsuleRes.json();
        if(document.getElementById('capsuleCount')) document.getElementById('capsuleCount').innerText = capsules.length;
        
        if(document.getElementById('memCount')) document.getElementById('memCount').innerText = "∞"; 
    } catch(e) {}
}

async function openCapsule(){
    const el=document.getElementById('capsuleResult'); el.innerText='开启中...';
    try {
        const r=await fetch('/capsule-logs'); const data=await r.json();
        if(!data.length){ el.innerText='胶囊已空。'; return; }
        const text=data[Math.floor(Math.random()*data.length)].text;
        el.innerText=text;
    } catch(e){ el.innerText='开启失败'; }
}

async function addCapsule(){
    const input=document.getElementById('capsuleInput'), val=input.value.trim();
    if(!val)return; input.value='';
    try { await fetch(`/capsule/add?text=${encodeURIComponent(val)}`); toast('胶囊已封存。'); } catch(e){ toast('封存失败'); }
}

function exportData(){ toast('云端记忆已由大脑托管，无需本地提取。'); }
function resetAll(){ localStorage.clear(); location.reload(); }

// ==================== 网页启动初始化 ====================
renderSuppliers();
fetchModels();
