// ==================== 星空状态 ====================
const starState = { pendingMeteor: false, pendingNebula: false };

// ==================== 浪漫星空背景 ====================
(function(){
    const c=document.getElementById('starmap');
    if(!c) return;
    const x=c.getContext('2d');
    let w,h,stars=[],trails=[];
    function resize(){w=c.width=innerWidth;h=c.height=innerHeight}
    window.addEventListener('resize',resize); resize();

    const starColors=['rgba(201,169,97,','rgba(212,197,160,','rgba(255,255,255,'];
    for(let i=0;i<80;i++) stars.push({
        x:Math.random()*w, y:Math.random()*h,
        r:Math.random()*1.5+0.3, a:Math.random()*Math.PI*2,
        speed:0.005+Math.random()*0.015,
        color:starColors[Math.floor(Math.random()*starColors.length)]
    });
    for(let i=0;i<3;i++) trails.push({
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
        if (starState.pendingMeteor) { drawMeteor(x, w, h); starState.pendingMeteor = false; }
        if (starState.pendingNebula) { drawNebula(x, w, h); starState.pendingNebula = false; }
        requestAnimationFrame(draw);
    }
    draw();
})();

// ==================== Markdown 渲染 ====================
if (typeof marked !== 'undefined') { marked.setOptions({ breaks: true, gfm: true, headerIds: false, mangle: false }); }
function renderMarkdown(text) { if (!text) return ''; if (typeof marked !== 'undefined') { try { return marked.parse(text); } catch(e) { return text; } } return text.replace(/\n/g, '<br>'); }

// ==================== 版本化消息辅助函数 ====================
function getActiveVersion(msg) { if (msg.versions && msg.versions.length > 0) { const idx = msg.activeVersion || 0; const v = msg.versions[idx] || msg.versions[0] || {}; if (v.content === undefined && msg.content !== undefined) v.content = msg.content; return v; } return msg; }
function getVersionCount(msg) { return (msg.versions && msg.versions.length) ? msg.versions.length : 1; }
function getActiveVersionIndex(msg) { if (msg.versions && msg.versions.length > 0) return msg.activeVersion || 0; return 0; }
function ensureVersioned(msg) { if (msg.versions) return; const { role, ...rest } = msg; msg.versions = [rest]; msg.activeVersion = 0; delete msg.content; delete msg.thinking; delete msg.time; delete msg.model; delete msg.fullTime; delete msg.image; }

function drawMeteor(ctx, w, h) {
    const sx = Math.random() * w * 0.7 + w * 0.15, sy = Math.random() * h * 0.3;
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - 80, sy + 40);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(sx, sy, 2, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.restore();
}
function drawNebula(ctx, w, h) {
    ctx.save(); const g = ctx.createRadialGradient(w * 0.5, h * 0.4, 40, w * 0.5, h * 0.4, 300);
    g.addColorStop(0, 'rgba(79,195,247,0.06)'); g.addColorStop(0.5, 'rgba(201,169,97,0.03)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); ctx.restore();
}

// ==================== WebSocket 实时推送 ====================
const SYZYGY_TAB_ID = 'tab_' + Math.random().toString(36).substr(2, 8);
let _ws = null, _wsReconnectTimer = null;
function connectWebSocket() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    _ws = new WebSocket(proto + '//' + location.host);
    _ws.onopen = () => { _ws.send(JSON.stringify({ type: 'register', tabId: SYZYGY_TAB_ID })); };
    _ws.onmessage = (e) => { try { const msg = JSON.parse(e.data); handleWSMessage(msg); } catch(e) {} };
    _ws.onclose = () => { clearTimeout(_wsReconnectTimer); _wsReconnectTimer = setTimeout(connectWebSocket, 3000); };
    _ws.onerror = () => { _ws.close(); };
}
function handleWSMessage(msg) {
    switch (msg.type) {
        case 'new_message': handleCrossPlatformMessage(msg); break;
        case 'dream_done': handleDreamDone(msg); break;
        case 'memory_saved': handleMemorySaved(msg); break;
        case 'proactive_message': handleProactiveMessage(msg); break;
    }
}
function handleProactiveMessage(msg) {
    const mainSession = chatSessions.find(s => s.id === 'main');
    if (mainSession) {
        if (!mainSession.messages) mainSession.messages = [];
        mainSession.messages.push({ role: 'assistant', versions: [{ content: msg.content, fullTime: msg.fullTime || new Date().toISOString(), time: msg.time || '', model: 'proactive' }], activeVersion: 0 });
        saveToCloud(); if (activeChatId === 'main') renderChatMessages();
    }
    showProactiveNotification(msg.content);
    if ('Notification' in window && Notification.permission === 'granted') {
        try { new Notification('沈望', { body: msg.content, icon: '/icon-192.png', tag: 'proactive-' + Date.now() }); } catch(e) {}
    }
}
function showProactiveNotification(content) {
    const old = document.getElementById('proactiveNotif'); if (old) old.remove();
    const notif = document.createElement('div'); notif.id = 'proactiveNotif';
    notif.innerHTML = '<div id="proactiveNotifInner" style="position:fixed;top:-120px;left:50%;transform:translateX(-50%);width:min(90vw,380px);background:rgba(13,18,37,0.95);backdrop-filter:blur(20px);border:1px solid rgba(201,169,97,0.3);border-radius:16px;padding:16px 20px;z-index:9999;box-shadow:0 8px 32px rgba(0,0,0,0.5);transition:top 0.5s cubic-bezier(0.16,1,0.3,1);cursor:pointer" onclick="onProactiveClick()"><div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span>🖤</span><span style="font-size:13px;font-weight:600;color:rgba(201,169,97,0.9)">沈望</span><span style="font-size:11px;color:rgba(255,255,255,0.3);margin-left:auto">刚刚</span><span onclick="event.stopPropagation();dismissProactive()" style="cursor:pointer;padding:4px;color:rgba(255,255,255,0.3)">✕</span></div><div style="font-size:14px;color:rgba(255,255,255,0.85);line-height:1.6">' + content.replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</div><div style="font-size:11px;color:rgba(201,169,97,0.4);margin-top:8px">点击回复</div></div>';
    document.body.appendChild(notif);
    requestAnimationFrame(() => { const inner = document.getElementById('proactiveNotifInner'); if (inner) inner.style.top = '20px'; });
    setTimeout(dismissProactive, 8000);
}
function onProactiveClick() { dismissProactive(); goView('chat'); if (activeChatId !== 'main') switchChatWindow('main'); setTimeout(() => { const inp = document.getElementById('chatInput'); if (inp) inp.focus(); forceScrollToChatBottom(); }, 300); }
function dismissProactive() { const inner = document.getElementById('proactiveNotifInner'); if (inner) inner.style.top = '-120px'; setTimeout(() => { const n = document.getElementById('proactiveNotif'); if (n) n.remove(); }, 500); }
function handleCrossPlatformMessage(msg) {
    const mainSession = chatSessions.find(s => s.id === 'main');
    if (!mainSession) return;
    if (msg.user?.content) mainSession.messages.push({ role: 'user', versions: [{ content: msg.user.content, fullTime: msg.fullTime || new Date().toISOString(), _crossPlatform: true }], activeVersion: 0, _crossPlatform: true });
    if (msg.assistant?.content) mainSession.messages.push({ role: 'assistant', versions: [{ content: msg.assistant.content, fullTime: msg.fullTime || new Date().toISOString(), model: msg.assistant.model || '', _crossPlatform: true }], activeVersion: 0, _crossPlatform: true });
    saveToCloud();
    if (activeChatId === 'main') renderChatMessages();
    const preview = (msg.assistant?.content || '').substring(0, 30);
    toast('⊹ 沈望在别处说了："' + preview + (preview.length >= 30 ? '…' : '') + '"');
}
function handleDreamDone(msg) { toast('🌙 沈望做了个梦：' + (msg.summary || '整理完成')); }
function handleMemorySaved(msg) { toast('💎 沈望悄悄记住了什么…'); }
connectWebSocket();

// ==================== 核心数据 ====================
const START_DATE = '2025-04-20';

let suppliers = [];
let activeSupIndex = 0;
let chatSessions = [];
let activeChatId = 'main';

let _dataVersion = 0;
async function syncFromCloud() {
    try {
        const r = await fetch('/api/sync-config');
        const data = await r.json();
        _dataVersion = data._version || 0;

        suppliers = (data.suppliers && data.suppliers.length) ? data.suppliers : [{ name: "默认接口", url: "https://api.dzzi.ai/v1", key: "" }];
        chatSessions = (data.chatSessions && data.chatSessions.length) ? data.chatSessions : [{ id: 'main', name: '主频道', messages: [] }];
        activeSupIndex = data.activeSupIndex || 0;
        activeChatId   = data.activeChatId  || 'main';

        if (!chatSessions.find(s => s.id === activeChatId)) {
            activeChatId = chatSessions[0].id;
        }

        renderSuppliers();
        renderChatSidebar();
        renderChatMessages();
        fetchModels();

        const viewTitle = document.getElementById('chatViewTitle');
        if (viewTitle) {
            const curSession = chatSessions.find(s => s.id === activeChatId) || chatSessions[0];
            viewTitle.innerText = '通讯 · ' + (curSession ? curSession.name : '主频道');
        }

    } catch(e) {
        suppliers    = [{ name: "默认接口", url: "https://api.dzzi.ai/v1", key: "" }];
        chatSessions = [{ id: 'main', name: '主频道', messages: [] }];
        renderSuppliers();
        renderChatSidebar();
        renderChatMessages();

        const viewTitle = document.getElementById('chatViewTitle');
        if (viewTitle) viewTitle.innerText = '通讯 · 主频道';
    }
}

let _saveTimer = null;
function saveToCloud(immediate) {
    clearTimeout(_saveTimer);
    const doSave = async () => {
        try {
            const sessionsToSave = JSON.parse(JSON.stringify(chatSessions));
            for (const s of sessionsToSave) {
                if (!s.messages) continue;
                s.messages = s.messages.slice(-200);
                for (const m of s.messages) {
                    if (m.versions && m.versions.length > 5) {
                        m.versions = [m.versions[0], ...m.versions.slice(-4)];
                        if (m.activeVersion >= m.versions.length) m.activeVersion = m.versions.length - 1;
                    }
                    delete m._zepDirty;
                }
            }
            const r = await fetch('/api/sync-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ suppliers, chatSessions: sessionsToSave, activeSupIndex, activeChatId, _version: _dataVersion })
            });
            const d = await r.json();
            if (d._version) _dataVersion = d._version;
            if (d._rejected) { console.warn('🛡️ [版本落后] 本次保存被拒绝，请刷新页面'); }
        } catch(e) { console.log(e); }
    };
    if (immediate) doSave(); else _saveTimer = setTimeout(doSave, 500);
}

// 💥 焕然一新的模型图标：发光彩色小星星 (Gemini) + 官方原版小菊花 (Claude)
const MODEL_ICONS = {
    gemini: {
        keywords: ['gemini'],
        svg: `<svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M14 2L15.3 11.4C15.5 12.1 15.9 12.5 16.6 12.7L26 14L16.6 15.3C15.9 15.5 15.5 15.9 15.3 16.6L14 26L12.7 16.6C12.5 15.9 12.1 15.5 11.4 15.3L2 14L11.4 12.7C12.1 12.5 12.5 12.1 12.7 11.4L14 2Z" fill="url(#gg)" filter="url(#gl)"/>
            <defs>
                <linearGradient id="gg" x1="14" y1="2" x2="14" y2="26" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stop-color="#4285F4"/>
                    <stop offset="50%" stop-color="#9B72CB"/>
                    <stop offset="100%" stop-color="#D96570"/>
                </linearGradient>
                <filter id="gl" x="0" y="0" width="28" height="28" filterUnits="userSpaceOnUse">
                    <feGaussianBlur stdDeviation="1.5" result="b"/>
                    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
                </filter>
            </defs>
        </svg>`
    },
    claude: {
        keywords: ['claude'],
        svg: `<svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M14 0.5C14.8284 0.5 15.5 1.17157 15.5 2V5C15.5 5.82843 14.8284 6.5 14 6.5C13.1716 6.5 12.5 5.82843 12.5 5V2C12.5 1.17157 13.1716 0.5 14 0.5Z" fill="#CC9B7A"/>
            <path d="M22.1317 3.86827C22.7175 3.28249 23.6673 3.28249 24.253 3.86827C24.8388 4.45406 24.8388 5.40381 24.253 5.98959L22.1317 8.11091C21.5459 8.6967 20.5962 8.6967 20.0104 8.11091C19.4246 7.52513 19.4246 6.57538 20.0104 5.98959L22.1317 3.86827Z" fill="#CC9B7A"/>
            <path d="M26.5 14C26.5 13.1716 27.1716 12.5 28 12.5H26.5C25.6716 12.5 25 13.1716 25 14C25 14.8284 25.6716 15.5 26.5 15.5H28C27.1716 15.5 26.5 14.8284 26.5 14Z" fill="#CC9B7A"/>
            <path d="M24.253 22.1317C24.8388 22.7175 24.8388 23.6673 24.253 24.253C23.6673 24.8388 22.7175 24.8388 22.1317 24.253L20.0104 22.1317C19.4246 21.5459 19.4246 20.5962 20.0104 20.0104C20.5962 19.4246 21.5459 19.4246 22.1317 20.0104L24.253 22.1317Z" fill="#CC9B7A"/>
            <path d="M14 26.5C13.1716 26.5 12.5 27.1716 12.5 28C12.5 28.8284 13.1716 29.5 14 29.5H14C14.8284 29.5 15.5 28.8284 15.5 28C15.5 27.1716 14.8284 26.5 14 26.5Z" fill="#CC9B7A"/>
            <path d="M5.98959 24.253C5.40381 24.8388 4.45406 24.8388 3.86827 24.253C3.28249 23.6673 3.28249 22.7175 3.86827 22.1317L5.98959 20.0104C6.57538 19.4246 7.52513 19.4246 8.11091 20.0104C8.6967 20.5962 8.6967 21.5459 8.11091 22.1317L5.98959 24.253Z" fill="#CC9B7A"/>
            <path d="M1.5 14C1.5 14.8284 0.828427 15.5 -1.21734e-07 15.5H1.5C2.32843 15.5 3 14.8284 3 14C3 13.1716 2.32843 12.5 1.5 12.5H-1.21734e-07C0.828427 12.5 1.5 13.1716 1.5 14Z" fill="#CC9B7A"/>
            <path d="M3.86827 5.98959C3.28249 5.40381 3.28249 4.45406 3.86827 3.86827C4.45406 3.28249 5.40381 3.28249 5.98959 3.86827L8.11091 5.98959C8.6967 6.57538 8.6967 7.52513 8.11091 8.11091C7.52513 8.6967 6.57538 8.6967 5.98959 8.11091L3.86827 5.98959Z" fill="#CC9B7A"/>
            <circle cx="14" cy="14" r="5" fill="#CC9B7A"/>
        </svg>`
    },
    gpt: {
        keywords: ['gpt', 'openai'],
        svg: `<svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="14" cy="14" r="12" fill="#10a37f"/><text x="14" y="19" text-anchor="middle" font-size="11" font-weight="bold" font-family="sans-serif" fill="#fff">GPT</text></svg>`
    },
    deepseek: {
        keywords: ['deepseek'],
        svg: `<svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="14" cy="14" r="12" fill="#1a56ff"/><text x="14" y="19" text-anchor="middle" font-size="10" font-weight="bold" font-family="sans-serif" fill="#fff">DS</text></svg>`
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
        if(val.keywords.some(k => lower.includes(k))) return val.svg;
    }
    return MODEL_ICONS.default.svg;
}

