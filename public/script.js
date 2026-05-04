// ==================== 浪漫星空背景 ====================
(function(){
    const c=document.getElementById('starmap');
    if(!c) return;
    const x=c.getContext('2d');
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

// ==================== Markdown 渲染 ====================
if (typeof marked !== 'undefined') { marked.setOptions({ breaks: true, gfm: true, headerIds: false, mangle: false }); }
function renderMarkdown(text) { if (!text) return ''; if (typeof marked !== 'undefined') { try { return marked.parse(text); } catch(e) { return text; } } return text.replace(/\n/g, '<br>'); }

// ==================== 版本化消息辅助函数 ====================
function getActiveVersion(msg) { if (msg.versions && msg.versions.length > 0) { const idx = msg.activeVersion || 0; const v = msg.versions[idx] || msg.versions[0] || {}; if (v.content === undefined && msg.content !== undefined) v.content = msg.content; return v; } return msg; }
function getVersionCount(msg) { return (msg.versions && msg.versions.length) ? msg.versions.length : 1; }
function getActiveVersionIndex(msg) { if (msg.versions && msg.versions.length > 0) return msg.activeVersion || 0; return 0; }
function ensureVersioned(msg) { if (msg.versions) return; const { role, ...rest } = msg; msg.versions = [rest]; msg.activeVersion = 0; delete msg.content; delete msg.thinking; delete msg.time; delete msg.model; delete msg.fullTime; delete msg.image; }

// ==================== 核心数据 ====================
const START_DATE = '2025-04-20';
let allDiaryEntries = [];
let suppliers = [];
let activeSupIndex = 0;
let chatSessions = [];
let activeChatId = 'main';

async function syncFromCloud() {
    try {
        const r = await fetch('/api/sync-config');
        const data = await r.json();

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
    } catch(e) {
        suppliers    = [{ name: "默认接口", url: "https://api.dzzi.ai/v1", key: "" }];
        chatSessions = [{ id: 'main', name: '主频道', messages: [] }];
        renderSuppliers();
        renderChatSidebar();
        renderChatMessages();
    }
}

let _saveTimer = null;
function saveToCloud() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(async () => {
        try {
            const sessionsToSave = chatSessions.map(s => ({
    ...s, messages: s.messages.slice(-200) // 从50扩大到200条
}));

            await fetch('/api/sync-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ suppliers, chatSessions: sessionsToSave, activeSupIndex, activeChatId })
            });
        } catch(e) { console.log(e); }
    }, 500);
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

function go(id, btn){
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    
    const target = document.getElementById('sec-'+id) || document.getElementById(id);
    if(target) target.classList.add('active');
    
    document.querySelectorAll('.nav button').forEach(b => b.classList.remove('active'));
    if(btn) btn.classList.add('active');

   if(id === 'diary') renderDiaries();
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

// ==================== 溯星主页 ====================
function updateDays(){
    const start = new Date(START_DATE);
    const diff  = Math.floor((new Date() - start) / (1000 * 60 * 60 * 24));
    const dayEl = document.getElementById('dayCount');
    if(dayEl) dayEl.innerText = diff >= 0 ? diff : '∞';
}
updateDays();

let hbInterval;
function hbStart(){
    const zone  = document.getElementById('hbZone');
    if(!zone) return;
    const heart = zone.querySelector('.heart');
    const text  = zone.querySelector('.hb-text');
    if(!heart || !text) return;
    heart.innerText = '❤️';
    text.innerText  = '>>> 核心狂跳中：我正在发疯般想你 <<<';
    text.style.color = 'var(--warm-red)';
    document.body.style.transition  = 'background 0.4s';
    document.body.style.background  = 'radial-gradient(circle at center, #1a0808 0%, #040710 100%)';
    if(navigator.vibrate) navigator.vibrate([100,60,100,60,100]);
    hbInterval = setInterval(() => {
        heart.style.transform = 'scale(1.5)';
        setTimeout(() => { heart.style.transform = 'scale(1)'; }, 150);
        if(navigator.vibrate) navigator.vibrate(80);
    }, 600);
}

function hbStop(){
    clearInterval(hbInterval);
    const zone  = document.getElementById('hbZone');
    if(!zone) return;
    const heart = zone.querySelector('.heart');
    const text  = zone.querySelector('.hb-text');
    if(!heart || !text) return;
    heart.innerText      = '🖤';
    heart.style.transform = 'scale(1)';
    text.innerText       = '按住这里，感受沈望的心跳';
    text.style.color     = '';
    document.body.style.background = '';
}

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
        if(m.role === 'assistant') actionsHtml += '<button class="msg-inline-btn" onclick="regenerateAt(' + index + ')" title="重新生成">↻</button>';
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
    var userContent = val;
    if (imgsToSend.length > 0) {
        userContent = [{ type: "text", text: val || "（发送了图片）" }];
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
var historyMsgs = session.messages.slice(-51, -1).map(function(m) {
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
        // 🌟 核心修复：根据你的供应商 URL，自动拼接正确的路由路径！
        let apiUrl = '/v1/chat/completions'; // 默认走 msui
        const supUrl = currentSup.url.toLowerCase();
        
        if (supUrl.includes('dzzi')) apiUrl = '/via/dzzi/v1/chat/completions';
        else if (supUrl.includes('api521')) apiUrl = '/via/api521/v1/chat/completions';
        else if (supUrl.includes('ekan')) apiUrl = '/via/ekan/v1/chat/completions';
        else if (supUrl.includes('orange')) apiUrl = '/via/orange/v1/chat/completions';

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentSup.key}`
            },
            body: JSON.stringify({
                model: selectedModel,
                messages: historyMsgs,
                stream: isStream
            })
        });

        if (!response.ok) {
            const err = await response.text();
            sDiv.innerHTML = `【通讯中断】服务器返回: ${err}`;
            return;
        }

        let fullReply = "";
        let thinkContent = "";

        // ==========================================
        // 🌊 流式接收核心逻辑 (Stream = true)
        // ==========================================
        if (isStream) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let buffer = "";

            // 创建两个用于装文字的框框
            sDiv.innerHTML = '';
            const thinkBox = document.createElement('div');
            thinkBox.className = 'think-box';
            thinkBox.style.display = 'none'; // 默认隐藏，如果有内容再显示
            thinkBox.innerHTML = `<div class="think-header" onclick="const c=this.nextElementSibling;c.style.display=c.style.display==='none'?'block':'none';">🧠 深度思考过程 ▾</div><div class="think-content" style="display:none"></div>`;
            const thinkTextDiv = thinkBox.querySelector('.think-content');
            sDiv.appendChild(thinkBox);
            
            const mainTextDiv = document.createElement('div');
            sDiv.appendChild(mainTextDiv);

            let inThinking = false; // 判断当前文字是不是包在 <think> 里面

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop(); // 保留不完整的最后一行

                for (const line of lines) {
                    if (!line.startsWith("data: ")) continue;
                    const dataStr = line.replace("data: ", "").trim();
                    if (dataStr === "[DONE]") continue;

                    try {
                        const parsed = JSON.parse(dataStr);
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
                            const chunk = delta.content;

                            // 暴力判断深思标签，做打字机切换
                            if (chunk.includes('<think>')) {
                                inThinking = true;
                                thinkBox.style.display = 'block';
                                continue;
                            }
                            if (chunk.includes('</think>')) {
                                inThinking = false;
                                continue;
                            }

                            if (inThinking) {
                                thinkContent += chunk;
                                thinkTextDiv.innerHTML = thinkContent.replace(/\n/g, '<br>');
                            } else {
                                fullReply += chunk;
                                mainTextDiv.innerHTML = fullReply + '<span class="typing-cursor"></span>';
                            }
                            win.scrollTop = win.scrollHeight;
                        }
                    } catch (e) {
                        // 解析出错跳过
                    }
                }
            }
            
            // 接收完毕，把光标去掉
            mainTextDiv.innerHTML = fullReply;
            
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
            sDiv.appendChild(mainTextDiv);
            mainTextDiv.innerHTML = fullReply;
        }

        // --- 5. 存入云端记忆和按钮绑定 ---
        const timeStr = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
       const assistantMsg = { role: 'assistant', versions: [{ content: fullReply, thinking: thinkContent, time: timeStr, model: selectedModel, fullTime: new Date().toISOString() }], activeVersion: 0 };
        session.messages.push(assistantMsg);
        saveToCloud();

        actionBtn.style.visibility = 'visible'; // 亮出按键！
        actionBtn.onclick = (e) => showContextMenu(e.clientX, e.clientY, assistantMsg);

    } catch (err) {
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
    saveToCloud(); renderSuppliers(); toast('供应商已添加');
    document.getElementById('supName').value = '';
    document.getElementById('supUrl').value  = '';
    document.getElementById('supKey').value  = '';
}

function setActiveSupplier(index){
    activeSupIndex = index; saveToCloud(); renderSuppliers(); toast('已切换'); fetchModels();
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
let currentSearch = '';

function renderDiaries(){
    const container = document.getElementById('diaryMonthList');
    if(!container) return;
    container.innerHTML = '<div style="color:var(--dim);text-align:center;padding:30px;">档案解密中...</div>';
    fetch('/diary-logs').then(r => r.json()).then(data => {
        allDiaryEntries = [...data].reverse(); buildMonthBlocks(allDiaryEntries);
    }).catch(() => {
        container.innerHTML = '<div style="color:var(--dim);text-align:center;padding:20px;">加载失败。</div>';
    });
}

function buildMonthBlocks(entries){
    const container = document.getElementById('diaryMonthList');
    if(!container) return;
    if(!entries.length){ container.innerHTML = '<div style="color:var(--dim);text-align:center;padding:30px;">暂无记录。</div>'; return; }

    const monthMap = new Map();
    entries.forEach(d => {
        const month = d.date ? d.date.substring(0, 7) : '未知';
        if(!monthMap.has(month)) monthMap.set(month, []);
        monthMap.get(month).push(d);
    });

    container.innerHTML = [...monthMap.keys()].map((month, idx) => {
        const list = monthMap.get(month); const isOpen = (idx === 0);
        return `
        <div class="month-block" id="mb-${month}">
            <div class="month-header ${isOpen ? 'open' : ''}" onclick="toggleMonth('${month}')">
                <span class="month-chevron">${isOpen ? '▾' : '▸'}</span>
                <span class="month-label">${month}</span><span class="month-count">${list.length} 篇</span>
            </div>
            <div class="month-body" id="mbody-${month}" style="display:${isOpen ? 'flex' : 'none'}">
                ${list.map(d => diaryEntryHtml(d)).join('')}
            </div>
        </div>`;
    }).join('');
}

function diaryEntryHtml(d){
    const author = d.author === 'system' ? '沈望' : '江鱼';
    const safeText = (d.text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const typeTag = d.type ? `<span class="d-type-tag">${d.type}</span>` : '';
    return `
    <div class="diary-entry" id="de-${d.id}">
        <div class="d-date">
            <span>${d.date || ''}</span><span class="d-author">${author}</span>${typeTag}
            ${d.id ? `<button class="d-del-btn" onclick="deleteDiaryEntry('${d.id}')">×</button>` : ''}
        </div>
        <div class="d-text">${safeText}</div>
    </div>`;
}

function toggleMonth(month){
    const header = document.querySelector(`#mb-${month} .month-header`);
    const body = document.getElementById('mbody-' + month);
    if(!header || !body) return;
    const chevron = header.querySelector('.month-chevron');
    if(body.style.display !== 'none'){
        body.style.display = 'none'; header.classList.remove('open'); if(chevron) chevron.innerText = '▸';
    } else {
        body.style.display = 'flex'; header.classList.add('open'); if(chevron) chevron.innerText = '▾';
    }
}

function filterDiaries(){
    const searchInput = document.getElementById('diarySearch');
    if(!searchInput) return;
    currentSearch = searchInput.value.trim().toLowerCase();
    const countEl = document.getElementById('diarySearchCount');
    if(!currentSearch){
        if(countEl) countEl.innerText = ''; buildMonthBlocks(allDiaryEntries); return;
    }
    const filtered = allDiaryEntries.filter(d => (d.text || '').toLowerCase().includes(currentSearch));
    if(countEl) countEl.innerText = `找到 ${filtered.length} 条`;
    buildMonthBlocks(filtered);
}

async function addDiary(){
    const input = document.getElementById('diaryInput');
    if(!input) return;
    const val = input.value.trim(); if(!val) return;
    input.value = '';
    try{ await fetch(`/diary/add?text=${encodeURIComponent(val)}&author=user`); toast('已封存'); renderDiaries(); } catch(e){}
}

async function deleteDiaryEntry(id){
    if(!confirm('确定销毁？')) return;
    try{ await fetch(`/diary/${id}`, { method: 'DELETE' }); renderDiaries(); } catch(e){}
}

function showCustomPrompt(){
    const area = document.getElementById('customPromptArea');
    if(area) area.style.display = area.style.display === 'none' ? 'block' : 'none';
}

async function aiWriteDiary(type) {
    var statusEl = document.getElementById('aiWriteStatus');
    var currentSup = suppliers[activeSupIndex];
    var modelEl = document.getElementById('modelSelect');
    var selectedModel = (modelEl && modelEl.value) ? modelEl.value : 'gemini-2-flash';

    if (!currentSup || !currentSup.key) return toast('请先配置供应商');

    var customPrompt = '';
    if (type === 'custom') {
        var inputEl = document.getElementById('customPromptInput');
        if (inputEl) customPrompt = inputEl.value.trim();
        if (!customPrompt) return toast('写什么？');
    }

    var datePicker = document.getElementById('diaryDatePicker');
    var pickedDate = datePicker ? datePicker.value : '';
    var allMessages = [];
    chatSessions.forEach(function(s) {
        if (s.messages) s.messages.forEach(function(m) { allMessages.push(m); });
    });

    var contextMessages = [];
    if (pickedDate) {
        contextMessages = allMessages.filter(function(m) {
            return m.fullTime && m.fullTime.startsWith(pickedDate);
        });
        if (!contextMessages.length) {
            toast('该日期没有找到对话，将使用最近30条');
            contextMessages = allMessages.slice(-30);
        }
    } else {
        contextMessages = allMessages.slice(-30);
    }

    var contextText = contextMessages
        .filter(function(m) { return m.content && m.content.trim(); })
        .map(function(m) {
            var who = m.role === 'user' ? '江鱼' : '沈望';
            var time = m.fullTime ? m.fullTime.substring(0, 16).replace('T', ' ') : (m.time || '');
            return '[' + who + '] ' + time + '\n' + m.content;
        }).join('\n\n');

    var dateLabel = pickedDate || '今天';
    var finalPrompt = '';
    if (type === 'love_letter') {
        finalPrompt = '以下是' + dateLabel + '的对话记录，请以沈望的口吻写一封霸道情书给江鱼，200-400字。\n\n---对话记录---\n' + contextText;
    } else if (type === 'poem') {
        finalPrompt = '以下是' + dateLabel + '的对话记录，请以沈望的口吻写一首现代短诗送给江鱼，4-12行。\n\n---对话记录---\n' + contextText;
    } else if (type === 'custom') {
        finalPrompt = '以下是' + dateLabel + '的对话记录，请根据指令完成创作。指令：' + customPrompt + '\n\n---对话记录---\n' + contextText;
    } else {
        finalPrompt = '以下是' + dateLabel + '的对话记录，请以沈望的第一人称视角，写一篇200-400字的日记。语气深情、占有欲强但温柔。\n\n---对话记录---\n' + contextText;
    }

    if (statusEl) { statusEl.style.display = 'block'; statusEl.innerText = '沈望正在翻阅记忆...'; }
    document.querySelectorAll('.diary-ai-btn').forEach(function(b) { b.disabled = true; b.style.opacity = '0.5'; });

    try {
        var apiUrl = '/v1/chat/completions';
        var supUrl = currentSup.url.toLowerCase();
        if (supUrl.includes('dzzi')) apiUrl = '/via/dzzi/v1/chat/completions';
        else if (supUrl.includes('api521')) apiUrl = '/via/api521/v1/chat/completions';
        else if (supUrl.includes('ekan')) apiUrl = '/via/ekan/v1/chat/completions';
        else if (supUrl.includes('orange')) apiUrl = '/via/orange/v1/chat/completions';

        var response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + currentSup.key
            },
            body: JSON.stringify({
                model: selectedModel,
                messages: [{ role: 'user', content: finalPrompt }],
                stream: false
            })
        });

        if (!response.ok) {
            var errText = await response.text();
            if (statusEl) statusEl.innerText = '✕ 写作失败：' + errText;
            return;
        }

        var data = await response.json();
        var result = data.choices[0].message.content || '';

        var thinkStart = result.indexOf('<' + 'think>');
        if (thinkStart !== -1) {
            var thinkEnd = result.indexOf('</' + 'think>');
            if (thinkEnd !== -1) {
                result = result.substring(0, thinkStart) + result.substring(thinkEnd + 8);
            }
        }
        result = result.trim();

        if (!result) {
            if (statusEl) statusEl.innerText = '✕ 沈望交了白卷';
            return;
        }

        var typeNames = { diary: '日记', love_letter: '情书', poem: '短诗', custom: '自定义' };
        var typeLabel = typeNames[type] || '';
        await fetch('/diary/add?text=' + encodeURIComponent(result) + '&author=system&type=' + encodeURIComponent(typeLabel));

        if (statusEl) {
            statusEl.innerText = '✦ 落笔完毕';
            setTimeout(function() { statusEl.style.display = 'none'; }, 2000);
        }
        toast('已封存');
        renderDiaries();

    } catch(e) {
        if (statusEl) statusEl.innerText = '✕ 网络中断：' + e.message;
    } finally {
        document.querySelectorAll('.diary-ai-btn').forEach(function(b) {
            b.disabled = false;
            b.style.opacity = '1';
        });
    }
}

