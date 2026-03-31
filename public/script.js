// ==================== 浪漫星空背景 ====================
(function(){
    const c=document.getElementById('starmap'), x=c.getContext('2d');
    let w,h,stars=[],trails=[];
    function resize(){w=c.width=innerWidth;h=c.height=innerHeight}
    window.addEventListener('resize',resize); resize();

    const starColors=['rgba(201,169,97,','rgba(212,197,160,','rgba(255,255,255,'];
    for(let i=0;i<140;i++) stars.push({
        x:Math.random()*w, y:Math.random()*h,
        r:Math.random()*1.5+0.3, a:Math.random()*Math.PI*2,
        speed:0.005+Math.random()*0.015,
        color:starColors[Math.floor(Math.random()*starColors.length)]
    });
    for(let i=0;i<5;i++) trails.push({
        cx:Math.random()*w, cy:Math.random()*h*0.6,
        rx:150+Math.random()*300, ry:80+Math.random()*150,
        rot:Math.random()*Math.PI,
        opacity:0.015+Math.random()*0.025,
        lineWidth:0.5+Math.random()*1.5
    });

    function draw(){
        x.clearRect(0,0,w,h);
        trails.forEach(t=>{
            x.save(); x.translate(t.cx,t.cy); x.rotate(t.rot); x.beginPath();
            x.ellipse(0,0,t.rx,t.ry,0,0,Math.PI*1.4);
            x.strokeStyle=`rgba(201,169,97,${t.opacity})`; x.lineWidth=t.lineWidth;
            x.shadowColor='rgba(201,169,97,0.1)'; x.shadowBlur=15; x.stroke(); x.restore();
        });
        stars.forEach(s=>{
            s.a+=s.speed; const alpha=Math.abs(Math.sin(s.a))*0.7+0.15;
            x.beginPath(); x.arc(s.x,s.y,s.r,0,Math.PI*2);
            x.fillStyle=s.color+alpha+')'; x.shadowColor=s.color+'0.3)';
            x.shadowBlur=s.r*4; x.fill(); x.shadowBlur=0;
        });
        requestAnimationFrame(draw);
    }
    draw();
})();

// ==================== 核心数据 (云端同步版) ====================
const START_DATE = '2025-04-20';
let allDiaryEntries = [];
let suppliers = [];
let activeSupIndex = 0;
let chatSessions = [];
let activeChatId = 'main';

// 从云端拉取所有配置
async function syncFromCloud() {
    try {
        const r = await fetch('/api/sync-config');
        const data = await r.json();

        suppliers = (data.suppliers && data.suppliers.length > 0)
            ? data.suppliers
            : [{ name: "默认接口", url: "https://api.dzzi.ai/v1", key: "" }];

        chatSessions = (data.chatSessions && data.chatSessions.length > 0)
            ? data.chatSessions
            : [{ id: 'main', name: '主频道', messages: [] }];

        activeSupIndex = data.activeSupIndex || 0;
        activeChatId   = data.activeChatId  || chatSessions[0].id;

        if (!chatSessions.find(s => s.id === activeChatId)) {
            activeChatId = chatSessions[0].id;
        }

        renderSuppliers();
        renderChatSidebar();
        renderChatMessages();
        fetchModels();

    } catch(e) {
        console.error("云端同步失败，降级使用空数据", e);
        suppliers    = [{ name: "默认接口", url: "https://api.dzzi.ai/v1", key: "" }];
        chatSessions = [{ id: 'main', name: '主频道', messages: [] }];
        renderSuppliers();
        renderChatSidebar();
        renderChatMessages();
    }
}

// 防抖保存到云端
let _saveTimer = null;
function saveToCloud() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(async () => {
        try {
            const sessionsToSave = chatSessions.map(s => ({
                ...s,
                messages: (s.messages || []).slice(-50)
            }));
            await fetch('/api/sync-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    suppliers,
                    chatSessions: sessionsToSave,
                    activeSupIndex,
                    activeChatId
                })
            });
        } catch(e) {
            console.error("云端保存失败", e);
        }
    }, 500);
}