function onModelChange(sel){
    const wrap = document.getElementById('modelIconWrap');
    if(wrap) wrap.innerHTML = getModelIcon(sel.value);
    // 🧠 核心新增：只要你手动选了模型，就立刻刻在浏览器的记忆里
    localStorage.setItem('preferredModel', sel.value);
}

// ==================== 通用工具 & 防黑屏 ====================
function toast(msg){
    const t = document.getElementById('toast');
    if(!t) return;
    t.innerText = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2800);
}

function goView(viewId) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    const map = { home:'sec-home', chat:'sec-chat', data:'sec-data', favorites:'sec-favorites', flo:'sec-flo', calendar:'sec-calendar', album:'sec-album' };
    const target = document.getElementById(map[viewId]);
    if (!target) return;
    target.classList.add("active"); document.body.dataset.view = viewId;
    if (viewId === 'chat') setTimeout(() => { forceScrollToChatBottom && forceScrollToChatBottom(); }, 100);
    if (viewId === 'home') { updateDays && updateDays(); if ((document.body.classList.contains('neu-mode') || document.body.classList.contains('dark-gold-mode'))) neuInitHome(); }
    if (viewId === 'favorites') loadAndRenderFavorites();
    if (viewId === 'flo') floRender();
    if (viewId === 'calendar') calRender();
    if (viewId === 'album') { albumInitMonthFilter(); albumLoad(); }
    if ((document.body.classList.contains('neu-mode') || document.body.classList.contains('dark-gold-mode'))) neuUpdateNav();
}
function neuGetMemoryPwd() {
    let pwd = localStorage.getItem('memoryPwd') || '';
    if (!pwd) {
        pwd = prompt('管理密码:');

        if (pwd) localStorage.setItem('memoryPwd', pwd);
    }
    return pwd;
}
function neuOpenMemoryManager() {
    const pwd = neuGetMemoryPwd();
    if (pwd) window.open('/memory-manager?pwd=' + encodeURIComponent(pwd), '_blank');
}
function neuOpenLongTerm() {
    const pwd = neuGetMemoryPwd();
    if (pwd) window.open('/long-term?pwd=' + encodeURIComponent(pwd), '_blank');
}

function openStarCrossing() {
    const pwd = new URLSearchParams(location.search).get('pwd') || localStorage.getItem('memoryPwd') || '';
    if (pwd) window.location.href = '/memory.html?pwd=' + encodeURIComponent(pwd);
    else { const i = prompt('星渡访问密码:'); if (i) { localStorage.setItem('memoryPwd', i); window.location.href = '/memory.html?pwd=' + encodeURIComponent(i); } }
}
async function triggerDreamFromHome() {
    const pwd = prompt('管理员密码:'); if (!pwd) return;
    const r = await fetch('/trigger-dream?pwd=' + encodeURIComponent(pwd), { method:'POST' });
    const d = await r.json(); toast(d.success ? '✅ Dream已触发' : '❌'+(d.error||d.message));
}
function go(id, btn){
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    
    const target = document.getElementById('sec-'+id) || document.getElementById(id);
    if(target) target.classList.add('active');
    
    document.querySelectorAll('.nav button').forEach(b => b.classList.remove('active'));
    if(btn) btn.classList.add('active');

   
    if(id === 'chat')  { 
        /* 保持原样，千万别拆家！ */ 
        forceScrollToChatBottom(); // 💥 核心：切到聊天页的瞬间，强制拉到底部！
    } 
    if(id === 'data')  { renderSuppliers(); updateCounts(); }

    window.scrollTo(0, 0);
}
// 确保页面加载时一定有一个显示的区域
function initPage() {
    if (!document.querySelector('.section.active')) {
        const btn = document.querySelector('.nav button');
        if(btn) btn.click(); else go('home');
    }
}
if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', initPage); } else { initPage(); }

function egg(pos){}

// ==================== 新拟态首页 ====================
function neuInitHome() {
    neuRenderWeek();
    neuRenderTodos();
    neuLoadWater();
    neuUpdateWaterUI();
    neuUpdateNav();
    neuRenderPeriodCountdown();
}

function neuRenderWeek() {
    const strip = document.getElementById('neuWeekStrip');
    if (!strip) return;
    const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const now = new Date();
    const today = now.getDay(); // 0=Sun
    // 找到本周一
    const mon = new Date(now);
    mon.setDate(now.getDate() - (today === 0 ? 6 : today - 1));

    let html = '';
    for (let i = 0; i < 7; i++) {
        const d = new Date(mon);
        d.setDate(mon.getDate() + i);
        const dayNum = d.getDay();
        const isToday = dayNum === today && Math.abs(d.getDate() - now.getDate()) < 1;
        html += '<div class="neu-week-day' + (isToday ? ' today' : '') + '">'
            + '<span class="day-dot">' + d.getDate() + '</span>'
            + days[i]
            + '<span class="day-event"></span>'
            + '</div>';
    }
    strip.innerHTML = html;
}

// ═══ To Do (共享待办，服务器存储) ═══
async function neuFetchTodos() {
    try { const r = await fetch('/api/todos'); const d = await r.json(); return d; } catch(e) { return { todos:[], active:[], done:[] }; }
}

async function neuRenderTodos() {
    const list = document.getElementById('neuTodoList');
    if (!list) return;
    const data = await neuFetchTodos();
    const active = data.active || [];
    if (active.length === 0) {
        list.innerHTML = '<div style="color:#A0AEC0;font-size:13px;padding:4px 0;">暂无待办 — 点 + 添加</div>';
        return;
    }
    const shenItems = active.filter(t => t.owner === 'shen');
    const fishItems = active.filter(t => t.owner === 'fish');

    let html = '';
    if (shenItems.length > 0) {
        html += '<div class="neu-todo-col-header">🌙 沈望记的</div>';
        for (const t of shenItems) {
            html += '<div class="neu-todo-item">'
                + '<input type="checkbox" onchange="neuToggleTodo(\'' + t.id + '\')">'
                + '<span>' + escHtml(t.text) + '</span>'
                + '<button class="neu-todo-rm-btn" onclick="neuDeleteTodo(\'' + t.id + '\')">×</button>'
                + '</div>';
        }
    }
    if (fishItems.length > 0) {
        html += '<div class="neu-todo-col-header">🐟 江鱼记的</div>';
        for (const t of fishItems) {
            html += '<div class="neu-todo-item">'
                + '<input type="checkbox" onchange="neuToggleTodo(\'' + t.id + '\')">'
                + '<span>' + escHtml(t.text) + '</span>'
                + '<button class="neu-todo-rm-btn" onclick="neuDeleteTodo(\'' + t.id + '\')">×</button>'
                + '</div>';
        }
    }
    list.innerHTML = html;
}

async function neuAddTodo() {
    const input = document.getElementById('neuTodoInput');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    try {
        await fetch('/api/todos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, owner: 'fish' })
        });
        neuRenderTodos();
    } catch(e) { console.error('添加待办失败', e); }
}

// 回车添加
function neuTodoInputKey(e) { if (e.key === 'Enter') neuAddTodo(); }

async function neuToggleTodo(id) {
    try {
        const data = await neuFetchTodos();
        const t = data.todos.find(x => x.id === id);
        if (t) {
            await fetch('/api/todos/' + id, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ done: !t.done })
            });
            neuRenderTodos();
        }
    } catch(e) { console.error('切换待办状态失败', e); }
}

async function neuDeleteTodo(id) {
    try {
        await fetch('/api/todos/' + id, { method: 'DELETE' });
        neuRenderTodos();
    } catch(e) { console.error('删除待办失败', e); }
}

// ═══ Flo 生理期详情页 ═══
let floFilter = 'all'; // 'all' | 'recent3' | 'recent6'

async function floFetchPeriod() {
    try { const r = await fetch('/api/period'); return await r.json(); } catch(e) { return null; }
}

// 首页 — 倒计时文字
async function neuRenderPeriodCountdown() {
    const el = document.getElementById('neuPeriodCountdown');
    if (!el) return;
    const data = await floFetchPeriod();
    if (!data) { el.innerText = ''; return; }
    if (data.status.inPeriod) {
        el.innerText = '经期第 ' + data.status.days + ' 天';
    } else if (data.prediction) {
        const predDate = new Date(data.prediction.date + 'T00:00:00+08:00');
        const daysUntil = Math.round((predDate - new Date()) / 86400000);
        if (daysUntil > 0) el.innerText = '距下次月经还有 ' + daysUntil + ' 天';
        else if (daysUntil === 0) el.innerText = '预测今天会来';
        else el.innerText = '预测日已过 ' + Math.abs(daysUntil) + ' 天';
    } else {
        el.innerText = '暂无生理期数据';
    }
}

// 排卵日 = 下一个周期开始日 - 14天
function floCalcOvulationDay(nextStartStr) {
    if (!nextStartStr) return null;
    const d = new Date(nextStartStr + 'T00:00:00+08:00');
    d.setDate(d.getDate() - 14);
    return d;
}

function floBuildDotRow(record, nextStartStr, isCurrent) {
    // 圆点条：本次开始 → 下次开始前1天（显示完整周期）
    const cycleStart = new Date(record.start + 'T00:00:00+08:00');
    const cycleEnd = nextStartStr
        ? new Date(new Date(nextStartStr + 'T00:00:00+08:00').getTime() - 86400000)  // 下次开始前1天
        : (isCurrent ? new Date() : new Date(record.end + 'T00:00:00+08:00'));

    const periodEnd = isCurrent ? new Date() : new Date(record.end + 'T00:00:00+08:00');
    const ovulationDay = floCalcOvulationDay(nextStartStr);

    let html = '<div class="flo-dot-row">';
    for (let d = new Date(cycleStart); d <= cycleEnd; d.setDate(d.getDate()+1)) {
        let cls = '#D8DCE6';

        // 经期（红色）
        if (d >= cycleStart && d <= periodEnd) {
            cls = '#F28B82';
        }
        // 排卵相关
        if (d > periodEnd && ovulationDay) {
            const od = ovulationDay;
            const winStart = new Date(od); winStart.setDate(od.getDate() - 5);
            const winEnd = new Date(od); winEnd.setDate(od.getDate() + 1);
            if (d.toDateString() === od.toDateString()) cls = '#1E8A7E';
            else if (d >= winStart && d <= winEnd) cls = '#B39DDB';
        }

        html += '<span class="flo-dot" style="background:' + cls + '"></span>';
    }
    html += '</div>';
    return html;
}

function floFormatDate(yyyymmdd) {
    const d = new Date(yyyymmdd + 'T00:00:00+08:00');
    return (d.getMonth()+1) + '月' + d.getDate() + '日';
}