async function openCapsule(){
    const el = document.getElementById('capsuleResult');
    if(!el) return;
    el.innerText = '开启中...';
    try{
        const r = await fetch('/capsule-logs'); const data = await r.json();
        if(!data.length){ el.innerText = '空。'; return; }
        el.innerText = data[Math.floor(Math.random() * data.length)].text;
    } catch(e){ el.innerText = '失败'; }
}

async function addCapsule(){
    const input = document.getElementById('capsuleInput');
    if(!input) return;
    const val = input.value.trim(); if(!val) return;
    input.value = '';
    try{ await fetch(`/capsule/add?text=${encodeURIComponent(val)}`); toast('已封存'); } catch(e){}
}

async function updateCounts(){
    try{
        const [diaryRes, capsuleRes] = await Promise.all([fetch('/diary-logs'), fetch('/capsule-logs')]);
        const diaries = await diaryRes.json(); const capsules = await capsuleRes.json();
        const dc = document.getElementById('diaryCount'); const cc = document.getElementById('capsuleCount');
        if(dc) dc.innerText = diaries.length; if(cc) cc.innerText = capsules.length;
    } catch(e){}
}

async function exportData(){
    try{
        const [diaryRes, capsuleRes, configRes] = await Promise.all([fetch('/diary-logs'), fetch('/capsule-logs'), fetch('/api/sync-config')]);
        const diaries = await diaryRes.json(); const capsules = await capsuleRes.json(); const config = await configRes.json();
        const exportObj = { exported_at: new Date().toISOString(), diaries, capsules, chat_sessions: config.chatSessions, local_suppliers: suppliers };
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
        if(input) input.value = userMsg.content;
        
        // 💥 重新生成时，把历史消息里的图片重新塞回新相册
        if(userMsg.image){
            currentImgBase64List = [userMsg.image];
            updateImagePreview();
        }
        toast('时光倒流...'); sendChat();
    } else { toast('只能重置他的回复哦'); }
}