// ==================== 官方模型图标智能识别 ====================
const MODEL_ICONS = {
    gemini: {
        keywords: ['gemini'],
        svg: `<svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M14 2C14 2 8 8.5 8 14C8 19.5 14 26 14 26C14 26 20 19.5 20 14C20 8.5 14 2Z" fill="url(#gg)"/><path d="M2 14C2 14 8.5 8 14 8C19.5 8 26 14 26 14C26 14 19.5 20 14 20C8.5 20 2 14 2 14Z" fill="url(#gg2)"/><defs><linearGradient id="gg" x1="14" y1="2" x2="14" y2="26" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#4285F4"/><stop offset="50%" stop-color="#9B72CB"/><stop offset="100%" stop-color="#D96570"/></linearGradient><linearGradient id="gg2" x1="2" y1="14" x2="26" y2="14" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#4285F4"/><stop offset="50%" stop-color="#34A853"/><stop offset="100%" stop-color="#FBBC04"/></linearGradient></defs></svg>`
    },
    default: {
        svg: `<svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="14" cy="14" r="12" stroke="rgba(201,169,97,0.5)" stroke-width="1.5" fill="transparent"/><text x="14" y="19" text-anchor="middle" font-size="11" fill="rgba(201,169,97,0.7)" font-family="serif">AI</text></svg>`
    }
};

function getModelIcon(modelId){
    if(!modelId) return MODEL_ICONS.default.svg;
    const lower = modelId.toLowerCase();
    for(const [key, val] of Object.entries(MODEL_ICONS)){
        if(key === 'default') continue;
        if(val.keywords && val.keywords.some(k => lower.includes(k))) return val.svg;
    }
    return MODEL_ICONS.default.svg;
}

function onModelChange(sel){
    const wrap = document.getElementById('modelIconWrap');
    if(wrap) wrap.innerHTML = getModelIcon(sel.value);
}

// ==================== 通用工具 & 页面切换护盾 ====================
function toast(msg){
    const t = document.getElementById('toast');
    if(!t) return;
    t.innerText = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2800);
}

// 💥 修复黑屏的核心：加入防崩溃的寻路逻辑
function go(id, btn){
    try {
        // 移除所有页面的 active 状态
        document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
        
        // 尝试找到目标页面，如果找不到指定的，就找主页
        const targetSection = document.getElementById('sec-'+id) || document.getElementById('sec-home') || document.querySelector('.section');
        if (targetSection) targetSection.classList.add('active');

        // 按钮高亮处理
        document.querySelectorAll('.nav button').forEach(b => b.classList.remove('active'));
        if(btn) btn.classList.add('active');

        // 加载对应数据
        if(id === 'diary') renderDiaries();
        if(id === 'chat') { renderChatSidebar(); renderChatMessages(); }
        if(id === 'data'){ renderSuppliers(); updateCounts(); }
        
        window.scrollTo(0, 0);
    } catch(e) {
        console.error("页面切换遇到异常:", e);
    }
}

// 💥 页面刚加载时，强制点击第一个按钮，避免全黑
window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        const activeSection = document.querySelector('.section.active');
        if (!activeSection) {
            const firstBtn = document.querySelector('.nav button');
            if (firstBtn) {
                firstBtn.click(); // 自动模拟点击“溯星”
            } else {
                go('home'); // 如果连按钮都没有，强行加载 home
            }
        }
    }, 100);
});

// ==================== 溯星主页 ====================
function updateDays(){
    const start = new Date(START_DATE);
    const diff  = Math.floor((new Date() - start) / (1000 * 60 * 60 * 24));
    const dayEl = document.getElementById('dayCount');
    if(dayEl) dayEl.innerText = diff >= 0 ? diff : '∞';
}
updateDays();

// ==================== 核心对话中枢 ====================
async function askShenWang(text, imageBase64 = null){
    const currentSup    = suppliers[activeSupIndex];
    if(!currentSup) return { reply: '未配置供应商' };
    const modelEl       = document.getElementById('modelSelect');
    const selectedModel = (modelEl && modelEl.value) ? modelEl.value : '[按量]gemini-3-flash-preview';
    try{
        const response = await fetch('/api/web-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text, image: imageBase64, model: selectedModel,
                baseUrl: currentSup.url, apiKey: currentSup.key
            })
        });
        const data = await response.json();
        return { ...data, usedModel: selectedModel };
    } catch(e) {
        return { reply: '【通讯中断】信号丢失，请检查网络或配置。', thinking: '' };
    }
}

// ==================== 通讯聊天（带护盾版） ====================
function renderChatSidebar(){
    const list = document.getElementById('sidebarList');
    if(!list) return;
    list.innerHTML = chatSessions.map(s => `
        <div class="sidebar-item ${s.id === activeChatId ? 'active' : ''}" onclick="switchChatWindow('${s.id}')">
            <span class="sidebar-item-dot"></span>
            <span class="sidebar-item-name">${s.name}</span>
            ${chatSessions.length > 1 ? `<button class="sidebar-del-btn" onclick="deleteChatWindow(event,'${s.id}')">×</button>` : ''}
        </div>
    `).join('');
}