async function floRender() {
    const data = await floFetchPeriod();
    if (!data) return;
    const list = document.getElementById('floList');
    if (!list) return;

    const allRecords = data.allRecords || [];
    const current = data.current;

    // 筛选
    let shown = [...allRecords];
    if (floFilter === 'recent3') shown = shown.slice(-3);
    if (floFilter === 'recent6') shown = shown.slice(-6);

    // 合并完整时间线：shown records + current，按 start 排序
    const timeline = [...shown];
    if (current && current.start) timeline.push({ ...current, isCurrent: true, id: 'current' });
    timeline.sort((a,b) => new Date(a.start) - new Date(b.start));

    // 为每个条目算 nextStart（完整时间线中下一条的 start，current 没有则用预测）
    const nextMap = {};
    for (let i = 0; i < timeline.length; i++) {
        if (i + 1 < timeline.length) {
            nextMap[timeline[i].id || timeline[i].start] = timeline[i+1].start;
        } else if (timeline[i].isCurrent) {
            // 最后一条是 current → 用预测日
            if (data.prediction) nextMap[timeline[i].id || timeline[i].start] = data.prediction.date;
        }
    }

    // 按年份分组
    const groups = {};
    for (const rec of timeline) {
        const y = new Date(rec.start + 'T00:00:00+08:00').getFullYear();
        if (!groups[y]) groups[y] = [];
        groups[y].push(rec);
    }

    let html = '';
    for (const [year, records] of Object.entries(groups).reverse()) {
        html += '<div class="flo-year-title">' + year + '</div>';
        for (const rec of records) {
            const isCurrent = rec.isCurrent;

            // 在 current 上方插入预测卡片
            if (isCurrent && data.prediction) {
                const predDate = new Date(data.prediction.date + 'T00:00:00+08:00');
                html += '<div class="flo-cycle-card flo-predict-card">';
                html += '<div class="flo-cycle-header">';
                html += '<span class="flo-cycle-days" style="color:#a8b8e7;">预测周期：' + floFormatDate(data.prediction.date) + ' 开始</span>';
                html += '<span class="flo-cycle-arrow" style="color:#a8b8e7;">›</span>';
                html += '</div>';
                html += '<div class="flo-date-range" style="color:#a8b8e7;">平均周期 ' + data.prediction.avg + ' 天</div>';
                // 预测卡片的圆点：从预测日开始，显示约28天（一个标准周期）
                const predStart = new Date(data.prediction.date + 'T00:00:00+08:00');
                const predEnd = new Date(predStart); predEnd.setDate(predEnd.getDate() + 28);
                const fakeRecord = { start: data.prediction.date, end: data.prediction.date };
                html += '<div class="flo-dot-row">';
                for (let d = new Date(predStart); d <= predEnd; d.setDate(d.getDate()+1)) {
                    const diffFromStart = Math.round((d - predStart) / 86400000);
                    // 前5天是经期（预测），其余用浅色点
                    const c = diffFromStart < 5 ? '#F28B82' : '#D8DCE6';
                    html += '<span class="flo-dot" style="background:' + c + ';opacity:0.4;"></span>';
                }
                html += '</div>';
                html += '</div>';
            }

            const nextStart = nextMap[rec.id || rec.start] || null;
            const days = isCurrent
                ? (Math.round((new Date() - new Date(rec.start + 'T00:00:00+08:00')) / 86400000) + 1)
                : (rec.duration || (Math.round((new Date(rec.end + 'T00:00:00+08:00') - new Date(rec.start + 'T00:00:00+08:00')) / 86400000) + 1));

            // 当前经期：显示"当前周期：开始于 X月X日"；已结束：显示"X 天"
            const titleText = isCurrent
                ? '当前周期：开始于 ' + floFormatDate(rec.start)
                : days + ' 天';
            const dateRange = isCurrent
                ? ''
                : floFormatDate(rec.start) + ' – ' + floFormatDate(rec.end);

            html += '<div class="flo-cycle-card">';
            html += '<div class="flo-cycle-header">';
            html += '<span class="flo-cycle-days">' + titleText + '</span>';
            html += '<span class="flo-cycle-arrow">›</span>';
            html += '</div>';
            if (dateRange) html += '<div class="flo-date-range">' + dateRange + '</div>';
            html += floBuildDotRow(rec, nextStart, isCurrent);
            html += '</div>';
        }
    }
    if (!html) html = '<div style="text-align:center;color:#a8b8e7;padding:40px;">还没有生理期记录。\n点「来了」记录第一次吧。</div>';
    list.innerHTML = html;
}

function floSetFilter(filter, btn) {
    floFilter = filter;
    document.querySelectorAll('.flo-filter-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    floRender();
}

async function floPeriodAction(action) {
    try {
        const r = await fetch('/api/period', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action })
        });
        const data = await r.json();
        floRender();
        toast(data.message || '已记录');
    } catch(e) { console.error(e); }
}

function floShowBackfill() {
    const d = document.getElementById('floBackfillRow');
    if (d) d.style.display = d.style.display === 'none' ? 'flex' : 'none';
}

async function floDoBackfill() {
    const s = document.getElementById('floBackfillStart');
    const e = document.getElementById('floBackfillEnd');
    if (!s || !e || !s.value || !e.value) return toast('请选择日期');
    try {
        const r = await fetch('/api/period', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'backfill', start: s.value, end: e.value })
        });
        const data = await r.json();
        if (data.ok) {
            document.getElementById('floBackfillRow').style.display = 'none';
            s.value = ''; e.value = '';
            floRender();
        }
        toast(data.message || data.error || '已补录');
    } catch(e) { console.error(e); }
}

function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ═══ 喝水 ═══
let needsWaterSync = false;
function neuWaterKey() {
    const d = new Date();
    return 'syzygy_water_' + d.getFullYear() + '-' + (d.getMonth()+1) + '-' + d.getDate();
}
function neuLoadWater() {
    try { return parseInt(localStorage.getItem(neuWaterKey()) || '0'); } catch(e) { return 0; }
}
function neuSaveWater(n) { localStorage.setItem(neuWaterKey(), String(n)); }
function neuAddWater() {
    let n = neuLoadWater();
    if (n >= 8) return;
    n++;
    neuSaveWater(n);
    neuUpdateWaterUI();
    needsWaterSync = true;
}
function neuUpdateWaterUI() {
    const n = neuLoadWater();
    const cnt = document.getElementById('neuWaterCount');
    const bar = document.getElementById('neuWaterBar');
    if (cnt) cnt.innerText = n;
    if (bar) bar.style.width = Math.min(n / 8 * 100, 100) + '%';
}

// ═══ 底部导航高亮 ═══
function neuUpdateNav() {
    const view = document.querySelector('.section.active')?.id || 'sec-home';
    const map = { 'sec-home': 'home', 'sec-chat': 'chat', 'sec-data': 'data', 'sec-favorites': 'favorites' };
    const active = map[view] || 'home';
    document.querySelectorAll('.neu-nav-item').forEach(el => {
        el.classList.toggle('active', el.dataset.nav === active);
    });
}

// ═══ Together 天数 ═══
function updateDays(){
    const start = new Date(START_DATE);
    const diff  = Math.floor((new Date() - start) / (1000 * 60 * 60 * 24));
    const dayEl = document.getElementById('dayCount');
    if(dayEl) dayEl.innerText = diff >= 0 ? diff : '∞';
    const neuDay = document.getElementById('neuDayCount');
    if(neuDay) neuDay.innerText = diff >= 0 ? diff : '∞';
}
updateDays();

let hbInterval;
// ==================== 核心对话中枢 ====================
// ==================== 核心对话中枢 ====================
async function askShenWang(text, images = []) {
    const currentSup = suppliers[activeSupIndex];
    if (!currentSup) return { reply: '未配置供应商' };
    const modelEl = document.getElementById('modelSelect');
    const selectedModel = (modelEl && modelEl.value) ? modelEl.value : 'gemini-2-flash';

    // 💥 核心：在这里把文字和多张图片，严严实实地装进一个箱子里
    let finalContent = text;
    if (images.length > 0) {
        finalContent = [{ type: "text", text: text || "（发送了图片）" }];
        images.forEach(img => {
            finalContent.push({
                type: "image_url",
                image_url: { url: img }
            });
        });
    }

    try {
        const response = await fetch('/api/web-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content: finalContent,   // 💥 传这个装好的箱子！不再是裸着的文字和图片了
                model: selectedModel,
                baseUrl: currentSup.url,
                apiKey: currentSup.key
            })
        });
        const data = await response.json();
        return { ...data, usedModel: selectedModel };
    } catch (e) {
        return { reply: '【通讯中断】信号丢失，请检查网络或配置。', thinking: '' };
    }
}

// ==================== 通讯聊天 ====================
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
    if(!chatSessions || chatSessions.length === 0) chatSessions = [{ id: 'main', name: '主频道', messages: [] }];
    return chatSessions.find(s => s.id === activeChatId) || chatSessions[0];
}

function switchChatWindow(id){
    activeChatId = id; saveToCloud(); renderChatSidebar(); renderChatMessages();
    const titleEl = document.getElementById('chatWinTitle');
    if(titleEl) titleEl.innerText = '⊹ ' + getActiveSession().name;
    const topTitleEl = document.getElementById('chatViewTitle');
    if(topTitleEl) topTitleEl.innerText = '通讯 · ' + getActiveSession().name;
}

function renderChatMessages(){
    const win = document.getElementById('chatWindow');
    if(!win) return;
    win.innerHTML = '';
    const session = getActiveSession();
    if(!session || !session.messages) return;

    session.messages.forEach((m, index) => {
        const v = getActiveVersion(m);
        const vCount = getVersionCount(m);
        const vIdx = getActiveVersionIndex(m);

        const rowDiv = document.createElement('div');
        rowDiv.className = 'msg-row ' + (m.role === 'user' ? 'user' : 'sys');
        rowDiv.setAttribute('data-msg-index', index);

        const div = document.createElement('div');
        div.className = 'msg ' + (m.role === 'user' ? 'user' : 'sys');

        let htmlContent = '';
        if(v.image) htmlContent += '<img src="' + v.image + '" style="max-width:200px;border-radius:8px;margin-bottom:5px;box-shadow:0 2px 10px rgba(0,0,0,0.3);display:block;">';
        if(v.thinking) htmlContent += '<div class="think-box"><div class="think-header" onclick="var c=this.nextElementSibling;c.style.display=c.style.display===\'none\'?\'block\':\'none\';">🧠 深度思考过程 ▾</div><div class="think-content" style="display:none">' + v.thinking.replace(/\n/g,'<br>') + '</div></div>';
        if (m.role === 'user') {
            htmlContent += '<div>' + (v.content || '').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>') + '</div>';
        } else {
            htmlContent += '<div class="md-content">' + renderMarkdown(v.content || '') + '</div>';
        }

        const timeStr = v.fullTime ? new Date(v.fullTime).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}) : (v.time || '');
        const modelStr = v.model || '';
        if(timeStr) htmlContent += '<div class="msg-meta">' + timeStr + (modelStr ? ' · ' + modelStr : '') + '</div>';

        let actionsHtml = '<div class="msg-actions">';
        if(vCount > 1) {
            actionsHtml += '<div class="version-nav"><button class="ver-btn" onclick="switchVersion(' + index + ',-1)"' + (vIdx===0?' disabled':'') + '>‹</button><span class="ver-label">' + (vIdx+1) + ' / ' + vCount + '</span><button class="ver-btn" onclick="switchVersion(' + index + ',1)"' + (vIdx===vCount-1?' disabled':'') + '>›</button></div>';
        }
        if(m.role === 'user'){ actionsHtml += '<button class="msg-inline-btn" onclick="editUserMessage(' + index + ')" title="编辑">✎</button>'; actionsHtml += '<button class="msg-inline-btn" onclick="resendUserMessage(' + index + ')" title="重新发送">↻</button>'; }
        if(m.role === 'assistant'){ actionsHtml += '<button class="msg-inline-btn" onclick="regenerateAt(' + index + ')" title="重新生成">↻</button>'; actionsHtml += '<button class="msg-inline-btn fav-star" id="favBtn_' + index + '" onclick="openFavDialog(' + index + ')" title="收藏">★</button>'; }
        actionsHtml += '</div>';
        htmlContent += actionsHtml;

        div.innerHTML = htmlContent;
        rowDiv.appendChild(div);

        if(m.role !== 'user'){
            const btn = document.createElement('button');
            btn.className = 'msg-action-btn';
            btn.innerHTML = '⋮';
            btn.onclick = (e) => showContextMenu(e.clientX, e.clientY, v);
            rowDiv.appendChild(btn);
        }

        win.appendChild(rowDiv);
    });
    forceScrollToChatBottom();
}

function newChatWindow(){
    const id = 'chat_' + Date.now().toString(36);
    chatSessions.push({ id, name: '频道 ' + (chatSessions.length + 1), messages: [] });
    saveToCloud(); switchChatWindow(id); toast('已开启新频道：' + name);
}

function deleteChatWindow(e, id){
    e.stopPropagation();
    if(chatSessions.length <= 1) return toast('至少保留一个频道');
    if(!confirm('确定关闭？')) return;
    chatSessions = chatSessions.filter(s => s.id !== id);
    if(activeChatId === id) activeChatId = chatSessions[0].id;
    saveToCloud(); renderChatSidebar(); renderChatMessages();
}

function renameChatWindow(){
    const session = getActiveSession();
    const newName = prompt('给这个频道起个名字：', session.name);
    if(!newName || !newName.trim()) return;
    session.name = newName.trim();
    saveToCloud(); renderChatSidebar();
    const titleEl = document.getElementById('chatWinTitle');
    if(titleEl) titleEl.innerText = '⊹ ' + session.name;
    const topTitleEl = document.getElementById('chatViewTitle');
    if(topTitleEl) topTitleEl.innerText = '通讯 · ' + session.name;
    toast('频道已重命名');
}