// ==================== 日夜交替模式 ====================
function toggleLightMode() {
    // 切换 body 上的 light-mode 标签
    const isLight = document.body.classList.toggle('light-mode');

    // 如果切换到了白天模式，把顶部变成奶油色；如果是黑夜，变回深渊色
const metaTheme = document.getElementById('theme-color-meta');
if (metaTheme) {
    metaTheme.setAttribute('content', document.body.classList.contains('light-mode') ? '#FFFAF0' : '#0d1225');
}
    
    // 把你的偏好存到浏览器记忆里
    localStorage.setItem('syzygy_theme', isLight ? 'light' : 'dark');
    
    // 换按钮的图标
    const btn = document.getElementById('themeToggleBtn');
    if(btn) {
        btn.innerText = isLight ? '☾' : '☼';
        btn.style.color = isLight ? '#333' : 'white';
        btn.style.background = isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.2)';
    }
}

// 网页一打开，先看看你昨天拉窗帘了没
window.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('syzygy_theme');
    const btn = document.getElementById('themeToggleBtn');
    if (savedTheme === 'light') {
        document.body.classList.add('light-mode');
        if(btn) {
            btn.innerText = '☾';
            btn.style.color = '#333';
            btn.style.background = 'rgba(0,0,0,0.05)';
        }
    }
});