function getActiveSession(){
    if (!chatSessions || chatSessions.length === 0) {
        chatSessions = [{ id: 'main', name: '主频道', messages: [] }];
    }
    return chatSessions.find(s => s.id === activeChatId) || chatSessions[0];
}

function switchChatWindow(id){
    activeChatId = id;
    saveToCloud();
    renderChatSidebar();
    renderChatMessages();
    const titleEl = document.getElementById('chatWinTitle');
    if(titleEl) titleEl.innerText = '⊹ ' + getActiveSession().name;
}

function renderChatMessages(){
    const win = document.getElementById('chatWindow');
    if(!win) return;
    win.innerHTML = '';
    const session = getActiveSession();
    
    // 防崩溃护盾：如果没拿到消息，直接返回
    if (!session || !Array.isArray(session.messages)) return;

    session.messages.forEach((m, index) => {
        const div = document.createElement('div');
        div.className = 'msg ' + (m.role === 'user' ? 'user' : 'sys');

        if(m.role !== 'user'){
            div.onmousedown  = (e) => handleMsgTouchStart(e, index, m);
            div.onmouseup    = handleMsgTouchEnd;
            div.onmouseleave = handleMsgTouchEnd;
            div.ontouchstart = (e) => handleMsgTouchStart(e, index, m);
            div.ontouchend   = handleMsgTouchEnd;
        }

        let htmlContent = '';
        if(m.image){
            htmlContent += `<img src="${m.image}" style="max-width:200px;border-radius:8px;margin-bottom:5px;box-shadow:0 2px 10px rgba(0,0,0,0.3);display:block;">`;
        }
        if(m.thinking){
            htmlContent += `
            <div class="think-box">
                <div class="think-header" onclick="const c=this.nextElementSibling;c.style.display=c.style.display==='none'?'block':'none';">🧠 深度思考过程 ▾</div>
                <div class="think-content" style="display:none">${m.thinking.replace(/\n/g, '<br>')}</div>
            </div>`;
        }
        htmlContent += `<div>${m.content || ''}</div>`;
        div.innerHTML = htmlContent;
        win.appendChild(div);
    });
    win.scrollTop = win.scrollHeight;
}

function newChatWindow(){
    const id   = 'chat_' + Date.now().toString(36);
    const name = '频道 ' + (chatSessions.length + 1);
    chatSessions.push({ id, name, messages: [] });
    saveToCloud();
    switchChatWindow(id);
    toast('已开启新频道：' + name);
}

function deleteChatWindow(e, id){
    e.stopPropagation();
    if(chatSessions.length <= 1) return toast('至少保留一个频道');
    if(!confirm('确定关闭这个频道？聊天记录将清除。')) return;
    chatSessions = chatSessions.filter(s => s.id !== id);
    if(activeChatId === id) activeChatId = chatSessions[0].id;
    saveToCloud();
    renderChatSidebar();
    renderChatMessages();
}

async function sendChat(){
    const input = document.getElementById('chatInput');
    if(!input) return;
    const val   = input.value.trim();
    if(!val && !currentImgBase64) return;
    input.value = '';

    const session = getActiveSession();
    const win     = document.getElementById('chatWindow');
    if(!session.messages) session.messages = [];

    const uDiv = document.createElement('div');
    uDiv.className = 'msg user';
    if(currentImgBase64){
        uDiv.innerHTML += `<img src="${currentImgBase64}" style="max-width:200px;border-radius:8px;margin-bottom:5px;display:block;">`;
    }
    uDiv.innerHTML += `<div>${val}</div>`;
    win.appendChild(uDiv);
    win.scrollTop = win.scrollHeight;

    session.messages.push({ role: 'user', content: val });
    saveToCloud();

    const sDiv = document.createElement('div');
    sDiv.className = 'msg sys';
    sDiv.innerHTML = '<span class="typing-cursor"></span>';
    win.appendChild(sDiv);
    win.scrollTop = win.scrollHeight;

    const imgToSend = currentImgBase64;
    clearImage();

    const resData = await askShenWang(val, imgToSend);

    const replyText    = resData.reply    || '【空】';
    const thinkingText = resData.thinking || '';
    const usedModel    = resData.usedModel || '未知模型';

    const timeStr = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const assistantMsg = {
        role:     'assistant',
        content:  replyText,
        thinking: thinkingText,
        time:     timeStr,
        model:    usedModel
    };
    session.messages.push(assistantMsg);
    saveToCloud();

    sDiv.innerHTML = '';

    if(thinkingText){
        const thinkBox = document.createElement('div');
        thinkBox.className = 'think-box';
        thinkBox.innerHTML = `
            <div class="think-header" onclick="const c=this.nextElementSibling;c.style.display=c.style.display==='none'?'block':'none';">
                🧠 深度思考过程 ▾
            </div>
            <div class="think-content" style="display:none">
                ${thinkingText.replace(/\n/g, '<br>')}
            </div>`;
        sDiv.appendChild(thinkBox);
    }

    const textDiv = document.createElement('div');
    sDiv.appendChild(textDiv);

    let i = 0;
    const speed = replyText.length > 200 ? 10 : replyText.length > 80 ? 20 : 30;

    const typeTimer = setInterval(() => {
        if(i < replyText.length){
            textDiv.innerHTML = replyText.substring(0, i+1) + '<span class="typing-cursor"></span>';
            i++;
            win.scrollTop = win.scrollHeight;
        } else {
            textDiv.innerHTML = replyText;
            clearInterval(typeTimer);

            const msgIndex = session.messages.length - 1;
            sDiv.onmousedown  = (e) => handleMsgTouchStart(e, msgIndex, assistantMsg);
            sDiv.onmouseup    = handleMsgTouchEnd;
            sDiv.onmouseleave = handleMsgTouchEnd;
            sDiv.ontouchstart = (e) => handleMsgTouchStart(e, msgIndex, assistantMsg);
            sDiv.ontouchend   = handleMsgTouchEnd;
        }
    }, speed);
}