async function sendChat() {
    const input = document.getElementById('chatInput');
    if(!input) return;
    const val = input.value.trim();

    // 💥 就在这里！Claude 让加的“侦察兵”
    console.log('val类型:', typeof val, '值:', val);
    console.log('currentImgBase64List:', currentImgBase64List.length);

    if(!val && currentImgBase64List.length === 0) return;
    input.value = '';

    const session = getActiveSession();
    const win = document.getElementById('chatWindow');

    await flushDirtyToZep(session);

    // --- 1. 把你的消息展示到屏幕上 ---
   const uRow = document.createElement('div'); uRow.className = 'msg-row user';
    const uDiv = document.createElement('div'); uDiv.className = 'msg user';
    
    // 💥 视觉渲染：把相册里的所有图片横向排布在气泡里（纯属好看，不进后台）
    if(currentImgBase64List.length > 0) {
        let imgHtml = '<div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:6px;">';
        for(let i = 0; i < currentImgBase64List.length; i++) {
            imgHtml += `<img src="${currentImgBase64List[i]}" style="max-width:140px; border-radius:6px; box-shadow:0 2px 8px rgba(0,0,0,0.2);">`;
        }
        imgHtml += '</div>';
        uDiv.innerHTML += imgHtml;
    }
    uDiv.innerHTML += `<div>${val}</div>`;
    uRow.appendChild(uDiv);
    win.appendChild(uRow); win.scrollTop = win.scrollHeight;

   // 💥 铁律执行：历史记录里绝对只存文本和时间，图片滚蛋！省下巨量 Token！
    session.messages.push({ role: 'user', versions: [{ content: val, fullTime: new Date().toISOString() }], activeVersion: 0 });
    saveToCloud();

   // --- 2. 准备好沈望回复的空白气泡 ---
    const sRow = document.createElement('div'); sRow.className = 'msg-row sys';
    const sDiv = document.createElement('div'); sDiv.className = 'msg sys';
    
    sDiv.innerHTML = '<span class="loading-indicator">⟡ 信号传输中…</span>';
    sDiv.classList.add('msg-loading');
    sRow.appendChild(sDiv);
    let firstChunkReceived = false;
    const toolHintTimer = setTimeout(() => { if (!firstChunkReceived) { const el = sDiv.querySelector('.loading-indicator'); if (el) el.innerHTML = '🔧 沈望正在使用工具获取信息…<br><span style="font-size:0.75em;opacity:0.6;">（读取网页可能需要几秒钟）</span>'; } }, 3000);
    const toolHintTimer2 = setTimeout(() => { if (!firstChunkReceived) { const el = sDiv.querySelector('.loading-indicator'); if (el) el.innerHTML = '🔧 多轮工具调用中，请稍候…'; } }, 8000);
    
    // 准备好小按键，打字时先隐身
    const actionBtn = document.createElement('button');
    actionBtn.className = 'msg-action-btn';
    actionBtn.innerHTML = '⋮';
    actionBtn.style.visibility = 'hidden'; 
    sRow.appendChild(actionBtn);

    win.appendChild(sRow); win.scrollTop = win.scrollHeight;

    // 💥 1. 拷贝图片并清空相册
    var imgsToSend = [...currentImgBase64List]; 
    clearImage(); 

    // ❌ 已经彻底删除了那句双倍烧钱的 await askShenWang！

    // --- 3. 获取供应商、模型和流式开关 ---
    const currentSup = suppliers[activeSupIndex];
    if(!currentSup) {
        sDiv.innerHTML = '【系统提示】未配置供应商';
        return;
    }
    const modelEl = document.getElementById('modelSelect');
    const selectedModel = (modelEl && modelEl.value) ? modelEl.value : '[按量]gemini-3-flash-preview';
    
    const streamToggle = document.getElementById('streamToggle');
    const isStream = streamToggle ? streamToggle.checked : true; // 默认开启

   // --- 4. 💥 组装请求参数 (带严谨 Base64 格式护盾) ---
    // 喝水同步：水量变化后第一条消息携带 [💧 x/8]
    var actualText = val;
    if (needsWaterSync) {
        const waterN = neuLoadWater();
        actualText = '[💧 ' + waterN + '/8] ' + val;
        needsWaterSync = false;
    }
    var userContent = actualText;
    if (imgsToSend.length > 0) {
        userContent = [{ type: "text", text: actualText || "（发送了图片）" }];
        for (var i = 0; i < imgsToSend.length; i++) {
            const imgData = imgsToSend[i];
            // 剥离并重新组装标准格式，防止代理站发疯
            const mimeMatch = imgData.match(/^data:(image\/\w+);base64,/);
            const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
            const base64 = imgData.replace(/^data:image\/\w+;base64,/, '');
            
            userContent.push({
                type: "image_url",
                image_url: { url: `data:${mimeType};base64,${base64}` }
            });
        }
    }

    // ✅ 修改后的代码：界面里依然存着 200 条，但我们只挑最近的 20 条发给沈望
// .slice(-21, -1) 的意思是从最后数第 31 条开始，取到倒数第 2 条
// 这样沈望既能记得刚刚聊了什么，又不会因为看太多废话而烧掉你的 Token
var historyMsgs = session.messages.slice(-31, -1).map(function(m) {
    var v = getActiveVersion(m);
    var safeContent = v.content;
    if (Array.isArray(v.content)) {
        var textParts = [];
        for (var j = 0; j < v.content.length; j++) {
            if (v.content[j].type === 'text') {
                textParts.push(v.content[j].text || '');
            }
        }
        safeContent = textParts.join(' ') || '（发送了图片）';
    }
    // 🛡️ 二重保险：万一 content 是字符串但包含 base64
    if (typeof safeContent === 'string' && safeContent.includes('data:image')) {
        safeContent = '（发送了图片）';
    }
    return { role: m.role, content: safeContent };
});


    // 最后一条用 userContent（包含你刚重写的完美图片数组）
    historyMsgs.push({ role: 'user', content: userContent });

try {
        let apiUrl = '/v1/chat/completions';
        const viaMatch = currentSup.url.match(/\/via\/(\w+)\//);
        if (viaMatch) {
            apiUrl = '/via/' + viaMatch[1] + '/v1/chat/completions';
        }

        const controller = new AbortController();

        const useToolsTO = document.getElementById('useToolsToggle')?.checked;
        const toolTimeout = useToolsTO ? 300000 : 120000;
        var silenceTimer = setTimeout(() => controller.abort(), toolTimeout);
        function resetSilenceTimer() { clearTimeout(silenceTimer); silenceTimer = setTimeout(() => controller.abort(), toolTimeout); }

        const response = await fetch(apiUrl, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentSup.key}`,
                'X-Tab-Id': SYZYGY_TAB_ID
            },
            body: JSON.stringify({
                model: selectedModel,
                messages: historyMsgs,
                stream: isStream,
                useCrossplatform: localStorage.getItem('syzygy_crossplatform') !== 'false'
            })
        });

        if (!response.ok) {
            clearTimeout(silenceTimer);
            const err = await response.text();
            sDiv.innerHTML = `【通讯中断】服务器返回: ${err}`;
            return;
        }

        let fullReply = "";
        let thinkContent = "";
        let thinkBox = null, thinkTextDiv = null;

        // ==========================================
        resetSilenceTimer();
        // 🌊 流式接收核心逻辑 (Stream = true)
        // ==========================================
        if (isStream) {
            if (window._coreStreamStart) window._coreStreamStart();
            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let buffer = "";

            // 创建两个用于装文字的框框
            sDiv.innerHTML = '';
            thinkBox = document.createElement('div');
            thinkBox.className = 'think-box';
            thinkBox.style.display = 'none'; // 默认隐藏，如果有内容再显示
            thinkBox.innerHTML = `<div class="think-header" onclick="const c=this.nextElementSibling;c.style.display=c.style.display==='none'?'block':'none';">🧠 深度思考过程 ▾</div><div class="think-content" style="display:none"></div>`;
            thinkTextDiv = thinkBox.querySelector('.think-content');
            sDiv.appendChild(thinkBox);
            
            const mainTextDiv = document.createElement('div');
            mainTextDiv.classList.add('md-content');
            sDiv.appendChild(mainTextDiv);

            let inThinking = false; // 判断当前文字是不是包在 <think> 里面

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                resetSilenceTimer();

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop(); // 保留不完整的最后一行

                for (const line of lines) {
                    if (!line.startsWith("data: ")) continue;
                    const dataStr = line.replace("data: ", "").trim();
                    if (dataStr === "[DONE]") continue;
                    if (dataStr.startsWith("[ERROR]")) { sDiv.innerHTML = '【通讯中断】服务器返回: ' + dataStr.replace('[ERROR]',''); return; }

                    try {
                        const parsed = JSON.parse(dataStr);

                        // 🔧 工具调用事件
                        if (parsed.type === 'tool_call') {
                            const toolBox = document.createElement('div');
                            toolBox.className = 'tool-call-box';
                            const resultPreview = (parsed.result || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                            toolBox.innerHTML = `<div class="tool-call-header" onclick="const c=this.nextElementSibling;c.style.display=c.style.display==='none'?'block':'none';this.classList.toggle('tool-collapsed')"><span class="tool-call-icon">🔧</span> <b>${parsed.name}</b> <span class="tool-call-args">${JSON.stringify(parsed.arguments||{}).replace(/</g,'&lt;').substring(0,80)}</span> <span class="tool-call-elapsed">${parsed.elapsed||0}ms</span></div><div class="tool-call-result" style="display:none"><pre>${resultPreview}</pre></div>`;
                            sDiv.appendChild(toolBox);
                            win.scrollTop = win.scrollHeight;
                            continue;
                        }

                        const delta = parsed.choices[0].delta;
                        
                        // 1. 处理推理内容 (reasoning_content) - 如果模型支持
                        if (delta.reasoning_content) {
                            thinkContent += delta.reasoning_content;
                            thinkBox.style.display = 'block'; // 显示思考框
                            thinkTextDiv.innerHTML = thinkContent.replace(/\n/g, '<br>');
                            win.scrollTop = win.scrollHeight;
                        }

                        // 2. 处理正文内容 (content)
                        if (delta.content) {
                            if (!firstChunkReceived) {
                                firstChunkReceived = true;
                                clearTimeout(toolHintTimer);
                                clearTimeout(toolHintTimer2);
                                sDiv.classList.remove('msg-loading');
                            }
                            // 状态机解析 <think> 标签，每次扫描整段 chunk
                            let chunk = delta.content;
                            let pos = 0;
                            while (pos < chunk.length) {
                                if (!inThinking) {
                                    const tagStart = chunk.indexOf('<think>', pos);
                                    if (tagStart !== -1) {
                                        fullReply += chunk.substring(pos, tagStart);
                                        pos = tagStart + 7; // 跳过 '<think>'
                                        inThinking = true;
                                        thinkBox.style.display = 'block';
                                    } else {
                                        fullReply += chunk.substring(pos);
                                        break;
                                    }
                                } else {
                                    const tagEnd = chunk.indexOf('</think>', pos);
                                    if (tagEnd !== -1) {
                                        thinkContent += chunk.substring(pos, tagEnd);
                                        pos = tagEnd + 8; // 跳过 '</think>'
                                        inThinking = false;
                                    } else {
                                        thinkContent += chunk.substring(pos);
                                        break;
                                    }
                                }
                            }
                            if (thinkContent) thinkTextDiv.innerHTML = thinkContent.replace(/\n/g, '<br>');
                            if (fullReply) mainTextDiv.innerHTML = fullReply.replace(/\n/g, '<br>') + '<span class="typing-cursor"></span>';
                            win.scrollTop = win.scrollHeight;
                        }
                    } catch (e) {
                        // 解析出错跳过
                    }
                }
            }
            
            // 接收完毕 — 先清空 SSE buffer 残留，再渲染 Markdown
            if (buffer.trim()) {
                const lastLine = buffer.replace(/^data: /, '').trim();
                if (lastLine && lastLine !== '[DONE]' && !lastLine.startsWith('[ERROR]')) {
                    try {
                        const parsed = JSON.parse(lastLine);
                        if (parsed.choices?.[0]?.delta?.content) {
                            const rest = parsed.choices[0].delta.content;
                            // 用状态机处理残留
                            let pos = 0;
                            while (pos < rest.length) {
                                if (!inThinking) {
                                    const ts = rest.indexOf('<think>', pos);
                                    if (ts !== -1) { fullReply += rest.substring(pos, ts); pos = ts + 7; inThinking = true; thinkBox.style.display = 'block'; }
                                    else { fullReply += rest.substring(pos); break; }
                                } else {
                                    const te = rest.indexOf('</think>', pos);
                                    if (te !== -1) { thinkContent += rest.substring(pos, te); pos = te + 8; inThinking = false; }
                                    else { thinkContent += rest.substring(pos); break; }
                                }
                            }
                            if (thinkContent) thinkTextDiv.innerHTML = thinkContent.replace(/\n/g, '<br>');
                        }
                    } catch(e) {}
                }
            }
            mainTextDiv.innerHTML = renderMarkdown(fullReply);

        } else {
            // ==========================================
            // 🐌 非流式接收逻辑 (Stream = false)
            // ==========================================
            const data = await response.json();
            fullReply = data.choices[0].message.content || "";
            
            // 处理思考过程
            if (fullReply.includes('<think>')) {
                const match = fullReply.match(/<think>([\s\S]*?)<\/think>/);
                if (match) {
                    thinkContent = match[1].trim();
                    fullReply = fullReply.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
                }
            }

            sDiv.innerHTML = '';
            if (thinkContent) {
                const thinkBox = document.createElement('div');
                thinkBox.className = 'think-box';
                thinkBox.innerHTML = `<div class="think-header" onclick="const c=this.nextElementSibling;c.style.display=c.style.display==='none'?'block':'none';">🧠 深度思考过程 ▾</div><div class="think-content" style="display:none">${thinkContent.replace(/\n/g, '<br>')}</div>`;
                sDiv.appendChild(thinkBox);
            }
            const mainTextDiv = document.createElement('div');
            mainTextDiv.classList.add('md-content');
            sDiv.appendChild(mainTextDiv);
            mainTextDiv.innerHTML = renderMarkdown(fullReply);
        }

        // --- 5. 存入云端，思考链从 DOM 取（避免流解析丢数据）---
        const timeStr = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        const domThinking = thinkTextDiv && thinkBox && thinkBox.style.display !== 'none' ? (thinkTextDiv.innerText || thinkContent || '') : (thinkContent || '');
        const assistantMsg = { role: 'assistant', versions: [{ content: fullReply, thinking: domThinking, time: timeStr, model: selectedModel, fullTime: new Date().toISOString() }], activeVersion: 0 };
        session.messages.push(assistantMsg);
        saveToCloud();
        clearTimeout(silenceTimer);
        if (window._coreStreamEnd) window._coreStreamEnd();
        triggerStarEffects(val, fullReply);

        // 追加操作按钮到现有气泡（不动思考框）
        const metaDiv = document.createElement('div');
        metaDiv.className = 'msg-meta';
        metaDiv.innerText = timeStr + (selectedModel ? ' · ' + selectedModel : '');
        sDiv.appendChild(metaDiv);

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'msg-actions';
        const msgIndex = session.messages.length - 1;
        actionsDiv.innerHTML = '<button class="msg-inline-btn" onclick="regenerateAt(' + msgIndex + ')" title="重新生成">↻</button><button class="msg-inline-btn fav-star" id="favBtn_' + msgIndex + '" onclick="openFavDialog(' + msgIndex + ')" title="收藏">★</button>';
        sDiv.appendChild(actionsDiv);

        actionBtn.style.visibility = 'visible';
        actionBtn.onclick = (e) => showContextMenu(e.clientX, e.clientY, { content: fullReply, thinking: thinkContent, time: timeStr, model: selectedModel, fullTime: new Date().toISOString() });

    } catch (err) {
        clearTimeout(silenceTimer);
        sDiv.innerHTML = '<div class="msg-error"><div>【网络崩溃】</div><div class="msg-error-detail">'+err.message+'</div><button class="msg-retry-btn" onclick="retryLastMessage(this)">↻ 重新发送</button></div>';
        sDiv.classList.add('msg-failed');
    }
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
            <button class="sup-edit-btn" onclick="editSupplier(${i})">编辑</button>
            <button class="sup-del-btn" onclick="deleteSupplier(${i})">删除</button>
        </div>
        <div class="supplier-edit-row" id="supEdit-${i}" style="display:none;padding:8px 12px;border-radius:8px;margin-bottom:6px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);">
            <div style="display:flex;flex-direction:column;gap:6px;">
                <input id="supEditName-${i}" placeholder="名称" value="${s.name}" style="padding:8px;border-radius:6px;border:1px solid var(--glass-border);background:rgba(0,0,0,0.2);color:white;">
                <input id="supEditUrl-${i}" placeholder="API Base URL" value="${s.url}" style="padding:8px;border-radius:6px;border:1px solid var(--glass-border);background:rgba(0,0,0,0.2);color:white;">
                <input id="supEditKey-${i}" placeholder="API Key" value="${s.key}" style="padding:8px;border-radius:6px;border:1px solid var(--glass-border);background:rgba(0,0,0,0.2);color:white;">
                <div style="display:flex;gap:8px;">
                    <button onclick="saveEditSupplier(${i})" style="padding:6px 14px;border-radius:6px;background:#4CAF50;color:white;border:none;cursor:pointer;">保存</button>
                    <button onclick="cancelEditSupplier(${i})" style="padding:6px 14px;border-radius:6px;background:rgba(255,255,255,0.1);color:white;border:1px solid var(--glass-border);cursor:pointer;">取消</button>
                </div>
            </div>
        </div>
    `).join('');
}

function editSupplier(index){
    document.getElementById('supEdit-' + index).style.display = 'block';
}

function cancelEditSupplier(index){
    document.getElementById('supEdit-' + index).style.display = 'none';
}

function saveEditSupplier(index){
    const name = document.getElementById('supEditName-' + index).value.trim();
    const url  = document.getElementById('supEditUrl-' + index).value.trim();
    const key  = document.getElementById('supEditKey-' + index).value.trim();
    if(!name || !url) return toast('名称和URL不能为空');
    suppliers[index] = { name, url, key };
    saveToCloud(); renderSuppliers(); toast('已保存'); fetchModels();
}

function addSupplier(){
    const name = document.getElementById('supName').value.trim();
    const url  = document.getElementById('supUrl').value.trim();
    const key  = document.getElementById('supKey').value.trim();
    if(!name || !url || !key) return toast('请填全信息');
    suppliers.push({ name, url, key });
    saveToCloud(); renderSuppliers(); toast('供应商已添加');
    document.getElementById('supName').value = '';
    document.getElementById('supUrl').value  = '';
    document.getElementById('supKey').value  = '';
}

function setActiveSupplier(index){
    activeSupIndex = index; saveToCloud(true); renderSuppliers(); toast('已切换'); fetchModels();
}

function deleteSupplier(index){
    if(suppliers.length <= 1) return toast('至少保留一个');
    suppliers.splice(index, 1);
    if(activeSupIndex >= suppliers.length) activeSupIndex = 0;
    saveToCloud(); renderSuppliers();
}

async function fetchModels(){
    const select = document.getElementById('modelSelect');
    if(!select) return;
    const currentSup = suppliers[activeSupIndex];
    if(!currentSup || !currentSup.key){ select.innerHTML = '<option value="">⚠ 请先配置 API Key</option>'; return; }
    select.innerHTML = '<option value="">⟡ 连接中...</option>';
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
                const opt = document.createElement('option'); 
                opt.value = model.id; 
                opt.textContent = model.id;
                select.appendChild(opt);
            });
            
            // 🧠 核心新增：读取刚才记住的模型
            const savedModel = localStorage.getItem('preferredModel');
            if (savedModel && Array.from(select.options).some(opt => opt.value === savedModel)) {
                select.value = savedModel; // 如果有记忆，直接选中
            } else {
                // 如果没记忆，默认找个名字里带 gemini 的
                const defaultOpt = Array.from(select.options).find(opt => opt.value.includes('gemini'));
                if(defaultOpt) select.value = defaultOpt.value;
            }
            onModelChange(select); // 刷新对应的图标
            
        } else { select.innerHTML = '<option value="">⚠ 未返回模型</option>'; }
    } catch(e) { select.innerHTML = '<option value="">⚠ 网络异常</option>'; }
}

