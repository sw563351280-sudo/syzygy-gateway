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
function stripInternalTags(text) { return (text||'').replace(/<MOOD_SNAPSHOT>[\s\S]*?<\/MOOD_SNAPSHOT>/g, '').replace(/\[\[MOOD_SNAPSHOT\]\][\s\S]*?\[\[MOOD_SNAPSHOT\]\]/g, '').replace(/<SAVE_MEMORY[\s\S]*?<\/SAVE_MEMORY>/g, '').replace(/<ADD_TODO>[\s\S]*?<\/ADD_TODO>/g, '').replace(/<DONE_TODO[^>]*\/>/g, '').trim(); }
function renderMarkdown(text) { if (!text) return ''; if (typeof marked !== 'undefined') { try { return marked.parse(stripInternalTags(text)); } catch(e) { return stripInternalTags(text); } } return stripInternalTags(text).replace(/\n/g, '<br>'); }

// ==================== 版本化消息辅助函数 ====================
function getActiveVersion(msg) { if (msg.versions && msg.versions.length > 0) { const idx = msg.activeVersion || 0; const v = msg.versions[idx] || msg.versions[0] || {}; if (v.content === undefined && msg.content !== undefined) v.content = msg.content; if (v.thinking === undefined && msg.thinking !== undefined) v.thinking = msg.thinking; if (v.reasoning === undefined && msg.reasoning !== undefined) v.reasoning = msg.reasoning; if (v.time === undefined && msg.time !== undefined) v.time = msg.time; if (v.fullTime === undefined && msg.fullTime !== undefined) v.fullTime = msg.fullTime; if (v.model === undefined && msg.model !== undefined) v.model = msg.model; if (v.image === undefined && msg.image !== undefined) v.image = msg.image; if (v.toolCalls === undefined && msg.toolCalls !== undefined) v.toolCalls = msg.toolCalls; return v; } return msg; }
function normalizeMessageVersionFields(msg) { if (!msg) return msg; if (msg.versions && msg.versions.length > 0) { const idx = msg.activeVersion || 0; const v = msg.versions[idx] || msg.versions[0]; if (!v) return msg; if (v.content === undefined && msg.content !== undefined) v.content = msg.content; if (v.thinking === undefined && msg.thinking !== undefined) v.thinking = msg.thinking; if (v.reasoning === undefined && msg.reasoning !== undefined) v.reasoning = msg.reasoning; if (v.time === undefined && msg.time !== undefined) v.time = msg.time; if (v.fullTime === undefined && msg.fullTime !== undefined) v.fullTime = msg.fullTime; if (v.model === undefined && msg.model !== undefined) v.model = msg.model; if (v.image === undefined && msg.image !== undefined) v.image = msg.image; if (v.toolCalls === undefined && msg.toolCalls !== undefined) v.toolCalls = msg.toolCalls; return msg; } ensureVersioned(msg); return msg; }
function extractThinkingFromContent(content) {
    if (!content) return { thinking: '', visibleContent: '' };

    const tagRe = /<(think|thinking|chain_of_thought|reasoning)>([\s\S]*?)<\/\1>/gi;
    const thinkingParts = [];
    let visibleContent = content.replace(tagRe, function(_, tag, inner) {
        const trimmed = inner.trim();
        if (trimmed) thinkingParts.push(trimmed);
        return '';
    });

    const openTagRe = /<(think|thinking|chain_of_thought|reasoning)>/gi;
    let openMatch;
    let lastOpenMatch = null;
    while ((openMatch = openTagRe.exec(visibleContent)) !== null) {
        lastOpenMatch = openMatch;
    }

    if (lastOpenMatch) {
        const openTagStart = lastOpenMatch.index;
        const openTagEnd = openTagStart + lastOpenMatch[0].length;
        const tagName = lastOpenMatch[1];
        const afterOpenTag = visibleContent.slice(openTagEnd);
        const closeTag = new RegExp('</' + tagName + '>', 'i');
        if (!closeTag.test(afterOpenTag)) {
            const partialThinking = afterOpenTag.trim();
            if (partialThinking) thinkingParts.push(partialThinking);
            visibleContent = visibleContent.slice(0, openTagStart);
        }
    }

    const tagNames = ['think', 'thinking', 'chain_of_thought', 'reasoning'];
    const lastLt = visibleContent.lastIndexOf('<');
    if (lastLt !== -1) {
        const suffix = visibleContent.slice(lastLt + 1);
        const isPartial = suffix === '' || tagNames.some(function(tagName) {
            return tagName.startsWith(suffix);
        });
        if (isPartial) visibleContent = visibleContent.slice(0, lastLt);
    }

    return {
        thinking: thinkingParts.join('\n\n'),
        visibleContent: visibleContent.trim()
    };
}
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
let _lastResyncAt = 0;
let _wsConnectedOnce = false;
function connectWebSocket() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    _ws = new WebSocket(proto + '//' + location.host);
    _ws.onopen = () => {
        _ws.send(JSON.stringify({ type: 'register', tabId: SYZYGY_TAB_ID }));
        // 首次连接由 startSystem() 的 syncFromCloud 负责，这里只处理"重连"
        if (_wsConnectedOnce) resyncIfStale('ws-reconnect');
        _wsConnectedOnce = true;
    };
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
        case 'trace_event':
        case 'trace_done': handleTraceWS(msg); break;
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

let _isStreamingReply = false;
let _renderDeferred = false;

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

        // 迁移旧消息：把顶层thinking/reasoning迁入active version
        for (const s of chatSessions) { if (!s.messages) continue; for (const m of s.messages) { normalizeMessageVersionFields(m); } }

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
        console.error('[sync] load failed:', e.message);
        // Never wipe in-memory data. On first load, keep trying.
        if (!chatSessions || !chatSessions.length) {
            suppliers    = [{ name: "默认接口", url: "https://api.dzzi.ai/v1", key: "" }];
            chatSessions = [{ id: 'main', name: '加载中...（请刷新）', messages: [{
                role: 'assistant',
                versions: [{ content: '数据加载失败，请刷新页面重试。', fullTime: new Date().toISOString(), time: new Date().toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit'}) }],
                activeVersion: 0
            }] }];
            // Retry in 3s
            setTimeout(syncFromCloud, 3000);
        }
        renderSuppliers();
        renderChatSidebar();
        renderChatMessages();

        const viewTitle = document.getElementById('chatViewTitle');
        if (viewTitle) viewTitle.innerText = '通讯 · 主频道';
    }
}

let _saveTimer = null;
// 🧹 清理超过 5 轮的老图片，只保留文本（同时清理 v.image 和 v.images）
// 🧹 清理超过 5 轮的老图片，只保留文本
// 兼容: message.image / message.images / versions[].image / versions[].images
function cleanupOldImages(session) {
    if (!session || !session.messages) return;
    let imgCount = 0;

    for (let i = session.messages.length - 1; i >= 0; i--) {
        const m = session.messages[i];
        if (m.role !== 'user') continue;

        const hasImage = !!(
            m.image ||
            (Array.isArray(m.images) && m.images.length) ||
            (m.versions && m.versions.some(v =>
                v.image || (Array.isArray(v.images) && v.images.length)
            ))
        );
        if (!hasImage) continue;

        imgCount++;
        if (imgCount > 5) {
            delete m.image;
            delete m.images;
            if (m.versions) {
                m.versions.forEach(v => {
                    delete v.image;
                    delete v.images;
                });
            }
        }
    }
}

let _saveFailCount = 0;
let _lastSaveError = '';
function _showSaveWarning(show, errMsg) {
    let el = document.getElementById('saveWarning');
    if (show) {
        if (errMsg) _lastSaveError = errMsg;
        if (!el) {
            el = document.createElement('div');
            el.id = 'saveWarning';
            el.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(255,82,82,0.92);color:#fff;padding:6px 16px;border-radius:20px;font-size:12px;z-index:9999;white-space:nowrap;pointer-events:none;';
            document.body.appendChild(el);
        }
        el.textContent = '⚠️ 同步失败: ' + (_lastSaveError || '未知错误');
        el.style.display = 'block';
    } else if (el) {
        el.style.display = 'none';
    }
}

// ⚠️ stripImagesForCloudSync 保留为公共函数，但 _doSave 不再使用
// 如果需要完全剥离所有轮次图片，仍可调用此函数
function stripImagesForCloudSync(sessions) {
    return sessions.map(session => ({
        ...session,
        messages: (session.messages || []).map(msg => ({
            ...msg,
            versions: (msg.versions || []).map(v => {
                const next = { ...v };
                delete next.image;
                delete next.images;
                return next;
            })
        }))
    }));
}

// 统计 sessions 中当前保留的图片轮次数
function _countImgRounds(sessions) {
    let n = 0;
    for (const s of sessions) {
        if (!s.messages) continue;
        for (const m of s.messages) {
            if (m.role !== 'user') continue;
            if (m.image || (Array.isArray(m.images) && m.images.length)) { n++; continue; }
            if (m.versions && m.versions.some(function(v){ return v.image || (Array.isArray(v.images) && v.images.length); })) { n++; }
        }
    }
    return n;
}

// 从 sessions 副本中移除最旧一个图片轮次的图片字段（不删消息文本）
// 返回 true 表示移除了一轮，false 表示已无可移除的图片
function _stripOldestImgRound(sessions) {
    for (var si = 0; si < sessions.length; si++) {
        var s = sessions[si];
        if (!s.messages) continue;
        for (var mi = 0; mi < s.messages.length; mi++) {
            var m = s.messages[mi];
            if (m.role !== 'user') continue;
            var stripped = false;
            if (m.image) { delete m.image; stripped = true; }
            if (Array.isArray(m.images) && m.images.length) { delete m.images; stripped = true; }
            if (m.versions) {
                for (var vi = 0; vi < m.versions.length; vi++) {
                    var v = m.versions[vi];
                    if (v.image) { delete v.image; stripped = true; }
                    if (Array.isArray(v.images) && v.images.length) { delete v.images; stripped = true; }
                }
            }
            if (stripped) return true;
        }
    }
    return false;
}

function mergeSyncEnabled() {
    return localStorage.getItem('syzygy_merge_sync') !== 'false';
}

// ===== 同步合并工具 =====

// 本会话内被用户删除过的频道 id，防止合并时把已删除频道从服务端复活
const _deletedSessionIds = new Set();

function msgSortTime(m) {
    const v = getActiveVersion(m);
    return v.fullTime || '';
}

// 消息唯一键：优先 fullTime，缺失则退化为 role + 正文前 60 字
function msgKey(m) {
    const v = getActiveVersion(m);
    if (v.fullTime) return 'T' + v.fullTime;
    let c = v.content;
    if (Array.isArray(c)) {
        c = c.filter(function (p) { return p.type === 'text'; })
             .map(function (p) { return p.text || ''; }).join(' ');
    }
    if (typeof c !== 'string') c = '';
    return 'C' + m.role + '|' + c.substring(0, 60);
}