// ==================== 供应商与模型库 ====================
function renderSuppliers(){
    const list = document.getElementById('supplierList');
    if(!list) return;
    list.innerHTML = suppliers.map((s, i) => `
        <div class="supplier-card ${i === activeSupIndex ? 'active-sup' : ''}">
            <div onclick="setActiveSupplier(${i})" style="cursor:pointer;flex:1;">
                <div class="sup-name ${i === activeSupIndex ? 'active-name' : ''}">${s.name}</div>
                <div class="sup-url">${s.url}</div>
            </div>
            <button class="sup-del-btn" onclick="deleteSupplier(${i})">删除</button>
        </div>
    `).join('');
}

function addSupplier(){
    const name = document.getElementById('supName').value.trim();
    const url  = document.getElementById('supUrl').value.trim();
    const key  = document.getElementById('supKey').value.trim();
    if(!name || !url || !key) return toast('请填全信息');

    suppliers.push({ name, url, key });
    saveToCloud(); renderSuppliers(); toast('供应商已添加 ✦');
}

function setActiveSupplier(index){
    activeSupIndex = index;
    saveToCloud(); renderSuppliers(); toast('已切换到：' + suppliers[index].name); fetchModels();
}

function deleteSupplier(index){
    if(suppliers.length <= 1) return toast('至少保留一个供应商');
    suppliers.splice(index, 1);
    if(activeSupIndex >= suppliers.length) activeSupIndex = 0;
    saveToCloud(); renderSuppliers();
}

async function fetchModels(){
    const select     = document.getElementById('modelSelect');
    if(!select) return;
    const currentSup = suppliers[activeSupIndex];
    if(!currentSup || !currentSup.key){
        select.innerHTML = '<option value="">⚠ 请先配置 API Key</option>'; return;
    }
    select.innerHTML = '<option value="">⟡ 正在连接供应商...</option>';
    try{
        const r = await fetch('/api/fetch-models', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ baseUrl: currentSup.url, apiKey: currentSup.key })
        });
        const data = await r.json();
        if(data.error){ select.innerHTML = `<option value="">⚠ 报错: ${data.error}</option>`; return; }
        if(data && data.data && data.data.length){
            select.innerHTML = '';
            data.data.forEach(model => {
                const opt = document.createElement('option'); opt.value = model.id; opt.textContent = model.id;
                if(model.id.includes('gemini')) opt.selected = true;
                select.appendChild(opt);
            });
            onModelChange(select);
        } else {
            select.innerHTML = '<option value="">⚠ 未返回模型</option>';
        }
    } catch(e) { select.innerHTML = '<option value="">⚠ 网络异常</option>'; }
}

// ==================== 日记本 ====================
function renderDiaries(){
    const container = document.getElementById('diaryMonthList');
    if(!container) return;
    container.innerHTML = '<div style="color:var(--dim);text-align:center;padding:30px;">档案解密中...</div>';

    fetch('/diary-logs').then(r => r.json()).then(data => {
        allDiaryEntries = [...data].reverse(); buildMonthBlocks(allDiaryEntries);
    }).catch(() => {
        container.innerHTML = '<div style="color:var(--dim);text-align:center;padding:20px;">需要后端支持数据库。</div>';
    });
}