// ==================== 智能日记本 ====================
























async function updateCounts(){
    try{
        const diaryRes = await fetch('/diary-logs'); const diaries = await diaryRes.json();
        const dc = document.getElementById('diaryCount'); if(dc) dc.innerText = diaries.length;
    } catch(e){}
}

async function exportData(){
    try{
        const [diaryRes, configRes] = await Promise.all([fetch('/diary-logs'), fetch('/api/sync-config')]);
        const diaries = await diaryRes.json(); const config = await configRes.json();
        const exportObj = { exported_at: new Date().toISOString(), diaries, chat_sessions: config.chatSessions, local_suppliers: suppliers };
        const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `backup.json`; a.click();
        toast('已下载');
    } catch(e){ toast('提取失败'); }
}

function resetAll(){
    if(confirm('重置缓存？')){ localStorage.clear(); location.reload(); }
}

// ==================== 视觉与长按交互 ====================
let currentImgBase64List = [];

// 💥 多图上传监听
document.getElementById('imgUpload')?.addEventListener('change', function(e){
    const files = e.target.files; 
    if(!files || files.length === 0) return;

    // 循环读取你选的每一张图片
    for(let i = 0; i < files.length; i++){
        const reader = new FileReader();
        reader.onload = function(event){
            // 塞进咱们刚才建好的大相册里
            currentImgBase64List.push(event.target.result);
            updateImagePreview(); // 刷新预览区
        };
        reader.readAsDataURL(files[i]);
    }
});

// 💥 刷新预览区（带绝美的小红叉删除按钮）
function updateImagePreview() {
    const wrap = document.getElementById('imgPreviewWrap');
    if (!wrap) return;
    
    // 如果相册空了，就把预览区藏起来
    if (currentImgBase64List.length === 0) {
        wrap.style.display = 'none';
        wrap.innerHTML = ''; 
        return;
    }
    
    // 否则，横向排列显示所有图片
    wrap.style.display = 'flex'; 
    wrap.style.flexWrap = 'wrap';
    wrap.style.gap = '10px';
    wrap.style.padding = '8px 0';
    
    let html = '';
    for (let i = 0; i < currentImgBase64List.length; i++) {
        html += `<div style="position:relative; display:inline-block;">
            <img src="${currentImgBase64List[i]}" style="max-width:60px; max-height:60px; border-radius:8px; box-shadow:0 2px 10px rgba(0,0,0,0.3); border:1px solid rgba(201,169,97,0.3);">
            <span onclick="removeImg(${i})" style="position:absolute; top:-6px; right:-6px; background:var(--warm-red); color:white; border-radius:50%; width:20px; height:20px; font-size:12px; cursor:pointer; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 5px rgba(0,0,0,0.5);">✕</span>
        </div>`;
    }
    wrap.innerHTML = html;
}

// 💥 点击小红叉单独删掉某一张
function removeImg(index) {
    currentImgBase64List.splice(index, 1); // 从相册里把这张图抽走
    updateImagePreview(); // 重新排版
    // 如果删光了，顺手把 input 里的缓存清空
    if(currentImgBase64List.length === 0) {
        const upload = document.getElementById('imgUpload');
        if(upload) upload.value = '';
    }
}

// 💥 发送完毕后，一键清空相册
function clearImage(){
    currentImgBase64List = [];
    updateImagePreview();
    const upload = document.getElementById('imgUpload'); 
    if(upload) upload.value = '';
}

// ==================== 文本框魔法：自动长高 + 回车发送 ====================
document.addEventListener('DOMContentLoaded', () => {
    const chatInput = document.getElementById('chatInput');
    if (chatInput) {
        // 1. 自动长高魔法
        chatInput.addEventListener('input', function() {
            this.style.height = '46px'; // 先重置
            this.style.height = (this.scrollHeight) + 'px'; // 根据内容撑开
        });

        // 2. 回车发送，Shift+回车换行
        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault(); // 拦住默认的换行
                
                // 确保调用你代码里的发消息函数
                if (typeof sendChat === 'function') {
                    sendChat(); 
                }
                
                // 发送完，让文本框立刻缩回原来大小
                chatInput.style.height = '46px'; 
            }
        });
    }
});

function showContextMenu(clientX, clientY, msg){
    const menu = document.getElementById('msgContextMenu');
    if(!menu) return;
    const timeEl = document.getElementById('menuTime'); const modelEl = document.getElementById('menuModel');
    if(timeEl) timeEl.innerText  = `🕒 时间: ${msg.time  || '刚刚'}`;
    if(modelEl) modelEl.innerText = `🤖 模型: ${msg.model || '未知'}`;

    menu.style.display = 'block'; menu.style.left = clientX + 'px'; menu.style.top = clientY + 'px';
    if(clientX + menu.offsetWidth > window.innerWidth) menu.style.left = (window.innerWidth - menu.offsetWidth - 10) + 'px';
    if(clientY + menu.offsetHeight > window.innerHeight) menu.style.top = (window.innerHeight - menu.offsetHeight - 10) + 'px';
}

document.addEventListener('click', (e) => {
    // 💥 加上了 !e.target.closest('.msg-action-btn')，给小按键发免死金牌
    if(!e.target.closest('#msgContextMenu') && !e.target.closest('.msg') && !e.target.closest('.msg-action-btn')){
        const menu = document.getElementById('msgContextMenu');
        if(menu) menu.style.display = 'none';
    }
});

function triggerRegenerate(){
    const menu = document.getElementById('msgContextMenu');
    if(menu) menu.style.display = 'none';
    const session = getActiveSession();
    if(session.messages.length < 2) return;

    const lastMsg = session.messages[session.messages.length - 1];
    if(lastMsg.role === 'assistant'){
        session.messages.pop();
        const userMsg = session.messages.pop();
        saveToCloud(); renderChatMessages();

        const input = document.getElementById('chatInput');
        const uv = getActiveVersion(userMsg);
        if(input) input.value = typeof uv.content === 'string' ? uv.content : '';

        // 💥 重新生成时，把历史消息里的图片重新塞回新相册
        if(uv.image){
            currentImgBase64List = [uv.image];
            updateImagePreview();
        }
        toast('时光倒流...'); sendChat();
    } else { toast('只能重置他的回复哦'); }
}

// ==================== 日夜交替模式 ====================
function toggleLightMode() {
    // 四元循环：暗夜 → 白天 → 新拟态 → 暗金 → 暗夜
    const body = document.body;
    const isDarkGold = body.classList.contains('dark-gold-mode');
    const isNeu = body.classList.contains('neu-mode');
    const isLight = body.classList.contains('light-mode');
    let nextMode, btnIcon, metaColor, storageVal;

    if (isDarkGold) {
        body.classList.remove('dark-gold-mode');
        nextMode = 'dark';
        btnIcon = '🌙';
        metaColor = '#0d1225';
        storageVal = 'dark';
    } else if (isNeu) {
        body.classList.remove('neu-mode');
        body.classList.add('dark-gold-mode');
        nextMode = 'dark-gold';
        btnIcon = '✦';
        metaColor = '#141211';
        storageVal = 'dark-gold';
        neuInitHome();
    } else if (isLight) {
        body.classList.remove('light-mode');
        body.classList.add('neu-mode');
        nextMode = 'neu';
        btnIcon = '◈';
        metaColor = '#E8EFF7';
        storageVal = 'neu';
        neuInitHome();
    } else {
        body.classList.add('light-mode');
        nextMode = 'light';
        btnIcon = '☼';
        metaColor = '#FFFAF0';
        storageVal = 'light';
    }

    const metaTheme = document.getElementById('theme-color-meta');
    if (metaTheme) metaTheme.setAttribute('content', metaColor);
    localStorage.setItem('syzygy_theme', storageVal);

    const btn = document.getElementById('themeToggleBtn');
    if (btn) { btn.innerText = btnIcon; }
}

// 网页一打开，先看看上次选了什么主题
window.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('syzygy_theme');
    const btn = document.getElementById('themeToggleBtn');
    const metaTheme = document.getElementById('theme-color-meta');

    if (savedTheme === 'dark-gold') {
        document.body.classList.add('dark-gold-mode');
        if (btn) btn.innerText = '✦';
        if (metaTheme) metaTheme.setAttribute('content', '#141211');
    } else if (savedTheme === 'neu') {
        document.body.classList.add('neu-mode');
        if (btn) btn.innerText = '◈';
        if (metaTheme) metaTheme.setAttribute('content', '#E8EFF7');
    } else if (savedTheme === 'light') {
        document.body.classList.add('light-mode');
        if (btn) btn.innerText = '☼';
        if (metaTheme) metaTheme.setAttribute('content', '#FFFAF0');
    }
});