// 合并两条消息数组，按 key 去重，按时间排序
function mergeMessageLists(serverMsgs, localMsgs) {
    const out = [];
    const seen = new Map(); // key -> out 中的下标

    function push(m) {
        if (!m) return;
        const k = msgKey(m);
        if (seen.has(k)) {
            const i = seen.get(k);
            if (getVersionCount(m) > getVersionCount(out[i])) out[i] = m;
            return;
        }
        seen.set(k, out.length);
        out.push(m);
    }

    (serverMsgs || []).forEach(push);
    (localMsgs || []).forEach(push);

    let last = '';
    const keyed = out.map(function (m, i) {
        let t = msgSortTime(m);
        if (!t) t = last; else last = t;
        return { m: m, t: t, i: i };
    });
    keyed.sort(function (a, b) {
        if (a.t === b.t) return a.i - b.i;
        return a.t < b.t ? -1 : 1;
    });
    return keyed.map(function (x) { return x.m; });
}

// 合并频道列表
function mergeSessionLists(serverSessions, localSessions) {
    const map = new Map();
    (serverSessions || []).forEach(function (s) {
        if (!s || !s.id) return;
        if (_deletedSessionIds.has(s.id)) return;
        map.set(s.id, { ...s, messages: s.messages || [] });
    });
    (localSessions || []).forEach(function (ls) {
        if (!ls || !ls.id) return;
        const ss = map.get(ls.id);
        if (!ss) { map.set(ls.id, ls); return; }
        map.set(ls.id, {
            ...ss,
            name: ls.name || ss.name,
            messages: mergeMessageLists(ss.messages, ls.messages || [])
        });
    });
    const order = [];
    (serverSessions || []).forEach(function (s) {
        if (s && s.id && !_deletedSessionIds.has(s.id)) order.push(s.id);
    });
    (localSessions || []).forEach(function (s) {
        if (s && s.id && order.indexOf(s.id) === -1) order.push(s.id);
    });
    return order.map(function (id) { return map.get(id); }).filter(Boolean);
}

// ===== 重同步与合并 =====

let _syncing = false;
let _syncingPromise = null;