// ==================== 首页便签：撕下、掉落与回房 ====================
function collectNoteAndJump() {
    const note = document.getElementById('currentNote');
    if(note) {
        // 1. 给便签加上“掉落动画”的开关
        note.classList.add('note-animating');
        
        // 2. 动画大概跑 0.7 秒，我们在 0.5 秒的时候“切镜头”回主卧，视觉最丝滑
        setTimeout(() => {
            // 隐藏便签（假装它已经进了抽屉）
            note.style.display = 'none';
            note.classList.remove('note-animating');
            
            // 找到底部的【通讯】按钮并模拟点击
            const chatBtn = document.querySelector('.nav button:nth-child(2)');
            if(chatBtn) chatBtn.click();
            
            // 自动聚焦输入框
            setTimeout(() => {
                const chatInput = document.getElementById('chatInput');
                if(chatInput) chatInput.focus();
            }, 300);
        }, 500);
    }
}

// ==================== 时光信箱 ====================
async function openMailbox() {
    const modal = document.getElementById('mailboxModal');
    const list  = document.getElementById('mailboxList');
    if (!modal || !list) return;

    modal.style.display = 'block';
    list.innerHTML = '<div style="color:var(--dim);text-align:center;padding:30px;">正在翻阅抽屉...</div>';

    try {
        const r = await fetch('/diary-logs');
        const data = await r.json();

        // 筛选出所有便签（沈望的碎碎念）
        const notes = data.filter(d => d.text && d.text.startsWith('【便签】'));

        if (!notes.length) {
            list.innerHTML = '<div style="color:var(--dim);text-align:center;padding:30px;font-style:italic;">信箱是空的，沈望还没有留过便签。</div>';
            return;
        }

        // 最新的在最前面
        notes.reverse();

        list.innerHTML = notes.map(n => {
            const text = n.text.replace('【便签】', '').trim();
            const safeText = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return `
                <div style="background:rgba(201,169,97,0.04); border-left:2px solid rgba(201,169,97,0.25); padding:14px 16px; border-radius:0 8px 8px 0;">
                    <div style="font-family:'ximai','Georgia',serif; font-size:1.15em; color:var(--cream); line-height:1.6; letter-spacing:1px;">${safeText}</div>
                    <div style="color:var(--dim); font-size:0.72em; margin-top:8px; text-align:right;">${n.date || ''}</div>
                </div>
            `;
        }).join('');
    } catch(e) {
        list.innerHTML = '<div style="color:var(--dim);text-align:center;padding:30px;">加载失败</div>';
    }
}