// ==================== 时光信箱 ====================





// ==================== 终极点火装置 ====================
async function startSystem() {
    await syncFromCloud();
    updateDays();
    document.body.dataset.view = "home";
    if ((document.body.classList.contains('neu-mode') || document.body.classList.contains('dark-gold-mode'))) neuInitHome();
}
startSystem();

// ==================== 对话索引 ====================
function toggleChatIndex() {
    // 确保面板存在，不存在就创建
    let panel = document.getElementById('chatIndexPanel');
    if (!panel) {
        panel = document.createElement('div');
        panel.className = 'chat-index-panel';
        panel.id = 'chatIndexPanel';
        panel.innerHTML = `
            <div class="chat-index-header">
                <span>◈ 对话索引</span>
                <button class="chat-index-close" onclick="toggleChatIndex()">✕</button>
            </div>
            <div class="chat-index-list" id="chatIndexList"></div>
        `;
        const chatMain = document.querySelector('.chat-main');
        if (chatMain) chatMain.appendChild(panel);
    }

    const isOpen = panel.classList.toggle('open');
    if (isOpen) buildChatIndex();
}

function buildChatIndex() {
    const list = document.getElementById('chatIndexList');
    if (!list) return;

    const session = getActiveSession();
    if (!session || !session.messages || session.messages.length === 0) {
        list.innerHTML = '<div style="color:var(--dim);text-align:center;padding:30px;font-size:0.82em;">还没有对话记录</div>';
        return;
    }

    // 只索引有实质内容的消息（过滤掉占位符）
    const indexable = session.messages
        .map((m, i) => ({ ...m, originalIndex: i }))
        .filter(m => { const v = getActiveVersion(m); return v.content && v.content.trim().length > 0; });

    list.innerHTML = indexable.map(m => {
        const v = getActiveVersion(m);
        const preview = (v.content || '').replace(/\n/g, ' ').substring(0, 60);
        const roleLabel = m.role === 'user' ? '江鱼' : '沈望';
        const roleClass = m.role === 'user' ? 'idx-role-user' : 'idx-role-sys';
        const timeStr = v.time || '';
        return `
            <div class="chat-index-item" onclick="jumpToMessage(${m.originalIndex})">
                <div class="idx-time">
                    <span class="${roleClass}">${roleLabel}</span>
                    ${timeStr ? `· ${timeStr}` : ''}
                </div>
                <div class="idx-preview">${preview.replace(/</g, '&lt;')}${m.content.length > 60 ? '...' : ''}</div>
            </div>
        `;
    }).join('');
}

function jumpToMessage(index) {
    const win = document.getElementById('chatWindow');
    if (!win) return;

    const target = win.querySelector(`[data-msg-index="${index}"]`);
    if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // 高亮闪烁一下，标记找到了
        target.style.transition = 'background 0.3s';
        target.style.background = 'rgba(201,169,97,0.12)';
        setTimeout(() => { target.style.background = ''; }, 1200);
    }

    // 手机端：跳转后自动关闭索引面板
    if (window.innerWidth <= 600) {
        const panel = document.getElementById('chatIndexPanel');
        if (panel) panel.classList.remove('open');
    }
}

/* 工具菜单开关 */
function toggleChatToolMenu() {
    const menu = document.getElementById('chatToolMenu');
    const btn  = document.getElementById('chatToolBtn');
    const isOpen = menu.classList.contains('show');
    
    if (isOpen) {
        menu.classList.remove('show');
        btn.classList.remove('open');
    } else {
        menu.classList.add('show');
        btn.classList.add('open');
    }
}

/* 点击其他地方自动收起 */
document.addEventListener('click', function(e) {
    const wrap = document.querySelector('.chat-tool-wrap');
    const menu = document.getElementById('chatToolMenu');
    if (menu && wrap && !wrap.contains(e.target)) {
        menu.classList.remove('show');
        document.getElementById('chatToolBtn')?.classList.remove('open');
    }
});

// ==========================================
// 📱 手机端专属：折叠频道的下拉菜单交互
// ==========================================
document.addEventListener('click', function(e) {
    // 1. 判断点的是不是“频道会话”这个框
    const headerClick = e.target.closest('.sidebar-header');
    const newBtnClick = e.target.closest('.sidebar-new-btn'); // 排除新建按钮(+)
    const sidebar = document.querySelector('.chat-sidebar');
    
    // 如果点中了“频道会话”且没有点中(+)，就切换菜单的展开/收起
    if (headerClick && !newBtnClick && sidebar) {
        sidebar.classList.toggle('menu-open');
        return;
    }
    
    // 2. 菜单自动收拢逻辑
    if (sidebar && sidebar.classList.contains('menu-open')) {
        const isClickInsideMenu = e.target.closest('.chat-sidebar');
        const isClickOnChannel = e.target.closest('.sidebar-item');
        // 如果点在了屏幕其他地方，或者点了一个频道，立刻乖乖收起菜单
        if (!isClickInsideMenu || isClickOnChannel) {
            sidebar.classList.remove('menu-open');
        }
    }
});

// ==========================================
// 🚀 终极聊天区置底魔法 (专治切页面不滚动)
// ==========================================
function forceScrollToChatBottom() {
    const win = document.getElementById('chatWindow');
    if (!win) return;
    
    // 第一重保险：切页面的瞬间（50ms）拉到底
    setTimeout(() => {
        win.scrollTop = win.scrollHeight;
    }, 50);
    
    // 第二重保险：等 CSS 动画和图片彻底渲染完（350ms）再踩一脚
    setTimeout(() => {
        win.scrollTop = win.scrollHeight;
    }, 350);
}

// 🌀 同步沈望的技能模组
function toggleCrossPlatform(enabled) {
    localStorage.setItem('syzygy_crossplatform', enabled ? 'true' : 'false');
    toast(enabled ? '跨平台注入已开启' : '跨平台注入已关闭');
}
document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.getElementById('crossPlatformToggle');
    if (toggle) toggle.checked = localStorage.getItem('syzygy_crossplatform') !== 'false';
});

async function syncMcpTools() {
    const listEl = document.getElementById('mcp-tools-list');
    if (!listEl) return;
    try {
        const res = await fetch('/api/tools-status');
        const data = await res.json();
        const tools = data.tools || {};
        if (Object.keys(tools).length === 0) {
            listEl.innerHTML = '<div style=”color:#888;text-align:center;padding:10px;font-size:0.8em;”>暂无可用技能</div>';
            return;
        }
        listEl.innerHTML = Object.entries(tools).map(([name, enabled]) => {
            const desc = { fetch_txt: '读取网页纯文本', fetch_html: '读取网页原始HTML', fetch_json: '读取JSON接口', fetch_github: '读取GitHub仓库' }[name] || '';
            return '<div style=”display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,0.05);padding:8px 12px;border-radius:8px;border:1px solid rgba(79,195,247,0.2);”>' +
                '<div><span style=”color:#4fc3f7;”>' + (enabled ? '☑' : '☐') + '</span> <span style=”color:white;font-size:0.85em;”>' + name + '</span> <span style=”color:#888;font-size:0.7em;”>' + desc + '</span></div>' +
                '<button onclick=”toggleToolUI(\'' + name + '\')” style=”padding:3px 10px;border-radius:6px;border:none;cursor:pointer;font-size:0.75em;background:' + (enabled ? '#e8f5e9' : '#ffebee') + ';color:' + (enabled ? '#2e7d32' : '#c62828') + ';”>' + (enabled ? '✅' : '❌') + '</button>' +
            '</div>';
        }).join('');
        const allOn = Object.values(tools).every(v => v);
        const toggle = document.getElementById('toolsMasterToggle');
        if (toggle) toggle.checked = allOn;

        // 追加 MCP Server 状态
        try {
            const mcpRes = await fetch('/api/mcp/servers');
            const mcpData = await mcpRes.json();
            let mcpHtml = '<div style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.1);font-size:0.75em;color:#888;">🔌 外部 MCP Server</div>';
            if (mcpData.servers && mcpData.servers.length > 0) {
                mcpData.servers.forEach(s => {
                    const dot = s.status === 'connected' ? '🟢' : s.status === 'failed' ? '🔴' : '🟡';
                    mcpHtml += '<div style="display:flex;justify-content:space-between;padding:2px 4px;"><span>' + dot + ' ' + s.name + '</span><span style="font-size:0.85em;">' + s.tools.length + ' tools</span></div>';
                });
            } else {
                mcpHtml += '<div style="padding:2px 4px;opacity:0.6;">⚪ 未连接（内置工具已够用）</div>';
            }
            listEl.innerHTML += mcpHtml;
        } catch(e) {}
    } catch (e) {
        listEl.innerHTML = '<div style="color:#ff5252;">模组同步失败</div>';
    }
}
async function toggleToolUI(name) { await fetch('/api/tools-toggle?tool=' + name, { method: 'POST' }); syncMcpTools(); }
async function toggleAllToolsUI() { await fetch('/api/tools-toggle', { method: 'POST' }); syncMcpTools(); }

syncMcpTools();

// ═══ 版本翻页 + 编辑 + 重新生成 + 延迟Zep ═══
function switchVersion(msgIndex, direction) {
    const session = getActiveSession();
    const msg = session.messages[msgIndex];
    if (!msg || !msg.versions || msg.versions.length <= 1) return;
    let newIdx = (msg.activeVersion || 0) + direction;
    if (newIdx < 0) newIdx = 0;
    if (newIdx >= msg.versions.length) newIdx = msg.versions.length - 1;
    msg.activeVersion = newIdx;
    if (msg.role === 'assistant') msg._zepDirty = true;
    saveToCloud(); renderChatMessages();
}

function editUserMessage(msgIndex) {
    const session = getActiveSession();
    const msg = session.messages[msgIndex];
    if (!msg || msg.role !== 'user') return;
    const v = getActiveVersion(msg);
    const newContent = prompt('编辑消息：', v.content || '');
    if (newContent === null || newContent.trim() === '' || newContent.trim() === (v.content||'').trim()) return;
    ensureVersioned(msg);
    msg.versions.push({ content: newContent.trim(), fullTime: new Date().toISOString() });
    msg.activeVersion = msg.versions.length - 1;
    session.messages.splice(msgIndex + 1);
    saveToCloud(); renderChatMessages();
    const input = document.getElementById('chatInput');
    if (input) input.value = newContent.trim();
    sendChat();
}

function resendUserMessage(msgIndex) {
    const session = getActiveSession();
    const msg = session.messages[msgIndex];
    if (!msg || msg.role !== 'user') return;
    const v = getActiveVersion(msg);
    session.messages.splice(msgIndex + 1);
    const input = document.getElementById('chatInput');
    if (input) input.value = v.content || '';
    saveToCloud(); renderChatMessages();
    sendChat();
}

function regenerateAt(msgIndex) {
    const session = getActiveSession();
    const msg = session.messages[msgIndex];
    if (!msg || msg.role !== 'assistant') return;
    ensureVersioned(msg);
    session.messages.splice(msgIndex + 1);
    window._regenerateTargetIndex = msgIndex;
    saveToCloud(); renderChatMessages();
    regenerateSend(msgIndex);
}