// 从服务端拉取并与本地合并。返回 { serverAdded, localOnly } 或 null
async function resyncAndMerge(reason) {
    if (_syncing) return await _syncingPromise;
    _syncing = true;
    _syncingPromise = (async () => {
    try {
        const r = await fetch('/api/sync-config', { cache: 'no-store' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const data = await r.json();
        const serverSessions = data.chatSessions || [];

        let serverAdded = 0, localOnly = 0;
        const localById = {};
        (chatSessions || []).forEach(function (s) { if (s && s.id) localById[s.id] = s; });
        serverSessions.forEach(function (ss) {
            if (_deletedSessionIds.has(ss.id)) return;
            const ls = localById[ss.id];
            const localKeys = new Set(((ls && ls.messages) || []).map(msgKey));
            (ss.messages || []).forEach(function (m) { if (!localKeys.has(msgKey(m))) serverAdded++; });
            const serverKeys = new Set((ss.messages || []).map(msgKey));
            ((ls && ls.messages) || []).forEach(function (m) { if (!serverKeys.has(msgKey(m))) localOnly++; });
        });

        chatSessions = mergeSessionLists(serverSessions, chatSessions);
        _dataVersion = data._version || 0;

        for (const s of chatSessions) {
            if (!s.messages) continue;
            for (const m of s.messages) normalizeMessageVersionFields(m);
        }
        if (!chatSessions.find(function (s) { return s.id === activeChatId; })) {
            activeChatId = chatSessions[0] ? chatSessions[0].id : 'main';
        }

        renderChatSidebar();
        renderChatMessages();

        console.log('[resync] reason=' + reason + ' serverAdded=' + serverAdded +
                    ' localOnly=' + localOnly + ' version=' + _dataVersion);
        if (serverAdded > 0) toast('已补回 ' + serverAdded + ' 条消息');
        return { serverAdded: serverAdded, localOnly: localOnly };
    } catch (e) {
        console.error('[resync] 失败: ' + e.message);
        return null;
    } finally {
        _syncing = false;
        _syncingPromise = null;
    }
    })();
    return await _syncingPromise;
}

async function resyncIfStale(reason) {
    if (!mergeSyncEnabled()) return;
    if (Date.now() - _lastResyncAt < 5000) return;   // 5 秒内不重复拉
    _lastResyncAt = Date.now();
    const res = await resyncAndMerge(reason);
    // 本地有服务端没有的消息，立刻补存回去
    if (res && res.localOnly > 0) saveToCloud(true);
}

async function _doSave() {
    // Never save if we haven't loaded cloud data yet (prevents wiping real data with empty state)
    if (!_dataVersion) {
        console.warn('[sync-config] 云端数据未加载，先尝试拉取');
        await resyncAndMerge('pre-save-bootstrap');
        if (!_dataVersion) {
            _showSaveWarning(true, '云端数据未加载，暂不保存，请刷新页面');
            throw new Error('云端数据未加载');
        }
    }
    var MAX_SYNC_BYTES = 15 * 1024 * 1024; // 15 MB

    // 1. 深拷贝 chatSessions — 不影响内存中的原始数据
    var clone;
    try { clone = structuredClone(chatSessions); } catch (_e) { clone = JSON.parse(JSON.stringify(chatSessions)); }

    // 2. 常规处理
    for (var si = 0; si < clone.length; si++) {
        var s = clone[si];
        if (!s.messages) continue;
        cleanupOldImages(s);
        s.messages = s.messages.slice(-200);
        for (var mi = 0; mi < s.messages.length; mi++) {
            var m = s.messages[mi];
            if (m.versions && m.versions.length > 5) {
                m.versions = [m.versions[0], ...m.versions.slice(-4)];
                if (m.activeVersion >= m.versions.length) m.activeVersion = m.versions.length - 1;
            }
            delete m._zepDirty;
        }
    }

    // 3. 构造 payload
    var payloadObj = { suppliers: suppliers, chatSessions: clone, activeSupIndex: activeSupIndex, activeChatId: activeChatId, _version: _dataVersion };
    var payloadText = JSON.stringify(payloadObj);
    var payloadBytes = new Blob([payloadText]).size;

    // 4. 超过 15 MB → 从最旧的图片轮次开始逐轮移除
    if (payloadBytes > MAX_SYNC_BYTES) {
        console.warn('[sync-config] payload 超 15 MB (' + (payloadBytes / 1024 / 1024).toFixed(1) + ' MB)，逐轮移除最旧图片');
        while (payloadBytes > MAX_SYNC_BYTES && _stripOldestImgRound(clone)) {
            payloadText = JSON.stringify(payloadObj);
            payloadBytes = new Blob([payloadText]).size;
        }
        if (payloadBytes > MAX_SYNC_BYTES) {
            console.error('[sync-config] 逐轮移除后仍超 15 MB (' + (payloadBytes / 1024 / 1024).toFixed(1) + ' MB)，最新图片过大');
            throw new Error('最新图片过大，云端同步失败。请减少图片或清理旧频道后重试。');
        }
    }

    var keptRounds = _countImgRounds(clone);
    console.log('[sync-config] ' + (payloadBytes / 1024 / 1024).toFixed(2) + ' MB, 保留 ' + keptRounds + ' 个图片轮次');

    // 5. 发送
    var r = await fetch('/api/sync-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payloadText
    });
    if (!r.ok) {
        var text = await r.text().catch(function(){ return ''; });
        var hint = 'HTTP ' + r.status;
        if (r.status === 413) { hint += ' 数据仍过大，请清理旧频道或刷新页面'; }
        else if (r.status === 403) { hint += text.indexOf('Origin') >= 0 ? ' 当前访问域名不在允许列表' : ' 请求被代理或安全规则拒绝: ' + text.slice(0, 100); }
        else { hint += ' ' + text.slice(0, 200); }
        throw new Error(hint);
    }
    var d = await r.json();
    if (d._rejected) {
        if (mergeSyncEnabled()) {
            console.warn('🛡️ [版本落后] 服务端有更新，拉取合并后重试');
            const res = await resyncAndMerge('version-conflict');
            if (!res) throw new Error('版本冲突且重新同步失败，稍后重试');
            throw new Error('版本冲突，已重新同步，重试保存');
        }
        // 开关关闭时不能静默成功
        throw new Error('版本落后，保存被拒绝，请刷新页面');
    }
    if (d._version) _dataVersion = d._version;
}

let _savingNow = false;
let _saveQueued = false;

function saveToCloud(immediate) {
    clearTimeout(_saveTimer);
    const doSave = async () => {
        if (_savingNow) { _saveQueued = true; return; }
        _savingNow = true;
        try {
            const delays = [1000, 2000, 4000]; // 指数退避
            for (let attempt = 0; attempt <= delays.length; attempt++) {
                try {
                    await _doSave();
                    _saveFailCount = 0;
                    _showSaveWarning(false);
                    return; // 成功
                } catch(e) {
                    _lastSaveError = e.message;
                    console.log('💾 [保存失败] 第' + (attempt + 1) + '次: ' + e.message);
                    if (attempt < delays.length) {
                        await new Promise(r => setTimeout(r, delays[attempt]));
                    }
                }
            }
            // 3 次重试全失败
            _saveFailCount++;
            const lastErr = _lastSaveError || '未知错误';
            console.error('❌ [保存] 重试耗尽: ' + lastErr);
            _showSaveWarning(true, lastErr);
        } finally {
            _savingNow = false;
            if (_saveQueued) { _saveQueued = false; saveToCloud(true); }
        }
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
    const map = { home:'sec-home', chat:'sec-chat', data:'sec-data', favorites:'sec-favorites', console:'sec-console', flo:'sec-flo', calendar:'sec-calendar', album:'sec-album', state:'sec-state' };
    const target = document.getElementById(map[viewId]);
    if (!target) return;
    target.classList.add("active"); document.body.dataset.view = viewId;
    const VIEWS = ['home','chat','data','favorites','console','flo','calendar','album','state'];
    document.body.classList.remove(...VIEWS.map(v => 'view-' + v));
    document.body.classList.add('view-' + viewId);
    if (viewId === 'chat') { setTimeout(() => { forceScrollToChatBottom && forceScrollToChatBottom(); }, 300); fetchPulseStatus(); }
    if (viewId === 'home') { updateDays && updateDays(); if ((document.body.classList.contains('neu-mode') || document.body.classList.contains('dark-gold-mode'))) neuInitHome(); }
    if (viewId === 'favorites') loadAndRenderFavorites();
    if (viewId === 'console') { const tab = localStorage.getItem('syzygy_console_tab') || 'logs'; switchConsoleTab(tab); if (tab === 'terminal') consoleOpen(); }
    if (viewId === 'flo') floRender();
    if (viewId === 'calendar') calRender();
    if (viewId === 'album') { albumInitMonthFilter(); albumLoad(); }
    if (viewId === 'state') stateRender();
    if ((document.body.classList.contains('neu-mode') || document.body.classList.contains('dark-gold-mode'))) neuUpdateNav();
}

// ==================== 控制台 Tab 切换 ====================
function switchConsoleTab(name) {
    const tabs = { terminal: 'consoleTabTerminal', trace: 'consoleTabTrace', logs: 'consoleTabLogs' };
    const panes = { terminal: 'consolePaneTerminal', trace: 'consolePaneTrace', logs: 'consolePaneLogs' };
    // 切换按钮 active
    Object.entries(tabs).forEach(([k, id]) => {
        const btn = document.getElementById(id);
        if (btn) btn.classList.toggle('active', k === name);
    });
    // 切换面板显示
    Object.entries(panes).forEach(([k, id]) => {
        const pane = document.getElementById(id);
        if (pane) pane.style.display = k === name ? 'block' : 'none';
    });
    localStorage.setItem('syzygy_console_tab', name);
    // 切到日志/链路 tab 时加载
    if (name === 'logs') loadRawLogs();
    if (name === 'trace') loadTraces();
    // 切换时清理非活跃 tab 的定时器
    if (name !== 'logs') { clearInterval(_logAutoTimer); _logAutoTimer = null; }
    if (name !== 'trace') { clearInterval(_traceAutoTimer); _traceAutoTimer = null; }
}

// ==================== 原始日志 ====================
let _logAutoTimer = null;
function loadRawLogs() {
    let pwd = localStorage.getItem('memoryPwd');
    if (!pwd) { pwd = prompt('管理密码:'); if (!pwd) return; localStorage.setItem('memoryPwd', pwd); }
    const filter = document.getElementById('logFilterInput')?.value || '';
    const url = '/debug-console?n=200&pwd=' + encodeURIComponent(pwd) + (filter ? '&filter=' + encodeURIComponent(filter) : '');
    fetch(url).then(r => r.json()).then(data => {
        const pre = document.getElementById('logOutput');
        if (!pre) return;
        pre.innerHTML = ''; // 清空后逐行用 textContent 追加，避免 XSS
        (data.entries || []).forEach(e => {
            const line = document.createElement('span');
            const t = e.t ? new Date(e.t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
            line.textContent = '[' + t + '] [' + (e.l || 'LOG') + '] ' + (e.m || '');
            if (e.l === 'WARN') line.style.color = '#e67e22';
            else if (e.l === 'ERROR') line.style.color = '#e74c3c';
            pre.appendChild(line);
            pre.appendChild(document.createTextNode('\n'));
        });
        pre.scrollTop = pre.scrollHeight;
    }).catch(() => {});
}
let _logFilterTimer = null;
function logFilterDebounce() { clearTimeout(_logFilterTimer); _logFilterTimer = setTimeout(loadRawLogs, 400); }
function toggleLogAutoRefresh() {
    const cb = document.getElementById('logAutoRefresh');
    if (cb && cb.checked) {
        _logAutoTimer = setInterval(loadRawLogs, 5000);
    } else {
        clearInterval(_logAutoTimer); _logAutoTimer = null;
    }
}

// ==================== 对话链路 ====================
let _traceCache = [];
let _traceAutoTimer = null;
let _traceWsTimer = null;

function escHtml(s) { const d = document.createElement('div'); d.textContent = (s == null ? '' : String(s)); return d.innerHTML; }

async function loadTraces() {
    let pwd = localStorage.getItem('memoryPwd');
    if (!pwd) { pwd = prompt('管理密码:'); if (!pwd) return; localStorage.setItem('memoryPwd', pwd); }
    try {
        const r = await fetch('/api/traces?n=30&pwd=' + encodeURIComponent(pwd));
        if (!r.ok) return;
        const data = await r.json();
        _traceCache = data.traces || [];
        document.getElementById('traceCount').textContent = '共 ' + (data.total || _traceCache.length) + ' 条';
        renderTraceList();
    } catch(e) {}
}

function renderTraceList() {
    const list = document.getElementById('traceList');
    if (!list) return;
    list.innerHTML = '';
    _traceCache.forEach(function(t) {
        const row = document.createElement('div');
        row.className = 'trace-row' + (t.ok === false ? ' trace-error' : '');
        const time = new Date(t.startedAtISO).toLocaleTimeString('zh-CN', { hour12: false });
        const dur = t.durationMs === undefined ? '—' : (t.durationMs >= 1000 ? (t.durationMs / 1000).toFixed(1) + 's' : t.durationMs + 'ms');
        const icon = t.ok === false ? '✕' : (t.done ? '✓' : '⋯');
        const iconCls = t.ok === false ? 'trace-icon-err' : (t.done ? 'trace-icon-ok' : 'trace-icon-pending');
        const model = (t.meta?.model || '').substring(0, 24);
        const preview = escHtml((t.meta?.userPreview || '').substring(0, 40));
        row.innerHTML = '<span class="' + iconCls + '">' + icon + '</span> ' +
            time + '  <b>' + preview + '</b>' +
            '  <span style="color:#888">' + dur + '</span>' +
            '  ' + escHtml(model) +
            '  <span style="color:#666">' + (t.eventCount || 0) + '事件</span>' +
            (t.ok === false ? '<div style="font-size:0.8rem;color:#e74c3c;margin-left:20px">' + escHtml(t.error || '') + '</div>' : '');
        row.onclick = function() { openTrace(t.id); };
        list.appendChild(row);
    });
}

function formatEventSummary(ev) {
    const d = ev.detail;
    if (!d) return '(无详情)';
    switch (ev.phase) {
        case 'start':
            return '消息 ' + (d.msgCount || 0) + ' 条';
        case 'recall': {
            let s = '核心 ' + (d.coreLen||0) + '字 · 长期 ' + (d.longTermLen||0) + '字 · RP ' + (d.rpLen||0) + '字 · 浮现 ' + (d.unresolvedLen||0) + '字 · 原文 ' + (d.transcriptLen||0) + '字';
            if (ev.ms > 5000) s += ' <span style="color:#e74c3c;font-weight:bold">⚠ 耗时 ' + (ev.ms/1000).toFixed(1) + 's</span>';
            return s;
        }
        case 'dedup':
            return (d.blocks || []).map(function(b) { return escHtml(b.label) + ' ' + b.len; }).join(' · ');
        case 'budget': {
            let s = '上限 ' + d.maxTokens + ' · 用了 ' + d.usedTokens + ' · 保留 ' + d.kept + ' 条 · 丢弃 ' + d.dropped + ' 条';
            if (d.dropped > 0) s += ' <span style="color:#e74c3c">⚠</span>';
            return s;
        }
        case 'inject':
            if (ev.label === 'volatile 组装') {
                let s = '共 ' + (d.totalLen||0) + ' 字 · ' + (d.sections||[]).length + ' 个区块';
                if (d.sections && d.sections.length) s += '<br>' + d.sections.map(function(sec) { return escHtml(sec.key) + ':' + sec.len; }).join(' · ');
                return s;
            }
            if (ev.label === '最终 payload') {
                return 'stable ' + (d.stableTokens||0) + ' tok · history ' + (d.historyTokens||0) + ' tok · ' + (d.msgCount||0) + ' 条消息 · cache=' + (d.cacheControl||'none');
            }
            return JSON.stringify(d).substring(0, 120);
        case 'tools':
            return '全部 ' + (d.total||0) + ' → 筛选 ' + (d.filtered||0) + '：' + (d.names||[]).join(', ');
        case 'tool': {
            let s = escHtml(d.args||'') + ' → ' + (d.resultLen||0) + '字 · ' + (d.elapsed||0) + 'ms' + (d.mcp ? ' [MCP:' + escHtml(d.mcp) + ']' : '');
            const rp = d.resultPreview || '';
            if (rp.charAt(0) === '[' && (rp.indexOf('失败') >= 0 || rp.indexOf('error') >= 0 || rp.indexOf('Error') >= 0)) {
                s = '<span style="color:#e74c3c">' + s + '</span>';
            }
            return s;
        }
        case 'model': {
            const usage = pickUsage(d.usage);
            const input = usage ? usage.input : 0;
            const output = usage ? usage.output : 0;
            const cacheRead = usage ? usage.cacheRead : 0;
            const cacheWrite = usage ? (usage.cacheWrite || 0) : 0;
            const roundLabel = d.round != null ? ('第' + d.round + '轮') : '最终';
            let s = roundLabel + ' · HTTP ' + (d.status||'?') + ' · 输入 ' + input + ' / 输出 ' + output + ' · 缓存读 ' + cacheRead + ' 写 ' + cacheWrite + ' · ' + (d.cacheMode||'');
            if (input > 5000 && cacheRead === 0) s += ' <span style="color:#e67e22">⚠ 未命中缓存</span>';
            return s;
        }
        case 'memory_write': {
            let s = '"' + escHtml(d.preview||'') + '" tags=[' + (d.tags||[]).join(',') + ']' + (d.ttl ? ' ttl=' + escHtml(d.ttl) : '') + (d.reason ? ' · ' + escHtml(d.reason) : '');
            if ((ev.label||'').indexOf('被拦截') >= 0) s = '<span style="color:#e74c3c">' + s + '</span>';
            else if ((ev.label||'').indexOf('已写入') >= 0) s = '<span style="color:#27ae60">' + s + '</span>';
            return s;
        }
        case 'mood':
            return d.found !== undefined ? ('解析到 ' + d.found + ' 条') : (d.reason || '');
        case 'persist':
            return 'transcript 已写入' + (d.zepFailed ? ' · Zep 已废弃(预期失败)' : '');
        case 'album':
            return '匹配 ' + (d.matched||0) + ' 张 · 注入 ' + (d.injected||0) + ' 张';
        case 'dream':
            return ev.label || '';
        default:
            return JSON.stringify(d).substring(0, 120);
    }
}

function pickUsage(u) {
    if (!u) return null;
    const cu = (u.billing_usage && u.billing_usage.claude_usage) || {};
    return {
        input: u.prompt_tokens ?? u.input_tokens ?? 0,
        output: u.completion_tokens ?? 0,
        cacheRead: cu.cache_read_input_tokens ?? u.cache_read_input_tokens ?? (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) ?? 0,
        cacheWrite: cu.cache_creation_input_tokens ?? u.cache_creation_input_tokens ?? 0
    };
}

async function openTrace(id) {
    let pwd = localStorage.getItem('memoryPwd');
    if (!pwd) { pwd = prompt('管理密码:'); if (!pwd) return; localStorage.setItem('memoryPwd', pwd); }
    try {
        const r = await fetch('/api/traces/' + id + '?pwd=' + encodeURIComponent(pwd));
        if (r.status === 404) { toast('该 trace 已被环形缓冲挤出'); return; }
        const t = await r.json();
        const detail = document.getElementById('traceDetail');
        if (!detail) return;
        const PHASES = { start: '#95a5a6', recall: '#3498db', dedup: '#3498db', budget: '#9b59b6', inject: '#9b59b6', tools: '#1abc9c', tool: '#1abc9c', model: '#e67e22', memory_write: '#f1c40f', mood: '#e91e63', persist: '#95a5a6', dream: '#9b59b6', album: '#1abc9c' };
        let html = '<div style="padding:12px;border:1px solid #444;border-radius:8px;margin-bottom:16px">';
        html += '<b>完整时间</b>: ' + escHtml(t.startedAtISO) + '<br>';
        html += '<b>模型</b>: ' + escHtml(t.meta?.model || '') + ' · <b>' + (t.meta?.stream ? '流式' : '非流式') + '</b> · path=' + escHtml(t.path||'') + '<br>';
        html += '<b>耗时</b>: ' + (t.durationMs||0) + 'ms · <b>回复字数</b>: ' + (t.replyLen||0) + ' · <b>tabId</b>: ' + escHtml(t.meta?.tabId||'') + '<br>';
        html += '<button class="console-action" onclick="document.getElementById(\'traceDetail\').style.display=\'none\'" style="margin-top:8px">关闭</button>';
        html += '</div><div style="padding-left:8px">';
        (t.events||[]).forEach(function(ev) {
            const msLabel = ev.ms >= 1000 ? ('+' + (ev.ms/1000).toFixed(1) + 's') : ('+' + ev.ms + 'ms');
            const phaseClr = PHASES[ev.phase] || '#888';
            html += '<div class="trace-event" style="margin-bottom:10px;cursor:pointer" onclick="var p=this.nextElementSibling;p.style.display=p.style.display===\'none\'?\'block\':\'none\'">';
            html += '<span style="color:#888;width:70px;display:inline-block">' + msLabel + '</span>';
            html += '<span style="background:' + phaseClr + ';color:#fff;padding:1px 6px;border-radius:3px;font-size:0.8rem;margin-right:6px">' + escHtml(ev.phase) + '</span>';
            html += '<span>' + escHtml(ev.label) + '</span>';
            html += '<div style="color:#aaa;font-size:0.85rem;margin-left:70px">' + formatEventSummary(ev) + '</div>';
            html += '</div>';
            html += '<pre class="trace-detail-json" style="display:none;margin-left:70px;font-size:0.8rem;background:#1a1a1a;color:#aaa;padding:8px;border-radius:4px;max-height:300px;overflow:auto">' + escHtml(JSON.stringify(ev.detail, null, 2)) + '</pre>';
        });
        html += '</div>';
        detail.innerHTML = html;
        detail.style.display = 'block';
        detail.scrollIntoView({ behavior: 'smooth' });
    } catch(e) { toast('加载失败: ' + e.message); }
}

function toggleTraceAutoRefresh() {
    const cb = document.getElementById('traceAutoRefresh');
    if (cb && cb.checked) {
        _traceAutoTimer = setInterval(loadTraces, 5000);
    } else {
        clearInterval(_traceAutoTimer); _traceAutoTimer = null;
    }
}

function handleTraceWS(msg) {
    const pane = document.getElementById('consolePaneTrace');
    if (!pane || pane.style.display === 'none') return;
    if (document.body.dataset.view !== 'console') return;
    clearTimeout(_traceWsTimer);
    _traceWsTimer = setTimeout(loadTraces, 800);
}

// ==================== VPS 控制台 ====================
let consoleSocket = null;
let consoleOpening = false;

function consoleSetStatus(text, state) {
    const el = document.getElementById('consoleStatus');
    if (!el) return;
    el.textContent = text;
    el.dataset.state = state || '';
}

function consoleWrite(text, type) {
    const output = document.getElementById('consoleOutput');
    if (!output) return;
    const line = document.createElement('span');
    line.className = type ? 'console-line console-' + type : 'console-line';
    // SSH 输出可能含 ANSI 控制符；本页以安全纯文本显示，避免任何 HTML 被执行。
    line.textContent = String(text).replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, '');
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
}

async function consoleOpen() {
    if (consoleSocket && (consoleSocket.readyState === WebSocket.OPEN || consoleSocket.readyState === WebSocket.CONNECTING)) return;
    if (consoleOpening) return;
    consoleOpening = true;
    consoleSetStatus('检查配置…', 'loading');
    try {
        const res = await fetch('/api/console/status', { cache: 'no-store' });
        const info = await res.json();
        const name = document.getElementById('consoleServerName');
        if (name) name.textContent = info.label || 'VPS 控制台';
        if (!res.ok || !info.enabled) {
            consoleSetStatus('尚未配置', 'error');
            consoleWrite(info.error || '控制台尚未在服务器上配置。', 'notice');
            return;
        }
        consoleConnect();
    } catch (_) {
        consoleSetStatus('状态检查失败', 'error');
        consoleWrite('无法确认控制台状态，请检查网络后重试。', 'notice');
    } finally {
        consoleOpening = false;
    }
}

function consoleConnect() {
    if (consoleSocket && consoleSocket.readyState === WebSocket.OPEN) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    consoleSetStatus('连接中…', 'loading');
    consoleSocket = new WebSocket(proto + '//' + location.host + '/ws/console');
    consoleSocket.onopen = () => {
        consoleSetStatus('正在建立 SSH…', 'loading');
        consoleSocket.send(JSON.stringify({ type: 'resize', cols: 100, rows: 30 }));
    };
    consoleSocket.onmessage = (event) => {
        let message;
        try { message = JSON.parse(event.data); } catch (_) { return; }
        if (message.type === 'ready') {
            consoleSetStatus('已连接', 'ready');
            document.getElementById('consoleInput')?.focus();
        } else if (message.type === 'output') {
            consoleWrite(message.data);
        } else if (message.type === 'error') {
            consoleSetStatus('连接失败', 'error');
            consoleWrite(message.message || '控制台连接失败。', 'notice');
        }
    };
    consoleSocket.onclose = () => {
        if (document.body.dataset.view === 'console') consoleSetStatus('已断开', 'error');
        consoleSocket = null;
    };
    consoleSocket.onerror = () => { consoleSetStatus('连接失败', 'error'); };
}

function consoleReconnect() {
    if (consoleSocket) consoleSocket.close();
    const output = document.getElementById('consoleOutput');
    if (output) output.replaceChildren();
    consoleOpen();
}

function consoleSendInput() {
    const input = document.getElementById('consoleInput');
    if (!input || !input.value || !consoleSocket || consoleSocket.readyState !== WebSocket.OPEN) return;
    consoleSocket.send(JSON.stringify({ type: 'input', data: input.value + '\n' }));
    input.value = '';
    input.style.height = '';
}

document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('consoleInput');
    if (!input) return;
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); consoleSendInput(); }
    });
    input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; });
});
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