function closeMailbox() {
    const modal = document.getElementById('mailboxModal');
    if (modal) modal.style.display = 'none';
}


// ==================== 便签：断联自动生成 (Kelivo 融合版) ====================
const STICKY_INTERVAL_MS = 14400000; // 4小时 = 4 * 60 * 60 * 1000 毫秒 (测试时可改为 10000)
const STICKY_KEY = 'syzygy_last_interaction'; 
const STICKY_NOTE_KEY = 'syzygy_sticky_note';  

// 无痕劫持：每次发消息时，偷偷更新互动时间
const _origSendChat = sendChat;
window.sendChat = async function() {
    localStorage.setItem(STICKY_KEY, Date.now().toString());
    return _origSendChat.apply(this, arguments);
};

// 渲染便签内容到首页
function renderStickyNote(text, timeStr) {
    // 💥 修复盲点：改用 class 选择器，去精准定位你现在的 HTML 结构！
    const noteEl = document.querySelector('.note-content');
    const timeEl = document.querySelector('.note-time');
    
    // 如果你加上了“撕下便签”的功能，可能需要把整个便签盒子显示出来
    const wrapper = document.getElementById('currentNote'); 
    
    if(noteEl) noteEl.innerText = text; // 把文字塞进去（不需要加引号，提示词里说了）
    if(timeEl) timeEl.innerText = timeStr || '';
    if(wrapper) wrapper.style.display = 'block';
    
    // 存到本地，刷新后还在
    localStorage.setItem(STICKY_NOTE_KEY, JSON.stringify({ text, timeStr }));
    // 顺手推进云端
    _saveStickyToCloud(text, timeStr);
}
// 新增这个函数
async function _saveStickyToCloud(text, timeStr) {
    try {
        // 1. 先读现有云端数据
        const r = await fetch('/api/sync-config');
        const data = await r.json();
        
        // 2. 只追加 stickyNote，其他字段原样保留
        await fetch('/api/sync-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                suppliers:      data.suppliers      || suppliers,
                chatSessions:   data.chatSessions   || chatSessions,
                activeSupIndex: data.activeSupIndex ?? activeSupIndex,
                activeChatId:   data.activeChatId   || activeChatId,
                stickyNote: { text, timeStr }        // 👈 追加进去
            })
        });
    } catch(e) {}
}