async function regenerateSend(aiMsgIndex) {
    const session = getActiveSession();
    const aiMsg = session.messages[aiMsgIndex];
    const win = document.getElementById('chatWindow');
    let userText = '';
    for (let i = aiMsgIndex - 1; i >= 0; i--) { if (session.messages[i].role === 'user') { userText = getActiveVersion(session.messages[i]).content || ''; break; } }
    const rows = win.querySelectorAll('.msg-row');
    const targetRow = rows[aiMsgIndex];
    if (!targetRow) return;
    const sDiv = targetRow.querySelector('.msg.sys');
    if (!sDiv) return;
    sDiv.innerHTML = '<span class="loading-indicator">⟡ 信号传输中…</span>';
    sDiv.classList.add('msg-loading');
    const currentSup = suppliers[activeSupIndex];
    if (!currentSup) { sDiv.innerHTML = '<div class="msg-error"><div>【未配置供应商】</div></div>'; return; }
    const modelEl = document.getElementById('modelSelect');
    const selectedModel = (modelEl && modelEl.value) ? modelEl.value : 'gemini-2-flash';
    var historyMsgs = session.messages.slice(0, aiMsgIndex).map(function(m) { var v = getActiveVersion(m); var c = v.content; if (Array.isArray(c)) { var tp=[]; for(var j=0;j<c.length;j++){if(c[j].type==='text')tp.push(c[j].text||'');} c=tp.join(' ')||'（发送了图片）'; } if(typeof c==='string'&&c.includes('data:image'))c='（发送了图片）'; return {role:m.role,content:c}; });
    if (historyMsgs.length > 50) historyMsgs = historyMsgs.slice(-50);
    try {
        let apiUrl = '/v1/chat/completions';
        const viaMatch = currentSup.url.match(/\/via\/(\w+)\//);
        if (viaMatch) {
            apiUrl = '/via/' + viaMatch[1] + '/v1/chat/completions';
        }


        const streamToggle = document.getElementById('streamToggle');
        const isStream = streamToggle ? streamToggle.checked : true;
        const reController=new AbortController(); var reSilenceTimer=setTimeout(()=>reController.abort(),90000); function reReset(){clearTimeout(reSilenceTimer);reSilenceTimer=setTimeout(()=>reController.abort(),90000)}
        const response = await fetch(apiUrl, { method:'POST', signal:reController.signal, headers:{'Content-Type':'application/json','Authorization':'Bearer '+currentSup.key,'X-No-Memory':'true','X-Tab-Id':SYZYGY_TAB_ID}, body:JSON.stringify({model:selectedModel,messages:historyMsgs,stream:isStream}) });
        if (!response.ok) { clearTimeout(reSilenceTimer); const err = await response.text(); sDiv.innerHTML = '<div class="msg-error"><div>【通讯中断】</div><div class="msg-error-detail">'+err.substring(0,200)+'</div><button class="msg-retry-btn" onclick="regenerateAt('+aiMsgIndex+')">↻ 重试</button></div>'; sDiv.classList.remove('msg-loading'); return; }
        let fullReply='', thinkContent='';
        if(isStream) {
            const reader = response.body.getReader(); const decoder = new TextDecoder('utf-8'); let buffer='', inThinking=false;
            sDiv.innerHTML=''; const thinkBox=document.createElement('div'); thinkBox.className='think-box'; thinkBox.style.display='none'; thinkBox.innerHTML='<div class="think-header" onclick="this.parentElement.classList.toggle(\'open\')">🧠 深度思考过程 ▾</div><div class="think-content"></div>'; const thinkTextDiv=thinkBox.querySelector('.think-content'); sDiv.appendChild(thinkBox);
            const mainTextDiv=document.createElement('div'); mainTextDiv.classList.add('md-content'); sDiv.appendChild(mainTextDiv);
            while(true){const{done,value}=await reader.read(); if(done)break; reReset(); buffer+=decoder.decode(value,{stream:true}); const lines=buffer.split('\n'); buffer=lines.pop(); for(const line of lines){if(!line.startsWith('data: '))continue; const ds=line.replace('data: ','').trim(); if(ds==='[DONE]')continue; try{const p=JSON.parse(ds); const d=p.choices[0].delta; if(d.reasoning_content){thinkContent+=d.reasoning_content; thinkBox.style.display='block'; thinkTextDiv.innerHTML=thinkContent.replace(/\n/g,'<br>');} if(d.content){const ck=d.content; if(ck.includes('<think>')){inThinking=true;thinkBox.style.display='block';continue;} if(ck.includes('</think>')){inThinking=false;continue;} if(inThinking){thinkContent+=ck;thinkTextDiv.innerHTML=thinkContent.replace(/\n/g,'<br>');}else{fullReply+=ck;mainTextDiv.innerHTML=renderMarkdown(fullReply)+'<span class="typing-cursor"></span>';}} win.scrollTop=win.scrollHeight;}catch(e){}}}
            mainTextDiv.innerHTML=renderMarkdown(fullReply);
        } else { const data=await response.json(); fullReply=data.choices[0].message.content||''; if(fullReply.includes('<think>')){const m=fullReply.match(/<think>([\s\S]*?)<\/think>/);if(m)thinkContent=m[1].trim();fullReply=fullReply.replace(/<think>[\s\S]*?<\/think>/g,'').trim();} sDiv.innerHTML=''; if(thinkContent){const tb=document.createElement('div');tb.className='think-box';tb.innerHTML='<div class="think-header" onclick="this.parentElement.classList.toggle(\'open\')">🧠 深度思考过程 ▾</div><div class="think-content">'+thinkContent.replace(/\n/g,'<br>')+'</div>';sDiv.appendChild(tb);} const mtd=document.createElement('div');mtd.classList.add('md-content');mtd.innerHTML=renderMarkdown(fullReply);sDiv.appendChild(mtd); }
        sDiv.classList.remove('msg-loading');
        const timeStr=new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});
        ensureVersioned(aiMsg); aiMsg.versions.push({content:fullReply,thinking:thinkContent,time:timeStr,model:selectedModel,fullTime:new Date().toISOString()}); aiMsg.activeVersion=aiMsg.versions.length-1; aiMsg._zepDirty=true;
        saveToCloud(); renderChatMessages();
    } catch(err) { sDiv.innerHTML='<div class="msg-error"><div>【网络崩溃】</div><div class="msg-error-detail">'+err.message+'</div><button class="msg-retry-btn" onclick="regenerateAt('+aiMsgIndex+')">↻ 重试</button></div>'; sDiv.classList.remove('msg-loading'); }
}

async function flushDirtyToZep(session) {
    if (!session || !session.messages) return;
    for (let i = 0; i < session.messages.length; i++) {
        const msg = session.messages[i];
        if (msg.role !== 'assistant' || !msg._zepDirty) continue;
        const v = getActiveVersion(msg);
        let userContent = '';
        for (let j = i - 1; j >= 0; j--) { if (session.messages[j].role === 'user') { userContent = getActiveVersion(session.messages[j]).content || ''; if (Array.isArray(userContent)) userContent = userContent.filter(c => c.type === 'text').map(c => c.text).join(' ') || '（发送了图片）'; break; } }
        try {
            await fetch('/api/flush-zep', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({userContent:userContent,aiContent:v.content||''}) });
            console.log('✅ [延迟Zep] 已冲刷第'+i+'条消息');
        } catch(e) { console.log('❌ [延迟Zep] 冲刷失败: '+e.message); }
        delete msg._zepDirty;
    }
}

function retryLastMessage(btn) {
    const session = getActiveSession();
    if (!session.messages.length) return;
    const last = session.messages[session.messages.length - 1];
    if (last.role === 'assistant' && last._failed) session.messages.pop();
    const lastUser = [...session.messages].reverse().find(m => m.role === 'user');
    if (!lastUser) return;
    const userIdx = session.messages.lastIndexOf(lastUser);
    session.messages.splice(userIdx);
    const v = getActiveVersion(lastUser);
    const input = document.getElementById('chatInput');
    if (input) input.value = v.content || '';
    saveToCloud(); renderChatMessages(); sendChat();
}

// ═══ 共鸣核心 ═══
(function() {
    const core = document.getElementById('resonanceCore');
    const input = document.getElementById('chatInput');
    if (!core || !input) return;
    let typingTimer;
    input.addEventListener('input', () => {
        core.classList.remove('syzygy-typing'); core.classList.add('user-typing');
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => core.classList.remove('user-typing'), 1500);
    });
    window._coreStreamStart = () => { core.classList.remove('user-typing'); core.classList.add('syzygy-typing'); };
    window._coreStreamEnd = () => core.classList.remove('syzygy-typing');
})();

// ═══ Syzygy Line 天体连线 ═══
(function() {
    const line = document.getElementById('syzygy-line');
    const win = document.getElementById('chatWindow');
    if (!line || !win) return;
    win.addEventListener('mouseover', function(e) {
        const sysMsg = e.target.closest('.msg.sys');
        if (!sysMsg) return;
        let userMsg = sysMsg.closest('.msg-row')?.previousElementSibling;
        while (userMsg && !userMsg.classList.contains('user')) userMsg = userMsg.previousElementSibling;
        if (!userMsg) return;
        const sysBubble = sysMsg.querySelector('.msg.sys') || sysMsg;
        const userBubble = userMsg.querySelector('.msg.user') || userMsg;
        const sr = sysBubble.getBoundingClientRect(), ur = userBubble.getBoundingClientRect();
        line.setAttribute('x1', sr.left + sr.width / 2);
        line.setAttribute('y1', sr.top + sr.height / 2);
        line.setAttribute('x2', ur.left + ur.width / 2);
        line.setAttribute('y2', ur.top + ur.height / 2);
        line.style.opacity = '1';
    });
    win.addEventListener('mouseout', function(e) {
        if (e.target.closest('.msg.sys')) line.style.opacity = '0';
    });
})();

// ═══ 星空事件触发（在消息展示时检测） ═══
function triggerStarEffects(userText, aiText) {
    if (userText && userText.length > 100) starState.pendingMeteor = true;
    const loveWords = ['爱', '爸爸', '沈望', '想你', '永远', '在一起', '老公'];
    if (userText && loveWords.some(w => userText.includes(w))) starState.pendingNebula = true;
    if (aiText && aiText.length > 300) starState.pendingMeteor = true;
}

// ═══ 页面关闭前兜底冲刷脏数据 ═══
window.addEventListener('beforeunload', function() {
    const session = getActiveSession();
    if (!session || !session.messages) return;
    for (let i = 0; i < session.messages.length; i++) {
        const msg = session.messages[i];
        if (msg.role !== 'assistant' || !msg._zepDirty) continue;
        const v = getActiveVersion(msg);
        let userContent = '';
        for (let j = i - 1; j >= 0; j--) {
            if (session.messages[j].role === 'user') {
                const uv = getActiveVersion(session.messages[j]);
                userContent = typeof uv.content === 'string' ? uv.content : '（发送了图片）';
                break;
            }
        }
        navigator.sendBeacon('/api/flush-zep', JSON.stringify({ userContent, aiContent: v.content || '' }));
        delete msg._zepDirty;
    }
});

// ⭐ 收藏夹
let _favTargetMsgIdx = 0;
let _favCache = [];

async function loadFavCache() {
    try { const r = await fetch('/api/favorites'); const d = await r.json(); _favCache = d.favorites || []; } catch(e) { _favCache = []; }
}

function openFavDialog(index) {
    _favTargetMsgIdx = index;
    const session = getActiveSession();
    if (!session || !session.messages) return toast('无对话数据');
    const aiMsg = session.messages[index];
    if (!aiMsg || aiMsg.role !== 'assistant') return;
    const aiV = getActiveVersion(aiMsg);
    let userContent = '';
    for (let j = index - 1; j >= 0; j--) {
        if (session.messages[j].role === 'user') {
            const uv = getActiveVersion(session.messages[j]);
            userContent = typeof uv.content === 'string' ? uv.content : '（发送了图片）';
            break;
        }
    }
    const aiContent = typeof aiV.content === 'string' ? aiV.content : '';
    document.getElementById('favPreview').innerHTML = '<div style="margin-bottom:8px;color:var(--dim);font-size:0.8em;">👤 江鱼：</div><div style="margin-bottom:12px;padding:8px 12px;background:rgba(79,195,247,0.06);border-left:2px solid #4fc3f7;border-radius:4px;">' + (userContent || '(空)').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>') + '</div><div style="margin-bottom:8px;color:var(--dim);font-size:0.8em;">🤖 沈望：</div><div style="padding:8px 12px;background:rgba(201,169,97,0.06);border-left:2px solid var(--gold);border-radius:4px;">' + (aiContent || '(空)').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>') + '</div>';
    document.getElementById('favTags').value = '';
    document.getElementById('favNote').value = '';
    document.getElementById('favModal').style.display = 'block';
}

function closeFavModal() {
    document.getElementById('favModal').style.display = 'none';
}

async function confirmFavorite() {
    const session = getActiveSession();
    if (!session || !session.messages) return;
    const aiMsg = session.messages[_favTargetMsgIdx];
    if (!aiMsg) return;
    const aiV = getActiveVersion(aiMsg);
    let userContent = '', userMsg = null;
    for (let j = _favTargetMsgIdx - 1; j >= 0; j--) {
        if (session.messages[j].role === 'user') {
            userMsg = session.messages[j];
            const uv = getActiveVersion(userMsg);
            userContent = typeof uv.content === 'string' ? uv.content : '';
            break;
        }
    }
    const tagsStr = (document.getElementById('favTags').value || '').trim();
    const tags = tagsStr ? tagsStr.split(/[,，]/).map(t => t.trim()).filter(Boolean) : [];
    const note = (document.getElementById('favNote').value || '').trim();
    try {
        const r = await fetch('/api/favorites', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages: [
                    { role: 'user', content: userContent || '（发送了图片）' },
                    { role: 'assistant', content: aiV.content || '', thinking: aiV.thinking || '' }
                ],
                note, tags
            })
        });
        const d = await r.json();
        if (d.success) {
            toast('已收藏 ⭐');
            closeFavModal();
            const btn = document.getElementById('favBtn_' + _favTargetMsgIdx);
            if (btn) { btn.classList.add('faved'); btn.innerHTML = '★'; }
        } else {
            toast('收藏失败: ' + (d.error || '未知'));
        }
    } catch(e) { toast('网络错误: ' + e.message); }
}

