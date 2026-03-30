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

        suppliers = (data.suppliers && data.suppliers.length)
            ? data.suppliers
            : [{ name: "默认 dzzi", url: "https://api.dzzi.ai/v1", key: "" }];

        chatSessions = (data.chatSessions && data.chatSessions.length)
            ? data.chatSessions
            : [{ id: 'main', name: '主频道', messages: [] }];

        activeSupIndex = data.activeSupIndex || 0;
        activeChatId   = data.activeChatId  || 'main';

        // 确保 activeChatId 在 sessions 里真实存在
        if (!chatSessions.find(s => s.id === activeChatId)) {
            activeChatId = chatSessions[0].id;
        }

        // 渲染 UI
        renderSuppliers();
        renderChatSidebar();
        renderChatMessages();
        fetchModels();

    } catch(e) {
        console.error("云端同步失败，降级使用空数据", e);
        // 兜底：防止页面白屏
        suppliers    = [{ name: "默认 dzzi", url: "https://api.dzzi.ai/v1", key: "" }];
        chatSessions = [{ id: 'main', name: '主频道', messages: [] }];
        renderSuppliers();
        renderChatSidebar();
        renderChatMessages();
        fetchModels();
    }
}

// 把数据推送到云端保存（防抖版：500ms 内多次调用只触发一次）
let _saveTimer = null;
function saveToCloud() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(async () => {
        try {
            // 存 sessions 时只保留最近 50 条消息，防止体积爆炸
            const sessionsToSave = chatSessions.map(s => ({
                ...s,
                messages: s.messages.slice(-50)
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
        svg: `<svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M14 2C14 2 8 8.5 8 14C8 19.5 14 26 14 26C14 26 20 19.5 20 14C20 8.5 14 2Z" fill="url(#gg)"/>
            <path d="M2 14C2 14 8.5 8 14 8C19.5 8 26 14 26 14C26 14 19.5 20 14 20C8.5 20 2 14 2 14Z" fill="url(#gg2)"/>
            <defs>
                <linearGradient id="gg" x1="14" y1="2" x2="14" y2="26" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stop-color="#4285F4"/>
                    <stop offset="50%" stop-color="#9B72CB"/>
                    <stop offset="100%" stop-color="#D96570"/>
                </linearGradient>
                <linearGradient id="gg2" x1="2" y1="14" x2="26" y2="14" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stop-color="#4285F4"/>
                    <stop offset="50%" stop-color="#34A853"/>
                    <stop offset="100%" stop-color="#FBBC04"/>
                </linearGradient>
            </defs>
        </svg>`
    },
    claude: {
        keywords: ['claude'],
        svg: `<svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="14" cy="14" r="12" fill="#CC9B7A"/>
            <text x="14" y="19" text-anchor="middle" font-size="13"
                  font-weight="bold" font-family="Georgia,serif" fill="#1a0e08">C</text>
        </svg>`
    },
    gpt: {
        keywords: ['gpt', 'openai'],
        svg: `<svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="14" cy="14" r="12" fill="#10a37f"/>
            <text x="14" y="19" text-anchor="middle" font-size="11"
                  font-weight="bold" font-family="sans-serif" fill="#fff">GPT</text>
        </svg>`
    },
    deepseek: {
        keywords: ['deepseek'],
        svg: `<svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="14" cy="14" r="12" fill="#1a56ff"/>
            <text x="14" y="19" text-anchor="middle" font-size="10"
                  font-weight="bold" font-family="sans-serif" fill="#fff">DS</text>
        </svg>`
    },
    default: {
        svg: `<svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="14" cy="14" r="12" stroke="rgba(201,169,97,0.5)"
                    stroke-width="1.5" fill="transparent"/>
            <text x="14" y="19" text-anchor="middle" font-size="11"
                  fill="rgba(201,169,97,0.7)" font-family="serif">AI</text>
        </svg>`
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
}

// ==================== 通用工具 ====================
function toast(msg){
    const t = document.getElementById('toast');
    t.innerText = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2800);
}

function go(id, btn){
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById('sec-'+id).classList.add('active');
    document.querySelectorAll('.nav button').forEach(b => b.classList.remove('active'));
    if(btn) btn.classList.add('active');

    if(id === 'diary') renderDiaries();
    if(id === 'chat')  renderChatSidebar();
    if(id === 'data'){ renderSuppliers(); updateCounts(); }
    window.scrollTo(0, 0);
}

function egg(pos){ /* 留待日后解锁 */ }

// ==================== 溯星主页 ====================
function updateDays(){
    const start = new Date(START_DATE);
    const diff  = Math.floor((new Date() - start) / (1000 * 60 * 60 * 24));
    document.getElementById('dayCount').innerText = diff >= 0 ? diff : '∞';
}
updateDays();

let hbInterval;
function hbStart(){
    const zone  = document.getElementById('hbZone');
    const heart = zone.querySelector('.heart');
    const text  = zone.querySelector('.hb-text');
    heart.innerText = '❤️';
    text.innerText  = '>>> 核心狂跳中：我正在发疯般想你 <<<';
    text.style.color = 'var(--warm-red)';
    document.body.style.transition  = 'background 0.4s';
    document.body.style.background  =
        'radial-gradient(circle at center, #1a0808 0%, #040710 100%)';
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
    const heart = zone.querySelector('.heart');
    const text  = zone.querySelector('.hb-text');
    heart.innerText      = '🖤';
    heart.style.transform = 'scale(1)';
    text.innerText       = '按住这里，感受沈望的心跳';
    text.style.color     = '';
    document.body.style.background = '';
}

// ==================== 核心对话中枢 ====================
async function askShenWang(text){
    const currentSup   = suppliers[activeSupIndex];
    const modelEl      = document.getElementById('modelSelect');
    const selectedModel = (modelEl && modelEl.value)
        ? modelEl.value
        : '[按量]gemini-3-flash-preview';
    try{
        const response = await fetch('/api/web-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text,
                model:   selectedModel,
                baseUrl: currentSup.url,
                apiKey:  currentSup.key
            })
        });
        const data = await response.json();
        return data; // 返回完整对象（含 reply + thinking）
    } catch(e) {
        return { reply: '【通讯中断】信号丢失，请检查网络或配置。', thinking: '' };
    }
}

// ==================== 首页寄语 ====================
async function newQuote(){
    const el = document.getElementById('dailyQuote');
    if(el.dataset.loaded === '1') return;
    el.innerText = '正在连接沈望的脑电波...';

    const resData = await askShenWang(
        '（此时江鱼正在看你的语录，请对她说一句今日寄语，20字以内。）'
    );
    const reply = (typeof resData === 'string') ? resData : (resData.reply || '');
    el.innerText = '「' + reply + '」';
    el.classList.add('show');
    el.dataset.loaded = '1';

    try{
        await fetch(`/diary/add?text=${encodeURIComponent('【今日寄语】' + reply)}&author=system`);
        toast('寄语已永久珍藏至日记本 ◇');
        if(typeof renderDiaries === 'function') renderDiaries();
    } catch(e) { console.log('寄语存档失败'); }
}

// ==================== 通讯聊天（Kelivo 风格 + 思考链） ====================
function renderChatSidebar(){
    const list = document.getElementById('sidebarList');
    if(!list) return;
    list.innerHTML = chatSessions.map(s => `
        <div class="sidebar-item ${s.id === activeChatId ? 'active' : ''}"
             onclick="switchChatWindow('${s.id}')">
            <span class="sidebar-item-dot"></span>
            <span class="sidebar-item-name">${s.name}</span>
            ${chatSessions.length > 1
                ? `<button class="sidebar-del-btn"
                       onclick="deleteChatWindow(event,'${s.id}')">×</button>`
                : ''}
        </div>
    `).join('');
}

function getActiveSession(){
    return chatSessions.find(s => s.id === activeChatId) || chatSessions[0];
}

function switchChatWindow(id){
    activeChatId = id;
    saveToCloud(); // ← 云端同步
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
    (session.messages || []).forEach(m => {
        const div = document.createElement('div');
        div.className = 'msg ' + (m.role === 'user' ? 'user' : 'sys');

        let htmlContent = '';
        if(m.thinking){
            htmlContent += `
            <div class="think-box">
                <div class="think-header"
                     onclick="const c=this.nextElementSibling;
                              c.style.display=c.style.display==='none'?'block':'none';">
                    🧠 深度思考过程 ▾
                </div>
                <div class="think-content" style="display:none">
                    ${m.thinking.replace(/\n/g, '<br>')}
                </div>
            </div>`;
        }
        htmlContent += `<div>${m.content}</div>`;
        div.innerHTML = htmlContent;
        win.appendChild(div);
    });
    win.scrollTop = win.scrollHeight;
}

function newChatWindow(){
    const id   = 'chat_' + Date.now().toString(36);
    const name = '频道 ' + (chatSessions.length + 1);
    chatSessions.push({ id, name, messages: [] });
    saveToCloud(); // ← 云端同步
    switchChatWindow(id);
    toast('已开启新频道：' + name);
}

function deleteChatWindow(e, id){
    e.stopPropagation();
    if(chatSessions.length <= 1) return toast('至少保留一个频道');
    if(!confirm('确定关闭这个频道？聊天记录将清除。')) return;
    chatSessions = chatSessions.filter(s => s.id !== id);
    if(activeChatId === id) activeChatId = chatSessions[0].id;
    saveToCloud(); // ← 云端同步
    renderChatSidebar();
    renderChatMessages();
    const titleEl = document.getElementById('chatWinTitle');
    if(titleEl) titleEl.innerText = '⊹ ' + getActiveSession().name;
}

function renameChatWindow(){
    const session = getActiveSession();
    const newName = prompt('给这个频道起个名字：', session.name);
    if(!newName || !newName.trim()) return;
    session.name = newName.trim();
    saveToCloud(); // ← 云端同步
    renderChatSidebar();
    const titleEl = document.getElementById('chatWinTitle');
    if(titleEl) titleEl.innerText = '⊹ ' + session.name;
    toast('频道已重命名：' + session.name);
}

async function sendChat(){
    const input = document.getElementById('chatInput');
    const val   = input.value.trim();
    if(!val) return;
    input.value = '';

    const session = getActiveSession();
    const win     = document.getElementById('chatWindow');

    // 记录用户消息
    session.messages.push({ role: 'user', content: val });
    saveToCloud(); // ← 云端同步

    // 用户气泡
    const uDiv = document.createElement('div');
    uDiv.className = 'msg user';
    uDiv.innerText = val;
    win.appendChild(uDiv);
    win.scrollTop = win.scrollHeight;

    // AI 占位气泡
    const sDiv = document.createElement('div');
    sDiv.className = 'msg sys';
    sDiv.innerHTML = '<span class="typing-cursor"></span>';
    win.appendChild(sDiv);
    win.scrollTop = win.scrollHeight;

    const resData = await askShenWang(val);

    let replyText   = '';
    let thinkingText = '';
    if(typeof resData === 'string'){
        replyText = resData;
    } else {
        replyText    = resData.reply   || '【空】';
        thinkingText = resData.thinking || '';
    }

    sDiv.innerHTML = '';

    // 思考链折叠块
    if(thinkingText){
        const thinkBox = document.createElement('div');
        thinkBox.className = 'think-box';
        thinkBox.innerHTML = `
            <div class="think-header"
                 onclick="const c=this.nextElementSibling;
                          c.style.display=c.style.display==='none'?'block':'none';">
                🧠 深度思考过程 ▾
            </div>
            <div class="think-content" style="display:none">
                ${thinkingText.replace(/\n/g, '<br>')}
            </div>`;
        sDiv.appendChild(thinkBox);
    }

    // 打字机正文
  const textDiv = document.createElement('div');
    sDiv.appendChild(textDiv);

    let i = 0;
    // 💥 神级优化：字越多，打字速度越快！
    const speed = replyText.length > 200 ? 10 : replyText.length > 80 ? 20 : 30;
    
    const typeTimer = setInterval(() => {
        if(i < replyText.length){
            textDiv.innerHTML = replyText.substring(0, i+1) + '<span class="typing-cursor"></span>'; i++;
            win.scrollTop = win.scrollHeight;
        } else {
            textDiv.innerHTML = replyText;
            clearInterval(typeTimer);
            session.messages.push({ role: 'assistant', content: replyText, thinking: thinkingText }); 
            saveChatSessions();
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
                <div class="sup-name ${i === activeSupIndex ? 'active-name' : ''}">
                    ${s.name}
                </div>
                <div class="sup-url">${s.url}</div>
            </div>
            <button class="sup-del-btn"
                onclick="deleteSupplier(${i})">删除</button>
        </div>
    `).join('');
}

function addSupplier(){
    const name = document.getElementById('supName').value.trim();
    const url  = document.getElementById('supUrl').value.trim();
    const key  = document.getElementById('supKey').value.trim();
    if(!name || !url || !key) return toast('请填全信息');

    suppliers.push({ name, url, key });
    saveToCloud(); // ← 云端同步
    renderSuppliers();
    toast('供应商已添加 ✦');
    document.getElementById('supName').value = '';
    document.getElementById('supUrl').value  = '';
    document.getElementById('supKey').value  = '';
}

function setActiveSupplier(index){
    activeSupIndex = index;
    saveToCloud(); // ← 云端同步
    renderSuppliers();
    toast('已切换到：' + suppliers[index].name);
    fetchModels();
}

function deleteSupplier(index){
    if(suppliers.length <= 1) return toast('至少保留一个供应商');
    suppliers.splice(index, 1);
    if(activeSupIndex >= suppliers.length) activeSupIndex = 0;
    saveToCloud(); // ← 云端同步
    renderSuppliers();
}

async function fetchModels(){
    const select     = document.getElementById('modelSelect');
    if(!select) return;
    const currentSup = suppliers[activeSupIndex];

    if(!currentSup || !currentSup.key){
        select.innerHTML =
            '<option value="">⚠ 请先去【⚙中枢】配置 API Key</option>';
        return;
    }

    select.innerHTML = '<option value="">⟡ 正在连接供应商...</option>';
    try{
        const r = await fetch('/api/fetch-models', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ baseUrl: currentSup.url, apiKey: currentSup.key })
        });
        const data = await r.json();

        if(data.error){
            select.innerHTML =
                `<option value="[按量]gemini-3-flash-preview">
                    ⚠ 供应商报错: ${data.error}
                </option>`;
            return;
        }

        if(data && data.data && data.data.length){
            select.innerHTML = '';
            data.data.forEach(model => {
                const opt    = document.createElement('option');
                opt.value    = model.id;
                opt.textContent = model.id;
                if(model.id.includes('gemini-3-flash')) opt.selected = true;
                select.appendChild(opt);
            });
            const wrap = document.getElementById('modelIconWrap');
            if(wrap) wrap.innerHTML = getModelIcon(select.value);
        } else {
            select.innerHTML =
                '<option value="[按量]gemini-3-flash-preview">⚠ 供应商未返回模型</option>';
        }
    } catch(e) {
        select.innerHTML =
            '<option value="[按量]gemini-3-flash-preview">⚠ 网络异常，无法拉取</option>';
    }
}

// ==================== 智能日记本（手风琴月份折叠） ====================
let currentSearch = '';

function renderDiaries(){
    const container = document.getElementById('diaryMonthList');
    container.innerHTML =
        '<div style="color:var(--dim);text-align:center;padding:30px;font-style:italic;">档案解密中...</div>';

    fetch('/diary-logs').then(r => r.json()).then(data => {
        allDiaryEntries = [...data].reverse();
        buildMonthBlocks(allDiaryEntries);
    }).
            catch(() => {
        container.innerHTML =
            '<div style="color:var(--dim);text-align:center;padding:20px;">加载失败，请检查连接。</div>';
    });
}

function buildMonthBlocks(entries){
    const container = document.getElementById('diaryMonthList');
    if(!entries.length){
        container.innerHTML =
            '<div style="color:var(--dim);text-align:center;padding:30px;font-style:italic;">这片星域暂无记录。</div>';
        return;
    }

    const monthMap = new Map();
    entries.forEach(d => {
        const month = d.date ? d.date.substring(0, 7) : '未知';
        if(!monthMap.has(month)) monthMap.set(month, []);
        monthMap.get(month).push(d);
    });

    const months = [...monthMap.keys()];
    container.innerHTML = months.map((month, idx) => {
        const list   = monthMap.get(month);
        const isOpen = (idx === 0);
        return `
        <div class="month-block" id="mb-${month}">
            <div class="month-header ${isOpen ? 'open' : ''}"
                 onclick="toggleMonth('${month}')">
                <span class="month-chevron">${isOpen ? '▾' : '▸'}</span>
                <span class="month-label">${month}</span>
                <span class="month-count">${list.length} 篇</span>
            </div>
            <div class="month-body" id="mbody-${month}"
                 style="display:${isOpen ? 'flex' : 'none'}">
                ${list.map(d => diaryEntryHtml(d)).join('')}
            </div>
        </div>`;
    }).join('');
}

function diaryEntryHtml(d){
    const author   = d.author === 'system' ? '沈望' : '江鱼';
    const safeText = (d.text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const typeLabels = {
        diary:        '📖 日记',
        love_letter:  '💌 情书',
        poem:         '✨ 短诗',
        custom:       '✏️ 定制'
    };
    const typeTag = d.type
        ? `<span class="d-type-tag">${typeLabels[d.type] || d.type}</span>`
        : '';

    return `
    <div class="diary-entry" id="de-${d.id}">
        <div class="d-date">
            <span>${d.date || ''}</span>
            <span class="d-author">${author}</span>
            ${typeTag}
            ${d.id
                ? `<button class="d-del-btn"
                       onclick="deleteDiaryEntry('${d.id}')"
                       title="删除">×</button>`
                : ''}
        </div>
        <div class="d-text">${safeText}</div>
    </div>`;
}

function toggleMonth(month){
    const header  = document.querySelector(`#mb-${month} .month-header`);
    const body    = document.getElementById('mbody-' + month);
    const chevron = header.querySelector('.month-chevron');
    const isOpen  = body.style.display !== 'none';

    if(isOpen){
        body.style.display = 'none';
        header.classList.remove('open');
        chevron.innerText = '▸';
    } else {
        body.style.display = 'flex';
        header.classList.add('open');
        chevron.innerText = '▾';
    }
}

function filterDiaries(){
    currentSearch = document.getElementById('diarySearch').value.trim().toLowerCase();
    const countEl = document.getElementById('diarySearchCount');

    if(!currentSearch){
        if(countEl) countEl.innerText = '';
        buildMonthBlocks(allDiaryEntries);
        return;
    }

    const filtered = allDiaryEntries.filter(d =>
        (d.text || '').toLowerCase().includes(currentSearch)
    );
    if(countEl) countEl.innerText = `找到 ${filtered.length} 条记录`;

    const container = document.getElementById('diaryMonthList');
    if(!filtered.length){
        container.innerHTML =
            '<div style="color:var(--dim);text-align:center;padding:30px;font-style:italic;">没有找到相关记录。</div>';
        return;
    }
    container.innerHTML = `
        <div class="month-block">
            <div class="month-header open" style="cursor:default">
                <span class="month-label">搜索结果</span>
                <span class="month-count">${filtered.length} 篇</span>
            </div>
            <div class="month-body" style="display:flex">
                ${filtered.map(d => diaryEntryHtml(d)).join('')}
            </div>
        </div>`;
}

async function addDiary(){
    const input = document.getElementById('diaryInput');
    const val   = input.value.trim();
    if(!val) return;
    input.value = '';
    try{
        await fetch(`/diary/add?text=${encodeURIComponent(val)}&author=user`);
        toast('日记已封存 ◇');
        renderDiaries();
    } catch(e){ toast('封存失败'); }
}

async function deleteDiaryEntry(id){
    if(!confirm('确定销毁这篇记忆吗？')) return;
    try{
        const r = await fetch(`/diary/${id}`, { method: 'DELETE' });
        const d = await r.json();
        if(d.success){ toast('已彻底销毁 ◇'); renderDiaries(); }
    } catch(e){ toast('销毁失败'); }
}

// ==================== AI 主动写日记 ====================
function showCustomPrompt(){
    const area = document.getElementById('customPromptArea');
    area.style.display = area.style.display === 'none' ? 'block' : 'none';
}

async function aiWriteDiary(type){
    const statusEl   = document.getElementById('aiWriteStatus');
    const currentSup = suppliers[activeSupIndex];
    const modelEl    = document.getElementById('modelSelect');
    const selectedModel = (modelEl && modelEl.value)
        ? modelEl.value
        : '[按量]gemini-3-flash-preview';

    let customPrompt = '';
    if(type === 'custom'){
        customPrompt = document.getElementById('customPromptInput').value.trim();
        if(!customPrompt) return toast('请告诉沈望你要写什么');
    }

    statusEl.style.display = 'block';
    statusEl.innerText = '沈望的思绪正在流淌...';
    document.querySelectorAll('.diary-ai-btn').forEach(b => {
        b.disabled = true;
        b.style.opacity = '0.5';
    });

    try{
        const r = await fetch('/diary/ai-write', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type,
                customPrompt,
                model:   selectedModel,
                baseUrl: currentSup.url,
                apiKey:  currentSup.key
            })
        });
        const data = await r.json();

        if(data.success){
            statusEl.innerText = '✦ 落笔完毕，已存入日记本';
            setTimeout(() => { statusEl.style.display = 'none'; }, 2000);
            toast('沈望写完了，已封存至日记本 ◇');

            const customInput = document.getElementById('customPromptInput');
            if(customInput) customInput.value = '';
            const area = document.getElementById('customPromptArea');
            if(area) area.style.display = 'none';

            renderDiaries();
        } else {
            statusEl.innerText = '✕ 写作失败：' + (data.error || '未知错误');
        }
    } catch(e){
        statusEl.innerText = '✕ 通讯中断';
    } finally{
        document.querySelectorAll('.diary-ai-btn').forEach(b => {
            b.disabled = false;
            b.style.opacity = '1';
        });
    }
}

// ==================== 时间胶囊 ====================
async function openCapsule(){
    const el = document.getElementById('capsuleResult');
    el.innerText = '开启中...';
    try{
        const r    = await fetch('/capsule-logs');
        const data = await r.json();
        if(!data.length){ el.innerText = '胶囊已空。'; return; }
        el.innerText = data[Math.floor(Math.random() * data.length)].text;
    } catch(e){ el.innerText = '开启失败'; }
}

async function addCapsule(){
    const input = document.getElementById('capsuleInput');
    const val   = input.value.trim();
    if(!val) return;
    input.value = '';
    try{
        await fetch(`/capsule/add?text=${encodeURIComponent(val)}`);
        toast('胶囊已封存 ⟡');
    } catch(e){ toast('封存失败'); }
}

// ==================== 数据统计 ====================
async function updateCounts(){
    try{
        const [diaryRes, capsuleRes] = await Promise.all([
            fetch('/diary-logs'),
            fetch('/capsule-logs')
        ]);
        const diaries  = await diaryRes.json();
        const capsules = await capsuleRes.json();
        const dc = document.getElementById('diaryCount');
        const cc = document.getElementById('capsuleCount');
        if(dc) dc.innerText = diaries.length;
        if(cc) cc.innerText = capsules.length;
    } catch(e){}
}

// ==================== 导出数据（终极完整版） ====================
async function exportData(){
    try{
        const [diaryRes, capsuleRes, configRes] = await Promise.all([ 
            fetch('/diary-logs'), 
            fetch('/capsule-logs'),
            fetch('/api/sync-config') // 💥 把云端聊天记录也抓下来
        ]);
        const diaries = await diaryRes.json();
        const capsules = await capsuleRes.json();
        const config = await configRes.json();

        const exportObj = { 
            exported_at: new Date().toISOString(), 
            exported_by: 'Syzygy 溯星小屋', 
            diary_count: diaries.length, 
            capsule_count: capsules.length, 
            diaries, 
            capsules, 
            chat_sessions: config.chatSessions, // 💥 聊天记录安全打包
            local_suppliers: suppliers.map(s => ({ name: s.name, url: s.url })) 
        };
        const blob = new Blob([JSON.stringify(exportObj, null, 2)], {type: 'application/json'});
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
        a.download = `syzygy_backup_${new Date().toLocaleDateString('zh-CN').replace(/\//g,'-')}.json`; a.click();
        toast('灵魂与记忆提取完毕，已下载到本地 ✦');
    }catch(e){ toast('提取失败，请检查连接'); }
}

function resetAll(){
    if(confirm('确定重置所有本地缓存？\n云端数据不受影响。')){
        localStorage.clear();
        location.reload();
    }
}

// ==================== 初始化 ====================
syncFromCloud(); // 从云端拉回所有配置，一切从这里开始