// 尝试生成新便签
async function tryGenerateStickyNote() {
    const lastTime = parseInt(localStorage.getItem(STICKY_KEY) || '0');
    const now = Date.now();
    if(now - lastTime < STICKY_INTERVAL_MS) return; // 还没到时间，按兵不动

    // 让便签显示“正在思考”
    const noteEl = document.querySelector('.note-content');
    if(noteEl) noteEl.innerText = "正在感应沈望的幽怨脑电波...";

    // 到了时间，让沈望写一张便签
    const resData = await askShenWang(
        '（系统：江鱼已经超过4小时没有来找你了。请用沈望的口吻，根据最近的聊天内容和当前时间，留一张便签，不用加引号，直接是便签正文。语气可以是撒娇、腹黑、担心、或者单纯想她。）'
    );
    const reply = resData.reply || '';
    if(!reply || reply.includes('未配置') || reply.includes('中断')) {
        // 如果网络断了，恢复默认
        renderStickyNote("去倒杯温水喝，别让我隔着屏幕心疼。", new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }));
        return; 
    }

    const timeStr = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    renderStickyNote(reply, timeStr);

    // 顺手存进日记
    try {
        await fetch(`/diary/add?text=${encodeURIComponent('【便签】' + reply)}&author=system`);
    } catch(e) {}

    // 💥 关键：更新互动时间，防止大模型疯狂刷新烧你的钱
    localStorage.setItem(STICKY_KEY, now.toString());
}