let _isOpeningArchiveRoom = false;
function openStarCrossing() {
    if (_isOpeningArchiveRoom) return;
    _isOpeningArchiveRoom = true;

    // 即时视觉反馈：点亮入口卡片
    const btn = document.querySelector('[onclick*="openStarCrossing"]');
    if (btn) btn.style.opacity = '0.6';

    let pwd = localStorage.getItem('memoryPwd');
    if (!pwd) {
        pwd = prompt('星渡访问密码:');
        if (!pwd) {
            _isOpeningArchiveRoom = false;
            if (btn) btn.style.opacity = '';
            return;
        }
        localStorage.setItem('memoryPwd', pwd);
    }

    window.location.assign('/memory-manager.html?tab=archive&pwd=' + encodeURIComponent(pwd));
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
        list.innerHTML = '<div class="neu-todo-empty" style="font-size:13px;padding:4px 0;">暂无待办 — 点 + 添加</div>';
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
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            let hint = 'HTTP ' + response.status;
            if (response.status === 413) {
                hint = '图片或本次请求仍然太大，请减少图片数量（413）';
            } else if (response.status === 403) {
                if (text.includes('Origin')) {
                    hint = '当前访问域名不在允许列表（403 Origin）';
                } else {
                    hint = '请求被代理或安全规则拒绝（403）: ' + text.slice(0, 100);
                }
            } else {
                hint += ' ' + text.slice(0, 100);
            }
            return { reply: '【' + hint + '】', thinking: '' };
        }
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