function buildMonthBlocks(entries){
    const container = document.getElementById('diaryMonthList');
    if(!container) return;
    if(!entries.length){ container.innerHTML = '<div style="color:var(--dim);text-align:center;padding:30px;">这片星域暂无记录。</div>'; return; }
    const monthMap = new Map();
    entries.forEach(d => {
        const month = d.date ? d.date.substring(0, 7) : '未知';
        if(!monthMap.has(month)) monthMap.set(month, []);
        monthMap.get(month).push(d);
    });
    container.innerHTML = [...monthMap.keys()].map((month, idx) => {
        const list = monthMap.get(month); const isOpen = (idx === 0);
        return `<div class="month-block">
            <div class="month-header ${isOpen ? 'open' : ''}" onclick="const b=this.nextElementSibling;const c=this.querySelector('.month-chevron');if(b.style.display==='none'){b.style.display='flex';this.classList.add('open');c.innerText='▾';}else{b.style.display='none';this.classList.remove('open');c.innerText='▸';}">
                <span class="month-chevron">${isOpen ? '▾' : '▸'}</span>
                <span class="month-label">${month}</span><span class="month-count">${list.length} 篇</span>
            </div>
            <div class="month-body" style="display:${isOpen ? 'flex' : 'none'}">
                ${list.map(d => `<div class="diary-entry"><div class="d-date"><span>${d.date||''}</span><span class="d-author">${d.author==='system'?'沈望':'江鱼'}</span></div><div class="d-text">${(d.text||'').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div></div>`).join('')}
            </div>
        </div>`;
    }).join('');
}

// ==================== 视觉与触觉控制中枢 ====================
let currentImgBase64 = null;
let pressTimer       = null;
let touchX = 0, touchY = 0;

document.getElementById('imgUpload')?.addEventListener('change', function(e){
    const file = e.target.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = function(event){
        currentImgBase64 = event.target.result;
        document.getElementById('previewImg').src = currentImgBase64;
        document.getElementById('imgPreviewWrap').style.display = 'block';
    };
    reader.readAsDataURL(file);
});

function clearImage(){
    currentImgBase64 = null;
    const previewImg = document.getElementById('previewImg'); if(previewImg) previewImg.src = '';
    const wrap = document.getElementById('imgPreviewWrap'); if(wrap) wrap.style.display = 'none';
    const upload = document.getElementById('imgUpload'); if(upload) upload.value = '';
}

function handleMsgTouchStart(e, index, msg){
    touchX = e.touches ? e.touches[0].clientX : e.clientX;
    touchY = e.touches ? e.touches[0].clientY : e.clientY;
    pressTimer = setTimeout(() => showContextMenu(touchX, touchY, msg), 500);
}
function handleMsgTouchEnd(){ clearTimeout(pressTimer); }

function showContextMenu(clientX, clientY, msg){
    const menu = document.getElementById('msgContextMenu');
    if(!menu) return;
    document.getElementById('menuTime').innerText  = `🕒 时间: ${msg.time  || '刚刚'}`;
    document.getElementById('menuModel').innerText = `🤖 模型: ${msg.model || '未知'}`;
    menu.style.display = 'block'; menu.style.left = clientX + 'px'; menu.style.top = clientY + 'px';
    if(clientX + menu.offsetWidth  > window.innerWidth) menu.style.left = (window.innerWidth  - menu.offsetWidth  - 10) + 'px';
    if(clientY + menu.offsetHeight > window.innerHeight) menu.style.top  = (window.innerHeight - menu.offsetHeight - 10) + 'px';
}

document.addEventListener('click', (e) => {
    if(!e.target.closest('#msgContextMenu') && !e.target.closest('.msg')){
        const menu = document.getElementById('msgContextMenu');
        if(menu) menu.style.display = 'none';
    }
});

function triggerRegenerate(){
    document.getElementById('msgContextMenu').style.display = 'none';
    const session = getActiveSession();
    if(session.messages.length < 2) return;

    const lastMsg = session.messages[session.messages.length - 1];
    if(lastMsg.role === 'assistant'){
        session.messages.pop();
        const userMsg = session.messages.pop();
        saveToCloud(); renderChatMessages();

        const input = document.getElementById('chatInput');
        if(input) input.value = userMsg.content;
        
        if(userMsg.image){
            currentImgBase64 = userMsg.image;
            document.getElementById('previewImg').src = currentImgBase64;
            document.getElementById('imgPreviewWrap').style.display = 'block';
        }
        toast('时光倒流 ✦ 重新发送中...'); sendChat();
    } else {
        toast('只能让沈望重新生成他最后的一句话哦');
    }
}

// ==================== 初始化 ====================
syncFromCloud();