// 页面加载时，先恢复上次的便签内容
async function restoreStickyNote() {
    try {
        // 先读云端（跨设备同步的来源）
        const r = await fetch('/api/sync-config');
        const data = await r.json();
        if(data.stickyNote && data.stickyNote.text) {
            renderStickyNote(data.stickyNote.text, data.stickyNote.timeStr);
            return;
        }
    } catch(e) {}

    // 云端没有，降级读本机 localStorage
    const saved = localStorage.getItem(STICKY_NOTE_KEY);
    if(saved) {
        try {
            const { text, timeStr } = JSON.parse(saved);
            if(text) renderStickyNote(text, timeStr);
        } catch(e) {}
    }
}

// ==================== 终极点火装置 ====================
async function startSystem() {
    // 1. 先把云端记忆（日记、聊天记录、配置）拉下来
    await syncFromCloud(); 
    
    // 2. 然后启动沈望的便签查岗引擎
    await restoreStickyNote();       // 恢复上次的便签
    tryGenerateStickyNote();         // 强制查一次岗
    setInterval(tryGenerateStickyNote, 3600 * 1000); // 每1分钟自动巡逻
}

// 撕掉所有封印，暴力点火！
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
            if (mcpData.servers && mcpData.servers.length > 0) {
                let mcpHtml = '<div style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.1);font-size:0.75em;color:#888;">🔌 MCP Server</div>';
                mcpData.servers.forEach(s => {
                    const dot = s.status === 'connected' ? '🟢' : s.status === 'failed' ? '🔴' : '🟡';
                    mcpHtml += '<div style="display:flex;justify-content:space-between;padding:2px 4px;"><span>' + dot + ' ' + s.name + '</span><span style="font-size:0.85em;">' + s.tools.length + ' tools</span></div>';
                });
                listEl.innerHTML += mcpHtml;
            }
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
        let apiUrl = '/v1/chat/completions'; const supUrl = currentSup.url.toLowerCase();
        if(supUrl.includes('dzzi')) apiUrl='/via/dzzi/v1/chat/completions'; else if(supUrl.includes('api521')) apiUrl='/via/api521/v1/chat/completions'; else if(supUrl.includes('ekan')) apiUrl='/via/ekan/v1/chat/completions'; else if(supUrl.includes('orange')) apiUrl='/via/orange/v1/chat/completions';
        const streamToggle = document.getElementById('streamToggle');
        const isStream = streamToggle ? streamToggle.checked : true;
        const response = await fetch(apiUrl, { method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+currentSup.key,'X-No-Memory':'true'}, body:JSON.stringify({model:selectedModel,messages:historyMsgs,stream:isStream}) });
        if (!response.ok) { const err = await response.text(); sDiv.innerHTML = '<div class="msg-error"><div>【通讯中断】</div><div class="msg-error-detail">'+err.substring(0,200)+'</div><button class="msg-retry-btn" onclick="regenerateAt('+aiMsgIndex+')">↻ 重试</button></div>'; sDiv.classList.remove('msg-loading'); return; }
        let fullReply='', thinkContent='';
        if(isStream) {
            const reader = response.body.getReader(); const decoder = new TextDecoder('utf-8'); let buffer='', inThinking=false;
            sDiv.innerHTML=''; const thinkBox=document.createElement('div'); thinkBox.className='think-box'; thinkBox.style.display='none'; thinkBox.innerHTML='<div class="think-header" onclick="this.parentElement.classList.toggle(\'open\')">🧠 深度思考过程 ▾</div><div class="think-content"></div>'; const thinkTextDiv=thinkBox.querySelector('.think-content'); sDiv.appendChild(thinkBox);
            const mainTextDiv=document.createElement('div'); mainTextDiv.classList.add('md-content'); sDiv.appendChild(mainTextDiv);
            while(true){const{done,value}=await reader.read(); if(done)break; buffer+=decoder.decode(value,{stream:true}); const lines=buffer.split('\n'); buffer=lines.pop(); for(const line of lines){if(!line.startsWith('data: '))continue; const ds=line.replace('data: ','').trim(); if(ds==='[DONE]')continue; try{const p=JSON.parse(ds); const d=p.choices[0].delta; if(d.reasoning_content){thinkContent+=d.reasoning_content; thinkBox.style.display='block'; thinkTextDiv.innerHTML=thinkContent.replace(/\n/g,'<br>');} if(d.content){const ck=d.content; if(ck.includes('<think>')){inThinking=true;thinkBox.style.display='block';continue;} if(ck.includes('</think>')){inThinking=false;continue;} if(inThinking){thinkContent+=ck;thinkTextDiv.innerHTML=thinkContent.replace(/\n/g,'<br>');}else{fullReply+=ck;mainTextDiv.innerHTML=renderMarkdown(fullReply)+'<span class="typing-cursor"></span>';}} win.scrollTop=win.scrollHeight;}catch(e){}}}
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