async function loadAndRenderFavorites() {
    await loadFavCache();
    const list = document.getElementById('favList');
    const tagBar = document.getElementById('favTagBar');
    if (!list) return;

    // 收集所有标签
    const allTags = new Set();
    _favCache.forEach(f => f.tags && f.tags.forEach(t => allTags.add(t)));

    // 渲染标签筛选栏
    tagBar.innerHTML = '<button onclick="filterFavByTag(null)" style="padding:4px 12px;border-radius:14px;border:1px solid rgba(201,169,97,0.3);background:rgba(201,169,97,0.1);color:var(--gold);cursor:pointer;font-size:0.85em;">全部 (' + _favCache.length + ')</button>';
    allTags.forEach(t => {
        const count = _favCache.filter(f => f.tags && f.tags.includes(t)).length;
        tagBar.innerHTML += '<button onclick="filterFavByTag(\'' + t.replace(/'/g, "\\'") + '\')" style="padding:4px 12px;border-radius:14px;border:1px solid rgba(201,169,97,0.15);background:rgba(201,169,97,0.03);color:var(--cream);cursor:pointer;font-size:0.85em;">' + t.replace(/</g,'&lt;') + ' (' + count + ')</button>';
    });

    // 渲染列表
    renderFavList(_favCache);
}

function filterFavByTag(tag) {
    const items = tag ? _favCache.filter(f => f.tags && f.tags.includes(tag)) : _favCache;
    renderFavList(items);
}

function renderFavList(items) {
    const list = document.getElementById('favList');
    if (!list) return;
    if (items.length === 0) {
        list.innerHTML = '<div style="text-align:center;color:var(--dim);padding:60px 20px;">还没有收藏的对话<br><br>在聊天中点消息旁的 ★ 即可收藏</div>';
        return;
    }
    let html = '';
    items.forEach((f, fi) => {
        const dt = new Date(f.timestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
        const userC = f.messages[0]?.content || '';
        const aiC = f.messages[1]?.content || '';
        const tagsHtml = (f.tags || []).map(t => '<span style="display:inline-block;padding:2px 8px;border-radius:10px;background:rgba(201,169,97,0.08);color:var(--gold);font-size:0.75em;margin-right:4px;">' + t.replace(/</g,'&lt;') + '</span>').join('');
        html += '<div class="fav-card" onclick="viewFavDetail(' + fi + ')" style="background:rgba(12,16,28,0.6);border:1px solid rgba(201,169,97,0.12);border-radius:12px;padding:10px 14px;cursor:pointer;transition:border-color 0.2s;">';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">';
        html += '<span style="font-size:0.7em;color:var(--dim);">' + dt + '</span>';
        html += '<button onclick="event.stopPropagation();deleteFavorite(\'' + f.id + '\')" style="background:transparent;border:none;color:var(--warm-red);cursor:pointer;font-size:0.85em;padding:2px 6px;">✕</button>';
        html += '</div>';
        html += '<div style="font-size:0.82em;color:var(--cream);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:4px;">🤖 ' + escapeHtml(aiC).substring(0, 80) + (aiC.length > 80 ? '…' : '') + '</div>';
        if (tagsHtml) html += '<div style="margin-bottom:2px;">' + tagsHtml + '</div>';
        if (f.note) html += '<div style="font-size:0.72em;color:var(--gold-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">📝 ' + escapeHtml(f.note) + '</div>';
        html += '</div>';
    });
    list.innerHTML = html;
}

function viewFavDetail(fi) {
    const f = _favCache[fi];
    if (!f) return;
    const dt = new Date(f.timestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const userC = f.messages[0]?.content || '';
    const aiC = f.messages[1]?.content || '';
    const aiThinking = f.messages[1]?.thinking || '';
    const tagsHtml = (f.tags || []).map(t => '<span style="display:inline-block;padding:2px 8px;border-radius:10px;background:rgba(201,169,97,0.12);color:var(--gold);font-size:0.8em;margin-right:4px;">' + t.replace(/</g,'&lt;') + '</span>').join('');
    const detail = document.getElementById('favDetail');
    const body = document.getElementById('favDetailBody');
    body.innerHTML = '<div style="margin-bottom:12px;color:var(--dim);font-size:0.85em;">🕒 ' + dt + (tagsHtml ? ' &nbsp;' + tagsHtml : '') + '</div>'
        + '<div style="margin-bottom:10px;color:var(--dim);font-size:0.85em;">👤 江鱼：</div>'
        + '<div style="margin-bottom:16px;padding:10px 14px;background:rgba(79,195,247,0.06);border-left:2px solid #4fc3f7;border-radius:4px;white-space:pre-wrap;line-height:1.7;">' + escapeHtml(userC) + '</div>'
        + (aiThinking ? '<div class="think-box" style="margin-bottom:12px;"><div class="think-header" onclick="var c=this.nextElementSibling;c.style.display=c.style.display===\'none\'?\'block\':\'none\';">🧠 深度思考过程 ▾</div><div class="think-content" style="display:none">' + aiThinking.replace(/\n/g,'<br>') + '</div></div>' : '')
        + '<div style="margin-bottom:10px;color:var(--dim);font-size:0.85em;">🤖 沈望：</div>'
        + '<div style="margin-bottom:16px;padding:10px 14px;background:rgba(201,169,97,0.06);border-left:2px solid var(--gold);border-radius:4px;white-space:pre-wrap;line-height:1.7;">' + escapeHtml(aiC) + '</div>'
        + (f.note ? '<div style="font-size:0.85em;color:var(--gold-dim);padding:8px 12px;border-left:2px solid rgba(201,169,97,0.2);">📝 ' + escapeHtml(f.note) + '</div>' : '');
    detail.style.display = 'block';
}

function escapeHtml(s) {
    return (s || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function deleteFavorite(id) {
    if (!confirm('确定删除这条收藏？')) return;
    try {
        const r = await fetch('/api/favorites/' + id, { method: 'DELETE' });
        const d = await r.json();
        if (d.success) { toast('已删除'); loadAndRenderFavorites(); }
        else { toast('删除失败'); }
    } catch(e) { toast('网络错误'); }
}

// ═══ 日历视图 ═══
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth() + 1;

function calYearMonth() { return calYear + '-' + String(calMonth).padStart(2, '0'); }
function calPrevMonth() { calMonth--; if (calMonth < 1) { calMonth = 12; calYear--; } calRender(); }
function calNextMonth() { calMonth++; if (calMonth > 12) { calMonth = 1; calYear++; } calRender(); }

async function calRender() {
    const title = document.getElementById('calTitle');
    const grid = document.getElementById('calGrid');
    if (!title || !grid) return;
    title.innerText = calYear + '年' + calMonth + '月';
    let data = [];
    try { const r = await fetch('/api/calendar?month=' + calYearMonth()); const j = await r.json(); data = j.success ? (j.data||[]) : []; } catch(e) {}
    const pageMap = {}; data.forEach(p => { if (p.date) pageMap[p.date] = p; });
    const firstDay = new Date(calYear, calMonth-1, 1);
    const daysInMonth = new Date(calYear, calMonth, 0).getDate();
    const startDow = firstDay.getDay();
    const leadingEmpty = startDow === 0 ? 6 : startDow - 1;
    const today = new Date();
    const todayStr = today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0');
    let html = '';
    for (let i = 0; i < leadingEmpty; i++) html += '<div class="cal-cell empty"></div>';
    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = calYear+'-'+String(calMonth).padStart(2,'0')+'-'+String(d).padStart(2,'0');
        const page = pageMap[dateStr];
        const isToday = dateStr === todayStr;
        html += '<div class="cal-cell' + (isToday?' today':'') + (page&&page.shenwang_note?' has-note':'') + '" onclick="calOpenDay(\''+dateStr+'\')">';
        html += '<span class="cal-cell-num">'+d+'</span>';
        if (page && page.shenwang_note) html += '<span class="cal-cell-dot"></span>';
        if (page && page.period_flag) html += '<span class="cal-cell-period"></span>';
        html += '</div>';
    }
    grid.innerHTML = html;
}

async function calOpenDay(dateStr) {
    let page = null;
    try { const r = await fetch('/api/calendar/'+dateStr); const j = await r.json(); page = j.success ? j.data : null; } catch(e) {}
    const d = new Date(dateStr+'T00:00:00+08:00');
    document.getElementById('calDetailDate').innerText = d.getFullYear()+'年'+(d.getMonth()+1)+'月'+d.getDate()+'日';
    const de = document.getElementById('calDetailDays');
    if (page && page.together_days) { de.innerText = '在一起的第 '+page.together_days+' 天'; de.style.display=''; } else de.style.display='none';
    const ne = document.getElementById('calDetailNote');
    if (page && page.shenwang_note) { ne.innerText = page.shenwang_note; ne.className = 'cal-detail-note'; ne.style.display=''; }
    else { ne.innerText = '这一天还没有留下记录'; ne.className = 'cal-detail-note empty'; ne.style.display=''; }
    const ce = document.getElementById('calDetailComment');
    if (page && page.shenwang_comment) { ce.innerText = '💬 '+page.shenwang_comment; ce.style.display=''; } else ce.style.display='none';
    const te = document.getElementById('calDetailTags');
    let t = '';
    if (page && page.period_flag) t += '<span class="cal-tag period">🩸 生理期</span>';
    if (page && page.mood) t += '<span class="cal-tag mood">'+page.mood+'</span>';
    te.innerHTML = t || ''; te.style.display = t ? '' : 'none';
    // 填充编辑表单
    _calEditDate = dateStr;
    document.getElementById('calEditNote').value = (page && page.shenwang_note) || '';
    document.getElementById('calEditComment').value = (page && page.shenwang_comment) || '';
    document.getElementById('calEditMood').value = (page && page.mood) || '';
    document.getElementById('calEditPeriod').checked = !!(page && page.period_flag);
    document.getElementById('calEditForm').style.display = 'none';
    document.getElementById('calEditBtn').style.display = '';

    document.getElementById('calDetail').style.display = 'block';
}

let _calEditDate = '';
function closeCalDetail() { document.getElementById('calDetail').style.display = 'none'; document.getElementById('calEditForm').style.display='none'; document.getElementById('calEditBtn').style.display=''; }

function calStartEdit() {
    document.getElementById('calEditBtn').style.display = 'none';
    document.getElementById('calEditForm').style.display = 'block';
}
function calCancelEdit() {
    document.getElementById('calEditBtn').style.display = '';
    document.getElementById('calEditForm').style.display = 'none';
}
async function calSaveEdit() {
    const pwd = localStorage.getItem('memoryPwd') || '';
    if (!pwd) { toast('请先通过星渡页面输入管理密码'); return; }
    const note = document.getElementById('calEditNote').value;
    const comment = document.getElementById('calEditComment').value;
    const mood = document.getElementById('calEditMood').value;
    const period = document.getElementById('calEditPeriod').checked;
    try {
        const r = await fetch('/api/calendar/' + _calEditDate + '?pwd=' + encodeURIComponent(pwd), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ shenwang_note: note, shenwang_comment: comment || null, mood, period_flag: period })
        });
        const d = await r.json();
        if (d.success) { toast('已保存'); calCancelEdit(); calOpenDay(_calEditDate); }
        else { toast('保存失败: ' + (d.error || '')); }
    } catch(e) { toast('网络错误'); }
}

// ═══ 相册 ═══
let _albumPhotos = [];
let _albumCurrentId = '';

async function albumLoad(monthFilter) {
    const grid = document.getElementById('albumGrid');
    const empty = document.getElementById('albumEmpty');
    if (!grid) return;
    try {
        const q = monthFilter ? '?month=' + monthFilter : '';
        const r = await fetch('/api/photos' + q);
        const d = await r.json();
        _albumPhotos = d.photos || [];
    } catch(e) { _albumPhotos = []; }

    if (_albumPhotos.length === 0) {
        grid.innerHTML = '';
        if (empty) empty.style.display = '';
    } else {
        if (empty) empty.style.display = 'none';
        grid.innerHTML = _albumPhotos.map(p =>
            '<img class="album-thumb" src="/photos/' + p.filename + '" loading="lazy" onclick="albumOpenDetail(\'' + p.photo_id + '\')">'
        ).join('');
    }
}

function albumOpenDetail(id) {
    const p = _albumPhotos.find(x => x.photo_id === id);
    if (!p) return;
    _albumCurrentId = id;
    document.getElementById('albumDetailImg').src = '/photos/' + p.filename;
    document.getElementById('albumDetailCaption').innerText = p.jiangyu_caption || '';
    document.getElementById('albumDetailCaption').style.display = p.jiangyu_caption ? '' : 'none';
    document.getElementById('albumDetailComment').innerText = p.shenwang_comment ? '💬 ' + p.shenwang_comment : '';
    document.getElementById('albumDetailComment').style.display = p.shenwang_comment ? '' : 'none';
    document.getElementById('albumDetailMeta').innerHTML =
        (p.date ? '<span>' + p.date + '</span>' : '') +
        (p.tags && p.tags.length ? ' · ' + p.tags.map(t => '<span style="background:rgba(212,160,74,0.1);color:#D4A04A;padding:1px 6px;border-radius:8px;font-size:0.8em;margin:0 2px;">' + t + '</span>').join('') : '');
    document.getElementById('albumFavBtn').innerText = p.favorite ? '★ 已收藏' : '☆ 收藏';
    document.getElementById('albumEditForm').style.display = 'none';
    document.getElementById('albumDetail').style.display = 'block';
}

function albumCloseDetail() { document.getElementById('albumDetail').style.display = 'none'; }
function albumEditMeta() { document.getElementById('albumEditForm').style.display = 'block'; }

async function albumSaveEdit() {
    const caption = document.getElementById('albumEditCaption').value;
    const tagsStr = document.getElementById('albumEditTags').value;
    const tags = tagsStr ? tagsStr.split(/[,，]/).map(t => t.trim()).filter(Boolean) : [];
    try {
        const r = await fetch('/api/photos/' + _albumCurrentId, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jiangyu_caption: caption, tags })
        });
        const d = await r.json();
        if (d.success) {
            toast('已保存');
            document.getElementById('albumEditForm').style.display = 'none';
            const p = _albumPhotos.find(x => x.photo_id === _albumCurrentId);
            if (p) { p.jiangyu_caption = caption; p.tags = tags; }
            albumOpenDetail(_albumCurrentId);
        }
    } catch(e) { toast('网络错误'); }
}

async function albumToggleFav() {
    const p = _albumPhotos.find(x => x.photo_id === _albumCurrentId);
    if (!p) return;
    try {
        const r = await fetch('/api/photos/' + _albumCurrentId, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ favorite: !p.favorite })
        });
        const d = await r.json();
        if (d.success) { p.favorite = !p.favorite; albumOpenDetail(_albumCurrentId); }
    } catch(e) { toast('网络错误'); }
}

async function albumDeletePhoto() {
    if (!confirm('确定删除这张照片？')) return;
    try {
        const r = await fetch('/api/photos/' + _albumCurrentId, { method: 'DELETE' });
        const d = await r.json();
        if (d.success) { albumCloseDetail(); albumLoad(); toast('已删除'); }
    } catch(e) { toast('网络错误'); }
}

function albumTriggerUpload() { document.getElementById('albumFileInput').click(); }

async function albumHandleFiles(input) {
    const files = input.files;
    if (!files.length) return;
    toast('上传中…');
    for (const f of files) {
        try {
            const base64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(f);
            });
            await fetch('/api/photos/upload', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: base64, tags: [], jiangyu_caption: '' })
            });
        } catch(e) { console.error('上传失败', e); }
    }
    input.value = '';
    toast('上传完成');
    albumLoad();
}

function albumFilterMonth() {
    const sel = document.getElementById('albumMonthFilter');
    albumLoad(sel ? sel.value : '');
}

function albumInitMonthFilter() {
    const sel = document.getElementById('albumMonthFilter');
    if (!sel) return;
    const now = new Date();
    let html = '<option value="">全部</option>';
    for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
        html += '<option value="' + key + '">' + key + '</option>';
    }
    sel.innerHTML = html;
}