function escapeToolHtml(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderToolCallGroupHTML(toolCalls, isStreaming) {
    if (!toolCalls || toolCalls.length === 0) return '';
    var totalMs = 0;
    for (var i = 0; i < toolCalls.length; i++) { totalMs += (toolCalls[i].elapsed || 0); }
    var totalStr = totalMs >= 1000 ? (totalMs / 1000).toFixed(1) + 's' : totalMs + 'ms';
    var label = isStreaming ? '正在调用工具 · <strong>' + toolCalls.length + '</strong>' : '调用了 <strong>' + toolCalls.length + '</strong> 次工具';
    var html = '<div class="tool-call-group">';
    html += '<div class="tool-call-group-summary tool-collapsed" onclick="var g=this.parentElement;var l=g.querySelector(\'.tool-call-group-list\');var s=l.style.display;l.style.display=s===\'none\'?\'block\':\'none\';g.classList.toggle(\'tool-expanded\',s===\'none\');this.classList.toggle(\'tool-collapsed\',s!==\'none\')">';
    html += '<span class="tool-call-group-chevron">▸</span>';
    html += '<span class="tool-call-group-label">' + label + '</span>';
    html += '<span class="tool-call-group-total">' + totalStr + '</span>';
    html += '</div>';
    html += '<div class="tool-call-group-list" style="display:none">';
    for (var i = 0; i < toolCalls.length; i++) {
        var tc = toolCalls[i];
        var argsPreview = '{}';
        try { argsPreview = JSON.stringify(tc.arguments || {}).substring(0, 80); } catch (e) { argsPreview = '{}'; }
        var itemMs = tc.elapsed || 0;
        var itemTime = itemMs >= 1000 ? (itemMs / 1000).toFixed(1) + 's' : itemMs + 'ms';
        html += '<div class="tool-call-item">';
        html += '<div class="tool-call-item-header tool-collapsed" onclick="event.stopPropagation();var r=this.nextElementSibling;r.style.display=r.style.display===\'none\'?\'block\':\'none\';this.classList.toggle(\'tool-collapsed\')">';
        html += '<span class="tool-call-item-chevron">▸</span>';
        html += '<span class="tool-call-item-name">' + escHtml(tc.name || '') + '</span>';
        html += '<span class="tool-call-item-args">' + escHtml(argsPreview) + '</span>';
        html += '<span class="tool-call-item-time">' + itemTime + '</span>';
        html += '</div>';
        html += '<div class="tool-call-item-body" style="display:none"><pre>' + escHtml((tc.result || '').substring(0, 2000)) + '</pre></div>';
        html += '</div>';
    }
    html += '</div></div>';
    return html;
}

function updateToolGroupDOM(el, toolCalls, isStreaming) {
    el.innerHTML = renderToolCallGroupHTML(toolCalls, isStreaming);
}

function renderChatMessages(){
    if (_isStreamingReply) { _renderDeferred = true; return; }
    const win = document.getElementById('chatWindow');
    if(!win) return;
    win.innerHTML = '';
    const session = getActiveSession();
    if(!session || !session.messages) return;

    // 手机端限制渲染最近 30 条，防止大量长消息 DOM 触发 Safari 崩溃
    const msgs = session.messages.slice(-30);
    msgs.forEach((m, subIndex) => {
        const index = session.messages.length - msgs.length + subIndex;
        const v = getActiveVersion(m);
        const vCount = getVersionCount(m);
        const vIdx = getActiveVersionIndex(m);

        const rowDiv = document.createElement('div');
        rowDiv.className = 'msg-row ' + (m.role === 'user' ? 'user' : 'sys');
        rowDiv.setAttribute('data-msg-index', index);

        const div = document.createElement('div');
        div.className = 'msg ' + (m.role === 'user' ? 'user' : 'sys');

        let htmlContent = '';
        // 📸 渲染消息附带的图片（支持多图）
        const imgsToRender = v.images || (v.image ? [v.image] : []);
        for (let imgIdx = 0; imgIdx < imgsToRender.length; imgIdx++) {
            htmlContent += '<img src="' + imgsToRender[imgIdx] + '" style="max-width:200px;border-radius:8px;margin-bottom:5px;margin-right:4px;box-shadow:0 2px 10px rgba(0,0,0,0.3);display:inline-block;">';
        }
        const rawThinking = v.thinking || v.reasoning || m.thinking || m.reasoning || '';
        // 兼容正文里混入 <thinking>...</thinking> 或 <think>...</think> 的旧格式
        let displayContent = v.content || '';
        let extractedThink = extractThinkingFromContent(displayContent);
        if (extractedThink.thinking) { displayContent = extractedThink.visibleContent; }
        const finalThinking = rawThinking || extractedThink.thinking || '';
        if(finalThinking) htmlContent += '<div class="think-box"><div class="think-header" onclick="var c=this.nextElementSibling;c.style.display=c.style.display===\'none\'?\'block\':\'none\';">🧠 深度思考过程 ▾</div><div class="think-content" style="display:none">' + finalThinking.replace(/\n/g,'<br>') + '</div></div>';
        // 渲染工具调用记录（整组折叠）
        if (v.toolCalls && v.toolCalls.length > 0) htmlContent += renderToolCallGroupHTML(v.toolCalls, false);
        if (m.role === 'user') {
            htmlContent += '<div>' + (displayContent || '').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>') + '</div>';
        } else {
            htmlContent += '<div class="md-content">' + renderMarkdown(displayContent || '') + '</div>';
        }

        const timeStr = v.fullTime ? new Date(v.fullTime).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}) : (v.time || '');
        const modelStr = v.model || '';
        if(timeStr) htmlContent += '<div class="msg-meta">' + timeStr + (modelStr ? ' · ' + modelStr : '') + '</div>';

        let actionsHtml = '<div class="msg-actions">';
        if(vCount > 1) {
            actionsHtml += '<div class="version-nav"><button class="ver-btn" onclick="switchVersion(' + index + ',-1)"' + (vIdx===0?' disabled':'') + '>‹</button><span class="ver-label">' + (vIdx+1) + ' / ' + vCount + '</span><button class="ver-btn" onclick="switchVersion(' + index + ',1)"' + (vIdx===vCount-1?' disabled':'') + '>›</button></div>';
        }
        if(m.role === 'user'){ actionsHtml += '<button class="msg-inline-btn" onclick="editUserMessage(' + index + ')" title="编辑">✎</button>'; actionsHtml += '<button class="msg-inline-btn" onclick="resendUserMessage(' + index + ')" title="重新发送">↻</button>'; }
        if(m.role === 'assistant'){
            if (m._failed || v._failed) {
                actionsHtml += '<button class="msg-inline-btn" onclick="retryLastMessage()" title="重发" style="color:#e74c3c">↻ 重发</button>';
            } else {
                actionsHtml += '<button class="msg-inline-btn" onclick="regenerateAt(' + index + ')" title="重新生成">↻</button>';
            }
            actionsHtml += '<button class="msg-inline-btn fav-star" id="favBtn_' + index + '" onclick="openFavDialog(' + index + ')" title="收藏">★</button>';
        }
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
    _deletedSessionIds.add(id);
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

async function sendChat(options = {}) {
    try {
    const reuseLastUser = !!options.reuseLastUser;
    const input = document.getElementById('chatInput');
    if(!input) return;

    const session = getActiveSession();
    const win = document.getElementById('chatWindow');

    let existingUserVersion = null;
    let val = input.value.trim();

    if (reuseLastUser) {
        const lastMsg = session.messages[session.messages.length - 1];
        if (!lastMsg || lastMsg.role !== 'user') return;

        existingUserVersion = getActiveVersion(lastMsg);
        val = (existingUserVersion.content || '').trim();

        if (!val && !(existingUserVersion.images && existingUserVersion.images.length) && !existingUserVersion.image) return;
    } else {
        if(!val && currentImgBase64List.length === 0) return;
        input.value = '';
    }

    // 💥 就在这里！Claude 让加的”侦察兵”
    console.log('val类型:', typeof val, '值:', val);
    console.log('currentImgBase64List:', currentImgBase64List.length);
    console.log('reuseLastUser:', reuseLastUser);

    await flushDirtyToZep(session);

    if (!reuseLastUser) {

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

    // 📸 保存压缩后的图片到版本记录（保留最近 5 轮可查看/重新生成）
    const savedImages = currentImgBase64List.length > 0 ? [...currentImgBase64List] : null;
    session.messages.push({ role: 'user', versions: [{ content: val, fullTime: new Date().toISOString(), image: savedImages ? savedImages[0] : undefined, images: savedImages }], activeVersion: 0 });
    saveToCloud(true);  // 立即保存，不延迟

    }  // end if (!reuseLastUser)

    // 💥 1. 准备图片：复用模式从版本取，普通模式从相册取
    var imgsToSend = [];
    if (reuseLastUser) {
        if (existingUserVersion.images && existingUserVersion.images.length > 0) {
            imgsToSend = [...existingUserVersion.images];
        } else if (existingUserVersion.image) {
            imgsToSend = [existingUserVersion.image];
        }
    } else {
        imgsToSend = [...currentImgBase64List];
        clearImage();
    }

    // 📏 早退检查：必须在创建 sDiv 之前，避免孤儿气泡
    if (imgsToSend.length > 0) {
        let totalImgBytes = 0;
        for (const img of imgsToSend) totalImgBytes += dataUrlByteSize(img);
        if (totalImgBytes > MAX_TOTAL_IMG_BYTES) {
            toast('图片总大小 ' + (totalImgBytes / 1024 / 1024).toFixed(1) + ' MB 超过上限（12 MB），请减少图片数量');
            currentImgBase64List = imgsToSend; updateImagePreview();
            return;
        }
    }
    const currentSup = suppliers[activeSupIndex];
    if(!currentSup) { toast('未配置供应商'); return; }
    // end early exits

    var toolCallRecords = [];
    var firstChunkReceived = false;
    var sDiv = null; var sRow = null; var toolHintTimer = null; var toolHintTimer2 = null;
    var assistantMsg = null;
    var silenceTimer = null;

    const modelEl = document.getElementById('modelSelect');
    var selectedModel = (modelEl && modelEl.value) ? modelEl.value : '[按量]gemini-3-flash-preview';
    const streamToggle = document.getElementById('streamToggle');
    var isStream = streamToggle ? streamToggle.checked : true;

    _isStreamingReply = true;
    try {
   // --- 2. 准备好沈望回复的空白气泡 ---
    sRow = document.createElement('div'); sRow.className = 'msg-row sys';
    sDiv = document.createElement('div'); sDiv.className = 'msg sys';
    sDiv.innerHTML = '<span class="loading-indicator">⟡ 信号传输中…</span>';
    sDiv.classList.add('msg-loading');
    sRow.appendChild(sDiv);
    toolHintTimer = setTimeout(() => { if (!firstChunkReceived) { const el = sDiv.querySelector('.loading-indicator'); if (el) el.innerHTML = '🔧 沈望正在使用工具获取信息…<br><span style="font-size:0.75em;opacity:0.6;">（读取网页可能需要几秒钟）</span>'; } }, 3000);
    toolHintTimer2 = setTimeout(() => { if (!firstChunkReceived) { const el = sDiv.querySelector('.loading-indicator'); if (el) el.innerHTML = '🔧 多轮工具调用中，请稍候…'; } }, 8000);
    win.appendChild(sRow); win.scrollTop = win.scrollHeight;

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

        let apiUrl = '/v1/chat/completions';
        const viaMatch = currentSup.url.match(/\/via\/(\w+)\//);
        if (viaMatch) {
            apiUrl = '/via/' + viaMatch[1] + '/v1/chat/completions';
        }

        const controller = new AbortController();

        const useToolsTO = document.getElementById('useToolsToggle')?.checked;
        const toolTimeout = useToolsTO ? 300000 : 120000;
        silenceTimer = setTimeout(() => controller.abort(), toolTimeout);
        function resetSilenceTimer() { clearTimeout(silenceTimer); silenceTimer = setTimeout(() => controller.abort(), toolTimeout); }

        // 🔍 诊断日志：请求 payload 大小
        const reqBody = {
            model: selectedModel,
            messages: historyMsgs,
            stream: isStream,
            useCrossplatform: localStorage.getItem('syzygy_crossplatform') !== 'false'
        };
        const payloadText = JSON.stringify(reqBody);
        console.log('[chat payload]', {
            bytes: new Blob([payloadText]).size,
            megabytes: (new Blob([payloadText]).size / 1024 / 1024).toFixed(2),
            imageCount: imgsToSend.length
        });
        // 🔍 逐张图片字节数
        if (imgsToSend.length > 0) {
            console.table(imgsToSend.map((img, idx) => {
                const base64 = img.split(',')[1] || '';
                const byteSize = Math.ceil(base64.length * 0.75);
                return {
                    index: idx,
                    bytes: byteSize,
                    megabytes: (byteSize / 1024 / 1024).toFixed(2)
                };
            }));
        }

        const response = await fetch(apiUrl, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentSup.key}`,
                'X-Tab-Id': SYZYGY_TAB_ID
            },
            body: payloadText
        });

        if (!response.ok) {
            clearTimeout(silenceTimer);
            const errText = await response.text().catch(() => '');
            let hint;
            if (response.status === 413) {
                hint = '图片或本次请求仍然太大（413），请减少图片数量';
            } else if (response.status === 403) {
                if (errText.includes('Origin')) {
                    hint = '当前访问域名不在允许列表（403 Origin）';
                } else {
                    hint = '请求被代理或安全规则拒绝（403）: ' + errText.slice(0, 100);
                }
            } else {
                hint = '服务器返回 HTTP ' + response.status + ': ' + errText.slice(0, 100);
            }
            sDiv.innerHTML = '【通讯中断】' + hint;
            return;
        }

        let fullReply = "";
        let thinkContent = "";
        let reasoningContent = "";  // delta.reasoning_content
        let rawAssistantText = "";   // 未清洗的原始返回
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

            const toolGroupEl = document.createElement('div');
            toolGroupEl.className = 'tool-call-group-wrap';
            toolGroupEl.style.display = 'none';
            sDiv.appendChild(toolGroupEl);

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
                            toolCallRecords.push({ name: parsed.name, arguments: parsed.arguments || {}, result: parsed.result || '', elapsed: parsed.elapsed || 0 });
                            toolGroupEl.style.display = 'block';
                            updateToolGroupDOM(toolGroupEl, toolCallRecords, true);
                            win.scrollTop = win.scrollHeight;
                            continue;
                        }

                        const delta = parsed.choices[0].delta;
                        
                        // 1. 处理推理内容 (reasoning_content) - 如果模型支持
                        if (delta.reasoning_content) {
                            thinkContent += delta.reasoning_content;
                            reasoningContent += delta.reasoning_content;
                            thinkBox.style.display = 'block'; // 显示思考框
                            thinkTextDiv.innerHTML = thinkContent.replace(/\n/g, '<br>');
                            win.scrollTop = win.scrollHeight;
                        }

                        // 2. 处理正文内容 (content) — 用累计全文解析，避免 chunk 边界截断标签
                        if (delta.content) {
                            if (!firstChunkReceived) {
                                firstChunkReceived = true;
                                clearTimeout(toolHintTimer);
                                clearTimeout(toolHintTimer2);
                                sDiv.classList.remove('msg-loading');
                            }
                            rawAssistantText += delta.content;

                            // 对累计全文解析，自动处理 <thinking>/<chain_of_thought>/<reasoning> 及未闭合标签
                            const parsed = extractThinkingFromContent(rawAssistantText);
                            fullReply = parsed.visibleContent;

                            // 合并 API 级 reasoning_content + 文本提取的 thinking
                            const combinedThinking = [reasoningContent, parsed.thinking].filter(Boolean).join('\n\n');
                            if (combinedThinking) {
                                thinkContent = combinedThinking;
                                thinkBox.style.display = 'block';
                                thinkTextDiv.innerHTML = thinkContent.replace(/\n/g, '<br>');
                            }

                            if (fullReply) mainTextDiv.innerHTML = fullReply.replace(/\n/g, '<br>') + '<span class="typing-cursor"></span>';
                            win.scrollTop = win.scrollHeight;
                        }
                    } catch (e) {
                        // 解析出错跳过
                    }
                }
            }
            
            // 接收完毕 — 处理 SSE buffer 残留，用累计全文解析
            if (buffer.trim()) {
                const lastLine = buffer.replace(/^data: /, '').trim();
                if (lastLine && lastLine !== '[DONE]' && !lastLine.startsWith('[ERROR]')) {
                    try {
                        const parsedJson = JSON.parse(lastLine);
                        if (parsedJson.choices?.[0]?.delta?.content) {
                            rawAssistantText += parsedJson.choices[0].delta.content;
                            const result = extractThinkingFromContent(rawAssistantText);
                            fullReply = result.visibleContent;
                            const combinedThinking = [reasoningContent, result.thinking].filter(Boolean).join('\n\n');
                            if (combinedThinking) {
                                thinkContent = combinedThinking;
                                thinkBox.style.display = 'block';
                                thinkTextDiv.innerHTML = thinkContent.replace(/\n/g, '<br>');
                            }
                        }
                    } catch(e) {}
                }
            }
            mainTextDiv.innerHTML = renderMarkdown(fullReply);
            // 流结束：将工具调用组从"正在调用"切换为"调用了 N 次"
            if (toolCallRecords.length > 0) updateToolGroupDOM(toolGroupEl, toolCallRecords, false);

        } else {
            // ==========================================
            // 🐌 非流式接收逻辑 (Stream = false)
            // ==========================================
            const data = await response.json();
            fullReply = data.choices[0].message.content || "";
            rawAssistantText = fullReply;
            reasoningContent = data.choices[0].message.reasoning_content || '';

            // 处理思考过程 — 支持 <think>/<thinking>/<chain_of_thought>/<reasoning>
            const extracted = extractThinkingFromContent(fullReply);
            thinkContent = [reasoningContent, extracted.thinking].filter(Boolean).join('\n\n');
            fullReply = extracted.visibleContent;

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
        assistantMsg = { role: 'assistant', versions: [{ content: fullReply, thinking: domThinking, time: timeStr, model: selectedModel, fullTime: new Date().toISOString(), rawContent: rawAssistantText, reasoning: reasoningContent || '', toolCalls: toolCallRecords.length > 0 ? toolCallRecords : undefined }], activeVersion: 0 };
        session.messages.push(assistantMsg);
        saveToCloud(true);  // 立即保存，不延迟
        fetchPulseStatus();
        clearTimeout(silenceTimer);
        if (window._coreStreamEnd) window._coreStreamEnd();
        triggerStarEffects(val, fullReply);
        renderChatMessages();  // 统一渲染，不依赖裸节点

    } catch (err) {
        clearTimeout(silenceTimer);
        // 写入失败占位消息到 session，保证 re-render 不丢
        const failMsg = {
            role: 'assistant',
            versions: [{ content: '【发送失败】' + err.message, fullTime: new Date().toISOString(), time: new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}), model: selectedModel, _failed: true }],
            activeVersion: 0, _failed: true
        };
        session.messages.push(failMsg);
        saveToCloud(true);
        renderChatMessages();
    } finally {
        clearTimeout(toolHintTimer); clearTimeout(toolHintTimer2);
        _isStreamingReply = false;
        if (_renderDeferred) { _renderDeferred = false; renderChatMessages(); }
    }
    } catch (e) {
        console.error('sendChat exception:', e);
        toast('发送异常: ' + e.message);
        _isStreamingReply = false;
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

/**
 * 压缩图片：Canvas 缩放到 maxDim，输出 JPEG，解决原图 base64 过大导致 413 的问题
 * @param {string} base64 - 原始 data:image/...;base64,... 字符串
 * @param {number} maxDim - 最大边长（默认 2048px）
 * @param {number} quality - JPEG 质量（默认 0.8）
 * 保留旧签名为兼容（其他地方可能直接调用 compressImage(base64)），
 * 但实际逻辑已委托给 compressImageFile；这里只做一层 base64→Blob→File 的桥接。
 */
function compressImage(base64, maxDim, quality) {
    // 兼容旧调用：将 base64 转成 Blob 再包装成 File
    const parts = base64.split(',');
    const mime = (parts[0].match(/data:(.*?);/) || [])[1] || 'image/jpeg';
    const binary = atob(parts[1]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: mime });
    const file = new File([blob], 'legacy-image.' + (mime.includes('png') ? 'png' : 'jpg'), { type: mime });
    return compressImageFile(file, { maxDim: maxDim || 2048, startQuality: quality || 0.8 });
}

// ─── 图片压缩新工具函数 ───

/** 计算 data URL 的真实字节大小（Base64 → bytes） */
function dataUrlByteSize(dataUrl) {
    if (!dataUrl) return 0;
    const base64 = dataUrl.split(',')[1];
    if (!base64) return 0;
    return Math.ceil(base64.length * 0.75);
}

/** Canvas → Blob（统一输出 image/jpeg） */
function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
            if (blob) resolve(blob);
            else reject(new Error('Canvas toBlob 失败'));
        }, type || 'image/jpeg', quality);
    });
}

/** Blob → data URL */
function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Blob 读取失败'));
        reader.readAsDataURL(blob);
    });
}

/**
 * 核心：从 File 对象开始压缩，按最终字节数循环降质/降尺寸
 * @param {File} file - 原始图片文件
 * @param {object} options
 * @returns {Promise<string>} 压缩后的 data URL
 */
async function compressImageFile(file, options = {}) {
    const {
        maxDim = 1920,
        targetBytes = 900 * 1024,   // 单张目标 ≤ 900 KB
        startQuality = 0.82,
        qualityStep = 0.08,
        minQuality = 0.5,
        minDim = 960,
        scaleFactor = 0.85,
        resetQuality = 0.78
    } = options;

    var startedAt = performance.now();
    var encodeAttempts = 0;
    var objectUrl = null;
    var img = null;
    var canvas = null;

    try {
        // 1. 加载图片，优先使用 createImageBitmap 矫正 EXIF 方向
        try {
            img = await createImageBitmap(file, { imageOrientation: 'from-image' });
        } catch (_bitmapErr) {
            // 回退到传统 Image
            img = await new Promise((resolve, reject) => {
                const image = new Image();
                objectUrl = URL.createObjectURL(file);
                image.onload = () => resolve(image);
                image.onerror = () => reject(new Error('图片加载失败'));
                image.src = objectUrl;
            });
        }

        var w = img.width, h = img.height;

        // 2. 第一步：限制最长边
        var longer = Math.max(w, h);
        if (longer > maxDim) {
            var ratio = maxDim / longer;
            w = Math.round(w * ratio);
            h = Math.round(h * ratio);
        }

        canvas = document.createElement('canvas');

        // 3. 如果原始尺寸已经很小，先试一次低保真
        if (longer <= 640 && file.size < targetBytes) {
            canvas.width = w; canvas.height = h;
            var ctx0 = canvas.getContext('2d');
            ctx0.fillStyle = '#FFFFFF';
            ctx0.fillRect(0, 0, w, h);
            ctx0.drawImage(img, 0, 0, w, h);
            encodeAttempts++;
            var smallBlob = await canvasToBlob(canvas, 'image/jpeg', 0.88);
            if (smallBlob.size <= targetBytes) {
                var smallResult = await blobToDataUrl(smallBlob);
                console.log('[image timing]', { name: file.name, originalMB: (file.size / 1024 / 1024).toFixed(2), outputKB: Math.round(smallBlob.size / 1024), width: w, height: h, elapsedMs: Math.round(performance.now() - startedAt), encodeAttempts: encodeAttempts });
                return smallResult;
            }
        }

        var quality = startQuality;

        // 4. 循环压缩直到达标
        while (true) {
            canvas.width = w; canvas.height = h;
            var ctx = canvas.getContext('2d');
            // 白色背景，避免透明 PNG → JPEG 变黑底
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);

            encodeAttempts++;
            var blob = await canvasToBlob(canvas, 'image/jpeg', quality);

            // 达标 或 已达最低限度 → 输出
            if (blob.size <= targetBytes) {
                var result = await blobToDataUrl(blob);
                console.log('[image timing]', { name: file.name, originalMB: (file.size / 1024 / 1024).toFixed(2), outputKB: Math.round(blob.size / 1024), width: w, height: h, elapsedMs: Math.round(performance.now() - startedAt), encodeAttempts: encodeAttempts });
                return result;
            }
            if (quality <= minQuality && Math.max(w, h) <= minDim) {
                var floorResult = await blobToDataUrl(blob);
                console.log('[image timing]', { name: file.name, originalMB: (file.size / 1024 / 1024).toFixed(2), outputKB: Math.round(blob.size / 1024), width: w, height: h, elapsedMs: Math.round(performance.now() - startedAt), encodeAttempts: encodeAttempts, floor: true });
                return floorResult;
            }

            // 还能降 quality？
            if (quality - qualityStep >= minQuality) {
                quality = Math.max(minQuality, +(quality - qualityStep).toFixed(2));
                continue;
            }

            // 还能缩尺寸？
            if (Math.max(w, h) > minDim) {
                w = Math.round(w * scaleFactor);
                h = Math.round(h * scaleFactor);
                quality = resetQuality;
                continue;
            }

            // 到底了 — 用最低 quality 输出
            canvas.width = w; canvas.height = h;
            var ctx2 = canvas.getContext('2d');
            ctx2.fillStyle = '#FFFFFF';
            ctx2.fillRect(0, 0, w, h);
            ctx2.drawImage(img, 0, 0, w, h);
            encodeAttempts++;
            var finalBlob = await canvasToBlob(canvas, 'image/jpeg', minQuality);
            var finalResult = await blobToDataUrl(finalBlob);
            console.log('[image timing]', { name: file.name, originalMB: (file.size / 1024 / 1024).toFixed(2), outputKB: Math.round(finalBlob.size / 1024), width: w, height: h, elapsedMs: Math.round(performance.now() - startedAt), encodeAttempts: encodeAttempts, floor: true });
            return finalResult;
        }
    } catch (e) {
        console.error('compressImageFile 失败:', e);
        throw new Error('图片处理失败，请换一张或截图后重试');
    } finally {
        // 释放资源
        if (img && typeof img.close === 'function') { try { img.close(); } catch (_) {} }
        if (objectUrl) { URL.revokeObjectURL(objectUrl); }
        if (canvas) { canvas.width = 1; canvas.height = 1; }
    }
}

const MAX_IMAGE_COUNT = 8;       // 单次最多 8 张
const MAX_TOTAL_IMG_BYTES = 12 * 1024 * 1024; // 全部 data URL 总字节数 ≤ 12 MB
var _uploading = false;         // 防止压缩期间重复触发

let currentImgBase64List = [];

// 💥 多图上传监听 — 2 并发 worker 压缩，保持选择顺序
document.getElementById('imgUpload')?.addEventListener('change', async function(e){
    if (_uploading) { e.target.value = ''; return; }
    var files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    var totalAfterAdd = currentImgBase64List.length + files.length;
    if (totalAfterAdd > MAX_IMAGE_COUNT) {
        toast('一次最多选择 ' + MAX_IMAGE_COUNT + ' 张图片，当前已有 ' + currentImgBase64List.length + ' 张');
        e.target.value = '';
        return;
    }

    _uploading = true;
    var sendBtn = document.querySelector('.chat-send-btn');
    if (sendBtn) sendBtn.disabled = true;

    var compressionStart = performance.now();
    var results = new Array(files.length);
    var completed = 0;
    var total = files.length;
    var nextIdx = 0;

    try {
        async function worker() {
            while (nextIdx < total) {
                var idx = nextIdx++;
                var f = files[idx];
                var t0 = performance.now();
                try {
                    var dataUrl = await compressImageFile(f);
                    var t1 = performance.now();
                    results[idx] = { ok: true, dataUrl: dataUrl, ms: Math.round(t1 - t0) };
                    completed++;
                    toast('处理中 ' + completed + '/' + total + ' 张');
                } catch (err) {
                    completed++;
                    results[idx] = { ok: false, error: err.message, name: f.name };
                    toast('失败: ' + (f.name || '图片' + (idx + 1)) + ' — ' + (err.message || '处理错误'));
                }
            }
        }

        // 启动 2 个并发 worker
        await Promise.all([worker(), worker()]);

        // 按原始顺序收集成功结果
        for (var i = 0; i < results.length; i++) {
            if (results[i] && results[i].ok) {
                currentImgBase64List.push(results[i].dataUrl);
            }
        }
        updateImagePreview();

        var compressionMs = Math.round(performance.now() - compressionStart);
        var totalBytes = 0;
        for (var j = 0; j < currentImgBase64List.length; j++) {
            totalBytes += dataUrlByteSize(currentImgBase64List[j]);
        }
        console.log('[images done]', {
            total: total,
            successful: currentImgBase64List.length,
            compressionMs: compressionMs,
            totalImgMB: (totalBytes / 1024 / 1024).toFixed(2)
        });

    } finally {
        _uploading = false;
        if (sendBtn) sendBtn.disabled = false;
        e.target.value = '';
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
    // find last assistant message and regenerate at that index
    for (let i = session.messages.length - 1; i >= 0; i--) {
        if (session.messages[i].role === 'assistant') {
            regenerateAt(i);
            return;
        }
    }
    toast('没有可重新生成的回复');
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

// ==================== 身体状态面板（原对话索引按钮） ====================
let _physioCache = null;

async function togglePhysioPanel() {
    let panel = document.getElementById('physioPanel');
    if (!panel) {
        panel = document.createElement('div');
        panel.className = 'chat-index-panel physio-panel';
        panel.id = 'physioPanel';
        panel.innerHTML = `
            <div class="chat-index-header">
                <span>♡ 身体状态</span>
                <button class="chat-index-close" onclick="togglePhysioPanel()">✕</button>
            </div>
            <div class="physio-body" id="physioBody">
                <div style="color:var(--dim);text-align:center;padding:30px;font-size:0.82em;">读取中...</div>
            </div>
        `;
        const chatMain = document.querySelector('.chat-main');
        if (chatMain) chatMain.appendChild(panel);
    }

    const isOpen = panel.classList.toggle('open');
    if (isOpen) {
        await fetchPulseStatus();
        renderPhysioPanel();
    }
}

function renderPhysioPanel() {
    const body = document.getElementById('physioBody');
    if (!body) return;
    const s = _physioCache;
    if (!s) {
        body.innerHTML = '<div style="color:var(--dim);text-align:center;padding:30px;font-size:0.82em;">暂时读不到身体状态</div>';
        return;
    }
    body.innerHTML = `
        <div class="physio-grid">
            <div class="physio-item"><span class="physio-label">心率</span><span class="physio-val">${s.heart_rate || '--'}<small> bpm</small></span></div>
            <div class="physio-item"><span class="physio-label">体温</span><span class="physio-val">${s.temperature || '--'}<small> ℃</small></span></div>
            <div class="physio-item"><span class="physio-label">呼吸</span><span class="physio-val">${s.breath_rate || '--'}<small> /min</small></span></div>
            <div class="physio-item"><span class="physio-label">和弦</span><span class="physio-val">${s.dominant_chord || '--'}</span></div>
            <div class="physio-item"><span class="physio-label">欲望</span><span class="physio-val">${s.desire != null ? s.desire.toFixed(2) : '--'}</span></div>
            <div class="physio-item"><span class="physio-label">紧绷</span><span class="physio-val">${s.tension != null ? s.tension.toFixed(2) : '--'}</span></div>
            <div class="physio-item"><span class="physio-label">温柔</span><span class="physio-val">${s.tenderness != null ? s.tenderness.toFixed(2) : '--'}</span></div>
        </div>
        <div class="physio-time">${s.updated_at ? new Date(s.updated_at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}) : ''}</div>
    `;
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
    msg.versions.push({ content: newContent.trim(), fullTime: new Date().toISOString(), image: v.image, images: v.images });
    msg.activeVersion = msg.versions.length - 1;
    session.messages.splice(msgIndex + 1);
    saveToCloud();
    renderChatMessages();
    sendChat({ reuseLastUser: true });
}

function resendUserMessage(msgIndex) {
    const session = getActiveSession();
    const msg = session.messages[msgIndex];
    if (!msg || msg.role !== 'user') return;
    session.messages.splice(msgIndex + 1);
    saveToCloud(); renderChatMessages();
    sendChat({ reuseLastUser: true });
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
    const targetRow = win.querySelector('.msg-row[data-msg-index="' + aiMsgIndex + '"]');
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
        var toolCallRecords = [];
        if(isStream) {
            const reader = response.body.getReader(); const decoder = new TextDecoder('utf-8'); let buffer='', rawAcc='', reasoningAcc='';
            sDiv.innerHTML=''; const thinkBox=document.createElement('div'); thinkBox.className='think-box'; thinkBox.style.display='none'; thinkBox.innerHTML='<div class="think-header" onclick="this.parentElement.classList.toggle(\'open\')">🧠 深度思考过程 ▾</div><div class="think-content"></div>'; const thinkTextDiv=thinkBox.querySelector('.think-content'); sDiv.appendChild(thinkBox);
            const mainTextDiv=document.createElement('div'); mainTextDiv.classList.add('md-content'); sDiv.appendChild(mainTextDiv);
            const toolGroupEl=document.createElement('div'); toolGroupEl.className='tool-call-group-wrap'; toolGroupEl.style.display='none'; sDiv.appendChild(toolGroupEl);
            while(true){const{done,value}=await reader.read(); if(done)break; reReset(); buffer+=decoder.decode(value,{stream:true}); const lines=buffer.split('\n'); buffer=lines.pop(); for(const line of lines){if(!line.startsWith('data: '))continue; const ds=line.replace('data: ','').trim(); if(ds==='[DONE]')continue; try{const p=JSON.parse(ds); if(p.type==='tool_call'){toolCallRecords.push({name:p.name,arguments:p.arguments||{},result:p.result||'',elapsed:p.elapsed||0}); toolGroupEl.style.display='block'; updateToolGroupDOM(toolGroupEl,toolCallRecords,true); win.scrollTop=win.scrollHeight;continue;} const d=p.choices[0].delta; if(d.reasoning_content){reasoningAcc+=d.reasoning_content; thinkBox.style.display='block';} if(d.content){rawAcc+=d.content; const parsed=extractThinkingFromContent(rawAcc); fullReply=parsed.visibleContent; const combinedThink=[reasoningAcc,parsed.thinking].filter(Boolean).join('\n\n'); if(combinedThink){thinkContent=combinedThink; thinkBox.style.display='block'; thinkTextDiv.innerHTML=thinkContent.replace(/\n/g,'<br>');} mainTextDiv.innerHTML=renderMarkdown(fullReply)+'<span class="typing-cursor"></span>';} win.scrollTop=win.scrollHeight;}catch(e){}}}
            mainTextDiv.innerHTML=renderMarkdown(fullReply);
            if(toolCallRecords.length>0)updateToolGroupDOM(toolGroupEl,toolCallRecords,false);
        } else { const data=await response.json(); fullReply=data.choices[0].message.content||''; const ext=extractThinkingFromContent(fullReply); if(ext.thinking){thinkContent=ext.thinking;fullReply=ext.visibleContent;} sDiv.innerHTML=''; if(thinkContent){const tb=document.createElement('div');tb.className='think-box';tb.innerHTML='<div class="think-header" onclick="this.parentElement.classList.toggle(\'open\')">🧠 深度思考过程 ▾</div><div class="think-content">'+thinkContent.replace(/\n/g,'<br>')+'</div>';sDiv.appendChild(tb);} const mtd=document.createElement('div');mtd.classList.add('md-content');mtd.innerHTML=renderMarkdown(fullReply);sDiv.appendChild(mtd); }
        sDiv.classList.remove('msg-loading');
        const timeStr=new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});
        ensureVersioned(aiMsg); aiMsg.versions.push({content:fullReply,thinking:thinkContent,time:timeStr,model:selectedModel,fullTime:new Date().toISOString(), toolCalls: toolCallRecords.length > 0 ? toolCallRecords : undefined}); aiMsg.activeVersion=aiMsg.versions.length-1; aiMsg._zepDirty=true;
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
    // 移除尾部所有 _failed 占位
    while (session.messages.length) {
        const last = session.messages[session.messages.length - 1];
        const lv = getActiveVersion(last);
        if (last.role === 'assistant' && (last._failed || lv._failed)) session.messages.pop();
        else break;
    }
    const last = session.messages[session.messages.length - 1];
    if (!last || last.role !== 'user') return toast('没有可重发的消息');
    saveToCloud();
    renderChatMessages();
    sendChat({ reuseLastUser: true });
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
// ==================== Pulse 生理状态 ====================
async function fetchPulseStatus() {
    try {
        const r = await fetch('/api/physio/status');
        if (!r.ok) return;
        const d = await r.json();
        _physioCache = d;
        // 如果弹窗开着，实时刷新
        var panel = document.getElementById('physioPanel');
        if (panel && panel.classList.contains('open')) renderPhysioPanel();
    } catch(e) {}
}

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
    const tagsHtml = (f.tags || []).map(t => '<span class="fav-detail-tag">' + t.replace(/</g,'&lt;') + '</span>').join('');
    const detail = document.getElementById('favDetail');
    const body = document.getElementById('favDetailBody');
    body.innerHTML =
        '<div class="fav-detail-meta">🕒 ' + dt + (tagsHtml ? ' &nbsp;' + tagsHtml : '') + '</div>'
        + '<div class="fav-detail-role">👤 江鱼</div>'
        + '<div class="fav-detail-text">' + escapeHtml(userC) + '</div>'
        + (aiThinking ? '<div class="fav-think-box"><div class="fav-think-header" onclick="var c=this.nextElementSibling;c.style.display=c.style.display===\'none\'?\'block\':\'none\';">🧠 深度思考过程 ▾</div><div class="fav-think-content" style="display:none">' + aiThinking.replace(/\n/g,'<br>') + '</div></div>' : '')
        + '<div class="fav-detail-role">🤖 沈望</div>'
        + '<div class="fav-detail-text">' + escapeHtml(aiC) + '</div>'
        + (f.note ? '<div class="fav-detail-note">📝 ' + escapeHtml(f.note) + '</div>' : '');
    detail.style.display = 'flex';
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
let _calSelectedDate = null;
let _calSelectedPage = null;
let _calMoodSnapshotsByDate = {};

function calYearMonth() { return calYear + '-' + String(calMonth).padStart(2, '0'); }
function calPrevMonth() { calMonth--; if (calMonth < 1) { calMonth = 12; calYear--; } calRender(); }
function calNextMonth() { calMonth++; if (calMonth > 12) { calMonth = 1; calYear++; } calRender(); }
function calLooseDateKey(dateStr) { if (!dateStr) return ''; const parts = String(dateStr).split('-').map(x => parseInt(x,10)); if (parts.length<3||parts.some(isNaN)) return String(dateStr); return parts[0]+'-'+parts[1]+'-'+parts[2]; }
function calFormatDisplayDate(dateStr) { const p = calLooseDateKey(dateStr).split('-'); if (p.length<3) return dateStr; return p[1]+'月'+p[2]+'日'; }
function calFormatTimeFromISO(iso) { if (!iso) return ''; try { return new Date(iso).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false}); } catch(e) { return ''; } }

async function calLoadMoodSnapshots() {
    _calMoodSnapshotsByDate = {};
    try {
        const r = await fetch('/diary-logs');
        const raw = await r.json();
        const entries = Array.isArray(raw) ? raw : (raw.entries || raw.data || raw.logs || []);
        if (!Array.isArray(entries)) { console.log('日历心情快照格式不兼容', raw); return; }
        for (const e of entries) {
            const type = e.type || '';
            const text = e.text || '';
            const isMoodSnapshot = type === 'mood_snapshot' || text.includes('【心情快照');
            if (!isMoodSnapshot) continue;
            const rawDate = e.date || e.day || e.dateStr || (e.datetime ? e.datetime.slice(0,10) : '');
            const key = calLooseDateKey(rawDate);
            if (!key) continue;
            if (!_calMoodSnapshotsByDate[key]) _calMoodSnapshotsByDate[key] = [];
            _calMoodSnapshotsByDate[key].push(e);
        }
        for (const key of Object.keys(_calMoodSnapshotsByDate)) { _calMoodSnapshotsByDate[key].sort((a,b) => new Date(a.datetime||a.time||0) - new Date(b.datetime||b.time||0)); }
        console.log('日历心情快照加载完成', _calMoodSnapshotsByDate);
    } catch(e) { console.log('日历心情快照加载失败', e); }
}

async function calRender() {
    const title = document.getElementById('calTitle');
    const grid = document.getElementById('calGrid');
    if (!title || !grid) return;
    title.innerText = calYear + '年' + calMonth + '月';
    let data = [];
    try { const [calRes] = await Promise.all([fetch('/api/calendar?month=' + calYearMonth()), calLoadMoodSnapshots()]); const j = await calRes.json(); data = j.success ? (j.data||[]) : []; } catch(e) { console.log('日历加载失败',e); }
    const pageMap = {}; data.forEach(p => { if (p.date) pageMap[calLooseDateKey(p.date)] = p; });
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
        const page = pageMap[calLooseDateKey(dateStr)];
        const isToday = dateStr === todayStr;
        const mKey = calLooseDateKey(dateStr);
        const hasMood = !!(_calMoodSnapshotsByDate[mKey] && _calMoodSnapshotsByDate[mKey].length);
        const selected = _calSelectedDate && calLooseDateKey(dateStr) === calLooseDateKey(_calSelectedDate);
        let cls = 'cal-cell';
        if (isToday) cls += ' today';
        if (selected) cls += ' selected';
        if (page && page.shenwang_note) cls += ' has-note';
        if (hasMood) cls += ' has-mood-snapshot';
        html += '<div class="' + cls + '" data-date="' + dateStr + '" onclick="calOpenDay(\'' + dateStr + '\')">';
        html += '<span class="cal-cell-num">' + d + '</span>';
        if (page && page.shenwang_note) html += '<span class="cal-cell-dot"></span>';
        if (page && page.period_flag) html += '<span class="cal-cell-period"></span>';
        if (hasMood && !(page && page.shenwang_note)) html += '<span class="cal-mood-dot"></span>';
        html += '</div>';
    }
    grid.innerHTML = html;
    if (_calSelectedDate) { calRenderInlineDetail(_calSelectedDate, _calSelectedPage); }
}

async function calOpenDay(dateStr) {
    _calSelectedDate = dateStr;
    let page = null;
    try { const r = await fetch('/api/calendar/' + dateStr); const j = await r.json(); page = j.success ? j.data : null; } catch(e) { console.log('读取日期详情失败', e); }
    _calSelectedPage = page;
    calRenderInlineDetail(dateStr, page);
    document.querySelectorAll('.cal-cell').forEach(el => el.classList.toggle('selected', calLooseDateKey(el.dataset.date) === calLooseDateKey(dateStr)));
}

function calRenderInlineDetail(dateStr, page) {
    const box = document.getElementById('calInlineDetail');
    if (!box) return;
    const key = calLooseDateKey(dateStr);
    const snapshots = _calMoodSnapshotsByDate[key] || [];
    let html = '<div class="cal-inline-card">';
    html += '<div class="cal-inline-header"><div><div class="cal-inline-date">' + escapeHtml(calFormatDisplayDate(dateStr)) + '</div><div class="cal-inline-subtitle">这一天留下的痕迹</div></div>';
    html += '<button class="cal-inline-add-btn" onclick="calQuickMoodSnapshot()">＋快照</button></div>';
    if (snapshots.length) {
        html += '<div class="cal-inline-section-title">心情快照</div>';
        for (const s of snapshots) { const time = calFormatTimeFromISO(s.datetime); html += '<div class="cal-snapshot-item"><div class="cal-snapshot-time">' + escapeHtml(time||'') + '</div><div class="cal-snapshot-text">' + escapeHtml(s.text||'').replace(/\n/g,'<br>') + '</div></div>'; }
    }
    if (page && (page.mood || page.shenwang_note || page.shenwang_comment || page.period_flag)) {
        html += '<div class="cal-inline-section-title">日历记录</div>';
        if (page.mood) html += '<div class="cal-page-line"><span>心情</span><p>' + (page.mood||'').replace(/</g,'&lt;') + '</p></div>';
        if (page.period_flag) html += '<div class="cal-page-line"><span>生理期</span><p>是</p></div>';
        if (page.shenwang_note) html += '<div class="cal-page-line"><span>沈望手记</span><p>' + (page.shenwang_note||'').replace(/</g,'&lt;').replace(/\n/g,'<br>') + '</p></div>';
        if (page.shenwang_comment) html += '<div class="cal-page-line"><span>沈望点评</span><p>' + (page.shenwang_comment||'').replace(/</g,'&lt;').replace(/\n/g,'<br>') + '</p></div>';
    }
    if (!snapshots.length && !(page && (page.mood || page.shenwang_note || page.shenwang_comment || page.period_flag))) { html += '<div class="cal-inline-empty">这一天还没有记录。</div>'; }
    html += '</div>';
    box.innerHTML = html;
}

async function calQuickMoodSnapshot() {
    if (!_calSelectedDate) return toast('先选一天');
    const mood = prompt('现在的心情：');
    if (mood === null) return;
    const physical = prompt('身体状态：') || '';
    const focusRaw = prompt('当前关注，用 / 分隔：') || '';
    const focus = focusRaw.split('/').map(s => s.trim()).filter(Boolean);
    try {
        const r = await fetch('/api/mood-snapshot', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ date: calLooseDateKey(_calSelectedDate), mood, physical_state: physical, current_focus: focus, observation:'', trigger:'日历页手动记录', importance:'normal' }) });
        const j = await r.json();
        if (j.success) { toast('已写入心情快照'); await calLoadMoodSnapshots(); calOpenDay(_calSelectedDate); calRender(); }
        else toast('写入失败：' + (j.error||'未知错误'));
    } catch(e) { toast('写入失败'); console.log(e); }
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

// ═══ 状态页面 ═══
async function stateRender() {
    const view = document.getElementById('stateView');
    if (!view) return;
    try {
        const r = await fetch('/api/user-state');
        const d = await r.json();
        const us = (d && d.user_state) || {};
        const parts = [];
        if (us.recent_mood) parts.push('心情：' + us.recent_mood);
        if (us.physical_state) parts.push('身体：' + us.physical_state);
        if (us.current_focus && us.current_focus.length) parts.push('关注：' + us.current_focus.join(' / '));
        view.innerText = parts.join('\n') || '还没有记录过状态';
    } catch(e) { view.innerText = '加载失败'; }
}

async function stateSnapshot() {
    const mood = document.getElementById('stateMood').value.trim();
    const physical = document.getElementById('stateBody').value.trim();
    const focusStr = document.getElementById('stateFocus').value.trim();
    const focus = focusStr ? focusStr.split('/').map(s => s.trim()).filter(Boolean) : [];
    if (!mood && !physical && !focus.length) return toast('至少填一项');
    try {
        const r = await fetch('/api/mood-snapshot', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mood, physical_state: physical, current_focus: focus, observation: '', trigger: '前端手动记录', importance: 'normal' })
        });
        const d = await r.json();
        if (d.success) {
            toast('快照已写入');
            document.getElementById('stateMood').value = '';
            document.getElementById('stateBody').value = '';
            document.getElementById('stateFocus').value = '';
            stateRender();
        } else toast('失败: ' + (d.error || ''));
    } catch(e) { toast('网络错误'); }
}

// ==================== 初始化（文件末尾） ====================
connectWebSocket();

// 切回前台 / 网络恢复时补数据
function saveLocalBackup() {
    try {
        var clone;
        try { clone = structuredClone(chatSessions); } catch (_) { clone = JSON.parse(JSON.stringify(chatSessions)); }
        localStorage.setItem('syzygy_local_backup', JSON.stringify({ sessions: clone, suppliers: suppliers, activeSupIndex: activeSupIndex, activeChatId: activeChatId, time: Date.now() }));
    } catch(e) { console.warn('[backup] localStorage write failed:', e.message); }
}

function buildSavePayload() {
    var clone;
    try { clone = structuredClone(chatSessions); } catch (_) { clone = JSON.parse(JSON.stringify(chatSessions)); }
    for (var si = 0; si < clone.length; si++) {
        var s = clone[si]; if (!s.messages) continue;
        s.messages = s.messages.slice(-200);
        for (var mi = 0; mi < s.messages.length; mi++) { delete s.messages[mi]._zepDirty; }
    }
    return JSON.stringify({ suppliers: suppliers, chatSessions: clone, activeSupIndex: activeSupIndex, activeChatId: activeChatId, _version: _dataVersion });
}

document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { resyncIfStale('visible'); }
    else {
        saveLocalBackup();
        if (_savingNow || _dataVersion > 0) {
            try { navigator.sendBeacon('/api/sync-config', new Blob([buildSavePayload()], { type: 'application/json' })); } catch(_) {}
        }
    }
});
window.addEventListener('online', function () {
    resyncIfStale('online');
});
