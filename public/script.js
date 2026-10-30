// ==================== Markdown 渲染 ====================
if (typeof marked !== 'undefined') { marked.setOptions({ breaks: true, gfm: true, headerIds: false, mangle: false }); }
function stripInternalTags(text) { return (text||'').replace(/<MOOD_SNAPSHOT>[\s\S]*?<\/MOOD_SNAPSHOT>/g, '').replace(/\[\[MOOD_SNAPSHOT\]\][\s\S]*?\[\[MOOD_SNAPSHOT\]\]/g, '').replace(/<\s*CRUMB\s*>[\s\S]*?<\s*\/\s*CRUMB\s*>/gi, '').replace(/<\s*SAVE_MEMORY\b[^>]*>[\s\S]*?<\s*\/\s*SAVE_MEMORY\s*>/gi, '').replace(/<ADD_TODO>[\s\S]*?<\/ADD_TODO>/g, '').replace(/<DONE_TODO[^>]*\/>/g, '').trim(); }
function stripDisplayTimestamp(text) { return String(text||'').replace(/^\s*(?:(?:⟦ts:[^⟧]*⟧|\[ts:\d{2}-\d{2}\s+\d{2}:\d{2}\]|\[\d{2}-\d{2}\s+\d{2}:\d{2}\])\s*)+/i, ''); }
const LEGACY_SHORT_MESSAGE_SEP_RE = /[\u001f\u2063]/g;
function legacyMessagePlain(content) {
    if (Array.isArray(content)) {
        return content.filter(x => x && x.type === 'text').map(x => legacyMessagePlain(x.text || '')).join(' ');
    }
    return String(content || '').replace(LEGACY_SHORT_MESSAGE_SEP_RE, '\n');
}
function hasLegacyShortMessageSeparator(content) {
    return typeof content === 'string' && /[\u001f\u2063]/.test(content);
}
function msgContentOf(msg) {
    if (!msg) return '';
    const version = getActiveVersion(msg);
    const content = version && version.content !== undefined ? version.content : msg.content;
    return typeof content === 'string' ? content : '';
}
function renderMarkdown(text, stripWakeArtifacts = false) { if (!text) return ''; text = legacyMessagePlain(stripDisplayTimestamp(text)); if (stripWakeArtifacts && window.AssistantArtifacts) { text = window.AssistantArtifacts.extractReactionTag(text, { partial: true }).cleanText; text = window.AssistantArtifacts.extractNextWakeTag(text).cleanText; } if (typeof marked !== 'undefined') { try { return marked.parse(stripInternalTags(text)); } catch(e) { return stripInternalTags(text); } } return stripInternalTags(text).replace(/\n/g, '<br>'); }

// ==================== 版本化消息辅助函数 ====================
function getActiveVersion(msg) { if (msg.versions && msg.versions.length > 0) { const idx = msg.activeVersion || 0; const v = msg.versions[idx] || msg.versions[0] || {}; if (v.content === undefined && msg.content !== undefined) v.content = msg.content; if (v.thinking === undefined && msg.thinking !== undefined) v.thinking = msg.thinking; if (v.reasoning === undefined && msg.reasoning !== undefined) v.reasoning = msg.reasoning; if (v.time === undefined && msg.time !== undefined) v.time = msg.time; if (v.fullTime === undefined && msg.fullTime !== undefined) v.fullTime = msg.fullTime; if (v.model === undefined && msg.model !== undefined) v.model = msg.model; if (v.image === undefined && msg.image !== undefined) v.image = msg.image; if (v.toolCalls === undefined && msg.toolCalls !== undefined) v.toolCalls = msg.toolCalls; return v; } return msg; }
function normalizeMessageVersionFields(msg) { if (!msg) return msg; if (msg.versions && msg.versions.length > 0) { const idx = msg.activeVersion || 0; const v = msg.versions[idx] || msg.versions[0]; if (!v) return msg; if (v.content === undefined && msg.content !== undefined) v.content = msg.content; if (v.thinking === undefined && msg.thinking !== undefined) v.thinking = msg.thinking; if (v.reasoning === undefined && msg.reasoning !== undefined) v.reasoning = msg.reasoning; if (v.time === undefined && msg.time !== undefined) v.time = msg.time; if (v.fullTime === undefined && msg.fullTime !== undefined) v.fullTime = msg.fullTime; if (v.model === undefined && msg.model !== undefined) v.model = msg.model; if (v.image === undefined && msg.image !== undefined) v.image = msg.image; if (v.toolCalls === undefined && msg.toolCalls !== undefined) v.toolCalls = msg.toolCalls; return msg; } ensureVersioned(msg); return msg; }
function fmtTsTag(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    var hh = String(d.getHours()).padStart(2, '0');
    var mi = String(d.getMinutes()).padStart(2, '0');
    return '⟦ts:' + mm + '-' + dd + ' ' + hh + ':' + mi + '⟧ ';
}
window.fmtTsTag = fmtTsTag;
function getVersionCount(msg) { return (msg.versions && msg.versions.length) ? msg.versions.length : 1; }
function getActiveVersionIndex(msg) { if (msg.versions && msg.versions.length > 0) return msg.activeVersion || 0; return 0; }
function ensureVersioned(msg) {
    if (msg.versions) return;
    const { role, mode, segments, segTimes, segImages, ...rest } = msg;
    if (mode === 'sms' || segments || hasLegacyShortMessageSeparator(rest.content)) {
        rest.content = legacyMessagePlain(rest.content || (Array.isArray(segments) ? segments.join('\n') : ''));
    }
    msg.versions = [rest];
    msg.activeVersion = 0;
    delete msg.content;
    delete msg.thinking;
    delete msg.time;
    delete msg.model;
    delete msg.fullTime;
    delete msg.image;
    delete msg.mode;
    delete msg.segments;
    delete msg.segTimes;
    delete msg.segImages;
}

// ==================== WebSocket 实时推送 ====================
const SYZYGY_TAB_ID = 'tab_' + Math.random().toString(36).substr(2, 8);
let _ws = null, _wsReconnectTimer = null;
let _lastResyncAt = 0;
let _wsConnectedOnce = false;
function connectWebSocket() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    _ws = new WebSocket(proto + '//' + location.host + '?tabId=' + SYZYGY_TAB_ID);
    _ws.onopen = () => {
        _ws.send(JSON.stringify({ type: 'register', tabId: SYZYGY_TAB_ID }));
        // 首次连接由 startSystem() 的 syncFromCloud 负责，这里只处理"重连"
        if (_wsConnectedOnce) resyncIfStale('ws-reconnect');
        _wsConnectedOnce = true;
    };
    _ws.onmessage = (e) => { try { const msg = JSON.parse(e.data); handleWSMessage(msg); } catch(e) {} };
    _ws.onclose = (e) => { console.log('🔌 [WS] 断开 code=' + (e ? e.code : '?') + ' reason=' + (e ? (e.reason || '').substring(0,60) : '')); clearTimeout(_wsReconnectTimer); _wsReconnectTimer = setTimeout(connectWebSocket, 3000); };
    _ws.onerror = () => { _ws.close(); };
}
function handleWSMessage(msg) {
    switch (msg.type) {
        case 'dream_done': handleDreamDone(msg); break;
        case 'memory_saved':
        case 'memory_updated': handleMemorySaved(msg); break;
        case 'crumb_saved': toast('生活碎屑已保存'); break;
        case 'memory_event_received': toast(msg.event?.kind === 'crumb' ? '已收进星尘，正在整理' : '已收进记忆，正在整理'); break;
        case 'memory_event_attention': toast('有一条记忆需要确认'); break;
        case 'memory_write_failed': toast(msg.message || '记忆保存失败，请稍后重试'); break;
        case 'memory_merge_review': toast('有一条记忆合并建议待确认'); break;
        case 'private_journal_written':
        case 'private_journal_requested':
            if (document.getElementById('sec-private-journal')?.classList.contains('active')) privateJournalLoad(true);
            break;
        case 'private_journal_revealed':
            toast('沈望打开了一页日记');
            if (document.getElementById('sec-private-journal')?.classList.contains('active')) privateJournalLoad(true);
            break;
        case 'private_journal_kept_sealed':
            toast('沈望决定让这一页继续锁着');
            if (document.getElementById('sec-private-journal')?.classList.contains('active')) privateJournalLoad(true);
            break;
        case 'proactive_message': handleProactiveMessage(msg); break;
        case 'tt_research_ready':
            toast(msg.job?.status === 'completed'
                ? `TT 已查完「${msg.job.title || '资料'}」，卷宗放进沈望口袋了`
                : `TT 的「${msg.job?.title || '资料'}」这次没查完，卷宗状态已保留`);
            break;
        case 'codex_dispatch_result': {
            const session = chatSessions.find(s => s.id === msg.sessionId);
            if (session && msg.message?._id) {
                session.messages ||= [];
                if (!session.messages.some(m => m._id === msg.message._id)) session.messages.push(msg.message);
                // Already persisted by the server; a stale local snapshot must
                // not overwrite another tab's conversation changes.
                if (activeChatId === session.id) renderChatMessages({ forceBottom: true });
                toast('Codex 后台任务已交回');
            }
            break;
        }
        case 'workroom_brief_ready':
            void loadWorkroomBriefCards();
            break;
        case 'todo_added':
        case 'todo_updated':
        case 'todo_deleted': neuRenderTodos(); break;
        case 'trace_event':
        case 'trace_done': handleTraceWS(msg); break;
    }
}
function handleProactiveMessage(msg) {
    const mainSession = chatSessions.find(s => s.id === 'main');
    if (mainSession) {
        if (!mainSession.messages) mainSession.messages = [];
        const duplicate = mainSession.messages.some(m => {
            const v = getActiveVersion(m);
            if (msg.id && (m._id === msg.id || m.id === msg.id || v._id === msg.id)) return true;
            return m.role === 'assistant' && normForDedup(v.content) === normForDedup(msg.content) &&
                Math.abs(new Date(v.fullTime || 0).getTime() - new Date(msg.fullTime || 0).getTime()) < 2 * 60 * 1000;
        });
        if (!duplicate) {
            mainSession.messages.push({ _id: msg.id || ('proactive_' + (msg.fullTime || Date.now())), role: 'assistant', versions: [{ content: msg.content, fullTime: msg.fullTime || new Date().toISOString(), time: msg.time || '', model: 'proactive' }], activeVersion: 0 });
            // The server has already persisted this message. Do not immediately
            // write the whole local snapshot back and race with that update.
            if (activeChatId === 'main') renderChatMessages({ forceBottom: true });
        }
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
/* 归一化去重：去掉 ||| 和所有空白，让 "a|||b" 和 "a\nb" 得到同一个串 */
function normForDedup(s) {
  return legacyMessagePlain(s).replace(/\|\|\|/g, '').replace(/\s+/g, '');
}

// Time prefixes belong to the model prompt only. They must never become part
// of a cross-device message identity or visible chat content.
function stripTransportTimePrefix(content) {
  return stripDisplayTimestamp(content);
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
let shenReactionEnabled = true;
let modelSwitchNoticeEnabled = true;
let workroomBriefCards = [];
const WORKROOM_ID = 'syzygy-workroom';
const CHAT_HISTORY_INITIAL_LIMIT = 80;
const CHAT_HISTORY_PAGE_SIZE = 80;
const MODEL_LIST_CACHE_KEY = 'syzygy_model_lists_v1';
const MODEL_LIST_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const MODEL_LIST_REQUEST_TIMEOUT = 14000;
let _modelFetchSequence = 0;
let _historyWindows = {};
let _visibleMessageCounts = {};
let _historyLoading = false;
let privateJournalEntries = [];
let privateJournalPage = 1;
let privateJournalTotal = 0;
let privateJournalLoadRevision = 0;
let privateJournalLoading = false;

function syncConfigUrl() {
    return '/api/sync-config?mainLimit=' + CHAT_HISTORY_INITIAL_LIMIT;
}

function updateHistoryWindows(windows, reset = false) {
    if (reset) _historyWindows = {};
    for (const [sessionId, incoming] of Object.entries(windows || {})) {
        const next = {
            start: Math.max(0, Number(incoming.start) || 0),
            total: Math.max(0, Number(incoming.total) || 0),
            hasMore: Boolean(incoming.hasMore),
            partial: Boolean(incoming.partial)
        };
        const current = _historyWindows[sessionId];
        if (!reset && current && current.start < next.start) {
            next.start = current.start;
            next.hasMore = current.start > 0;
            next.partial = current.start > 0;
        }
        _historyWindows[sessionId] = next;
    }
}

function historyWindowsForPayload(clone) {
    const payload = {};
    for (const session of clone || []) {
        const state = _historyWindows[session.id];
        if (!state) continue;
        const original = chatSessions.find(item => item.id === session.id);
        const originalLength = Array.isArray(original?.messages) ? original.messages.length : 0;
        const clonedLength = Array.isArray(session.messages) ? session.messages.length : 0;
        const droppedByCap = Math.max(0, originalLength - clonedLength);
        const start = Math.max(0, state.start + droppedByCap);
        if (start > 0) payload[session.id] = { start, total: state.total, partial: true };
    }
    return payload;
}

function ensureWorkroomSession() {
    let room = chatSessions.find(session => session.id === WORKROOM_ID);
    if (!room) {
        room = {
            id: WORKROOM_ID,
            name: '共创工作区',
            type: 'codex-workroom',
            messages: [],
            codexTaskId: null,
            codexLastTurnId: null
        };
        chatSessions.push(room);
    } else {
        room.type = 'codex-workroom';
        room.name = room.name || '共创工作区';
        room.messages = Array.isArray(room.messages) ? room.messages : [];
    }
    return room;
}

function isWorkroomSession(session = getActiveSession()) {
    return Boolean(session && (session.id === WORKROOM_ID || session.type === 'codex-workroom'));
}

let _dataVersion = 0;
function acceptDataVersion(version) {
    const next = Number(version) || 0;
    _dataVersion = Math.max(_dataVersion, next);
    return _dataVersion;
}

function syncShenReactionToggle() {
    const toggle = document.getElementById('shenReactionToggle');
    if (toggle) toggle.checked = shenReactionEnabled;
}

function syncModelSwitchNoticeToggle() {
    const toggle = document.getElementById('modelSwitchNoticeToggle');
    if (toggle) toggle.checked = modelSwitchNoticeEnabled;
    const status = document.getElementById('modelSwitchNoticeStatus');
    if (status) status.textContent = modelSwitchNoticeEnabled
        ? '只在 Gemini 与 Claude 之间切换时告知对话模型'
        : '已关闭；切换时不会告知对话模型';
}

function modelSwitchNoticeFor(session, selectedModel) {
    if (!modelSwitchNoticeEnabled || !window.ModelFamily?.label(selectedModel)) return false;
    const messages = Array.isArray(session?.messages) ? session.messages : [];
    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index];
        if (message?.role !== 'assistant' || message?.speaker === 'codex') continue;
        const previousModel = getActiveVersion(message)?.model;
        if (!window.ModelFamily.label(previousModel)) continue;
        return window.ModelFamily.switched(previousModel, selectedModel);
    }
    return false;
}

async function syncFromCloud() {
    try {
        const data = await loadCloudConfig();
        _dataVersion = data._version || 0;
        updateHistoryWindows(data._historyWindows, true);

        suppliers = (data.suppliers && data.suppliers.length) ? data.suppliers : [{ name: "默认接口", url: "https://api.dzzi.ai/v1", key: "" }];
        const cloudSessions = (data.chatSessions && data.chatSessions.length) ? data.chatSessions : [{ id: 'main', name: '主频道', messages: [] }];
        ContextContinuity.ensureMessageIds(cloudSessions, () => crypto.randomUUID());
        _chatJournal.observe(cloudSessions);
        const recovery = _chatJournal.restore(cloudSessions);
        chatSessions = recovery.sessions;
        ensureWorkroomSession();
        activeSupIndex = data.activeSupIndex || 0;
        activeChatId   = data.activeChatId  || 'main';
        shenReactionEnabled = data.preferences?.shenReactionEnabled !== false;
        modelSwitchNoticeEnabled = data.preferences?.modelSwitchNoticeEnabled !== false;
        if (typeof syncShenReactionToggle === 'function') syncShenReactionToggle();
        if (typeof syncModelSwitchNoticeToggle === 'function') syncModelSwitchNoticeToggle();

        if (!chatSessions.find(s => s.id === activeChatId)) {
            activeChatId = chatSessions[0].id;
        }

        // 迁移旧字段，并在首次加载时清掉已经落盘的近时重复回复。
        for (const s of chatSessions) {
            if (!s.messages) continue;
            for (const m of s.messages) normalizeMessageVersionFields(m);
            s.messages = mergeMessageLists([], s.messages).filter(m => !isDirtyFallbackMessage(m));
        }

        renderSuppliers();
        renderChatSidebar();
        renderChatMessages();
        updateWorkroomChrome();
        if (typeof loadWorkroomBriefCards === 'function') void loadWorkroomBriefCards();
        fetchModels();
        if (recovery.restored) saveMessageChangesToCloud(true);

        const viewTitle = document.getElementById('chatViewTitle');
        if (viewTitle) {
            const curSession = chatSessions.find(s => s.id === activeChatId) || chatSessions[0];
            viewTitle.innerText = '通讯 · ' + (curSession ? curSession.name : '主频道');
        }

    } catch(e) {
        console.error('[sync] load failed:', e.message);
        // Pending new messages remain in the journal until cloud loading succeeds.
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
let _saveMutationEpoch = 0;
let _saveCommittedEpoch = 0;
const _chatJournal = ChatPersistence.createJournal(localStorage);
let _preservePendingHistory = false;
async function loadCloudConfig() {
    // Recovery uses the full history so older queued messages cannot be mistaken
    // for new tail entries or shift the partial-save boundary.
    const full = _chatJournal.hasPending();
    const data = await ChatPersistence.requestJson(full ? '/api/sync-config' : syncConfigUrl());
    if (!Array.isArray(data.chatSessions)) throw new Error('云端聊天数据格式异常');
    if (full) {
        _preservePendingHistory = true;
        data._historyWindows = Object.fromEntries(data.chatSessions.map(s =>
            [s.id, { start: 0, total: (s.messages || []).length, hasMore: false, partial: false }]));
    }
    return data;
}
function hasUnsavedCloudChanges() { return _saveCommittedEpoch < _saveMutationEpoch; }
function _showSaveWarning(show, errMsg) {
    let el = document.getElementById('saveWarning');
    if (show) {
        if (errMsg) _lastSaveError = errMsg;
        if (!el) {
            el = document.createElement('div');
            el.id = 'saveWarning';
            el.style.cssText = 'position:fixed;bottom:80px;right:16px;max-width:calc(100vw - 32px);color:inherit;background:var(--bg-color,rgba(128,128,128,.12));padding:4px 9px;border-radius:10px;font-size:10px;opacity:.65;z-index:9999;white-space:normal;';
            el.setAttribute('role', 'status');
            el.setAttribute('aria-live', 'polite');
            document.body.appendChild(el);
        }
        el.textContent = '暂未同步 · 稍后重试';
        el.title = _lastSaveError || '同步暂未完成';
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
        messages: (session.messages || []).map(msg => {
            return {
            ...msg,
            versions: (msg.versions || []).map(v => {
                const next = { ...v };
                delete next.image;
                delete next.images;
                return next;
            })
        };
        })
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
    // 优先用稳定 id（新消息），回退到 fullTime，再回退到内容 hash
    if (m._id) return 'I' + m._id;
    if (m.id) return 'I' + m.id;
    const v = getActiveVersion(m);
    if (m._id || v._id) return 'I' + (m._id || v._id);
    if (v.fullTime) return 'T' + v.fullTime;
    return 'H' + m.role + '|' + simpleContentHash(v.content);
}

function simpleContentHash(c) {
    if (typeof c !== 'string') c = JSON.stringify(c || '');
    c = legacyMessagePlain(c).replace(/\n/g, '');
    var h = 0, i; for (i = 0; i < c.length; i++) { h = ((h << 5) - h + c.charCodeAt(i)) | 0; }
    return Math.abs(h).toString(36).substring(0, 8);
}

/* 归一化消息正文：用于跨来源内容比对 */
function normMsgText(m) {
  const v = (typeof getActiveVersion === 'function') ? getActiveVersion(m) : m;
  let c = (m.segments || v.segments || []).join('') || v.content || m.content || '';
  if (Array.isArray(c)) {
    c = c.filter(function(x) { return x && x.type === 'text'; }).map(function(x) { return x.text || ''; }).join('');
  }
  return legacyMessagePlain(stripTransportTimePrefix(c)).replace(/\|\|\|/g, '').replace(/\s+/g, '');
}

function msgTimeMs(m) {
  const v = (typeof getActiveVersion === 'function') ? getActiveVersion(m) : m;
  const raw = v.fullTime || m.fullTime || '';
  const parsed = raw ? new Date(raw).getTime() : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

// 不用正文去重普通短句；只处理时间极近、正文完全相同的较长 assistant 回声。
function isNearDuplicateAssistant(a, b) {
  if (!a || !b || a.role !== 'assistant' || b.role !== 'assistant') return false;
  const textA = normMsgText(a), textB = normMsgText(b);
  if (!textA || textA.length < 16 || textA !== textB) return false;
  const timeA = msgTimeMs(a), timeB = msgTimeMs(b);
  return timeA !== null && timeB !== null && Math.abs(timeA - timeB) <= 90 * 1000;
}

function messagesEquivalentForSync(a, b) {
  return msgKey(a) === msgKey(b) || isNearDuplicateAssistant(a, b);
}

/* 丢弃无 ID 的服务端回声，避免覆盖浏览器已经保存的同一条消息。 */
function dropServerEchoes(msgs) {
  const authored = new Set();
  for (var i = 0; i < msgs.length; i++) {
    var m = msgs[i];
    var id = String(m._id || m.id || '');
    if (!id) continue;
    var t = normMsgText(m);
    if (t) authored.add(m.role + '|' + t);
  }
  return msgs.filter(function (m) {
    var id = String(m._id || m.id || '');
    var isEcho = !id;
    if (!isEcho) return true;
    var t = normMsgText(m);
    if (t && authored.has(m.role + '|' + t)) {
      console.log('[merge] 丢弃服务端回声: ' + t.slice(0, 30));
      return false;
    }
    return true;
  });
}

/* 消息信息量评分：兼容旧版碎条消息，迁移时优先保留信息更完整的一份。 */
function messageRichness(m) {
  if (!m) return -1;
  const v = (typeof getActiveVersion === 'function' ? getActiveVersion(m) : {}) || {};
  let n = 0;
  const c = (typeof msgContentOf === 'function') ? msgContentOf(m) : '';
  if (hasLegacyShortMessageSeparator(c)) n += 8;
  if (m.mode === 'sms' || v.mode === 'sms') n += 4;
  if ((m.segments || v.segments || []).length) n += 4;
  if ((m.segTimes || v.segTimes || []).length) n += 1;
  if (m.images || v.images || m.image || v.image) n += 1;
  return n;
}

/* 🛡️ 检测兜底脏消息（断连时生成的假消息） */
function isDirtyFallbackMessage(m) {
    if (!m) return true;
    const v = (typeof getActiveVersion === 'function' ? getActiveVersion(m) : {}) || {};
    const c = (typeof msgContentOf === 'function') ? msgContentOf(m) : (v.content || m.content || '');
    return String(c).indexOf('数据加载失败，请刷新页面重试') !== -1
        || ((m._failed || v._failed) && String(c).startsWith('【发送失败】'));
}

// 合并两条消息数组，按 key 去重，按时间排序
function mergeMessageLists(serverMsgs, localMsgs) {
    const out = [];
    const seen = new Map(); // key -> out 中的下标

    function push(m) {
        if (!m) return;
        if (isDirtyFallbackMessage(m)) { console.warn('[merge] 丢弃兜底脏消息: ' + String((m.versions?.[m.activeVersion||0]||m)?.content||'').substring(0,30)); return; }
        const k = msgKey(m);
        if (seen.has(k)) {
            const i = seen.get(k);
            const cur = out[i];
            const rm = messageRichness(m), rc = messageRichness(cur);
            if (rm > rc || (rm === rc && getVersionCount(m) > getVersionCount(cur))) {
              out[i] = m;
            }
            return;
        }
        const duplicateIndex = out.findIndex(existing => isNearDuplicateAssistant(existing, m));
        if (duplicateIndex !== -1) {
            const current = out[duplicateIndex];
            const currentId = String(current._id || current.id || '');
            const incomingId = String(m._id || m.id || '');
            const currentCanonical = Boolean(currentId);
            const incomingCanonical = Boolean(incomingId);
            const currentScore = messageRichness(current) + getVersionCount(current);
            const incomingScore = messageRichness(m) + getVersionCount(m);
            if ((!currentCanonical && incomingCanonical) || incomingScore > currentScore) out[duplicateIndex] = m;
            seen.set(k, duplicateIndex);
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
    return dropServerEchoes(keyed.map(function (x) { return x.m; }));
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
let _resyncPendingReason = null;

// 从服务端拉取并与本地合并。返回 { serverAdded, localOnly } 或 null
async function resyncAndMerge(reason) {
    if (_isStreamingReply) {
        console.log('[resync] 流式进行中，跳过: ' + reason);
        _resyncPendingReason = reason;
        return null;
    }
    if (_syncing) return await _syncingPromise;
    _syncing = true;
    _syncingPromise = (async () => {
    try {
        const data = await loadCloudConfig();
        const serverSessions = data.chatSessions || [];
        ContextContinuity.ensureMessageIds(serverSessions, () => crypto.randomUUID());
        _chatJournal.observe(serverSessions);

        let serverAdded = 0, localOnly = 0;
        const localById = {};
        (chatSessions || []).forEach(function (s) { if (s && s.id) localById[s.id] = s; });
        serverSessions.forEach(function (ss) {
            if (_deletedSessionIds.has(ss.id)) return;
            const ls = localById[ss.id];
            const localMessages = (ls && ls.messages) || [];
            const serverMessages = ss.messages || [];
            serverMessages.forEach(function (m) {
                if (!localMessages.some(function (local) { return messagesEquivalentForSync(local, m); })) serverAdded++;
            });
            if (!data._historyWindows?.[ss.id]?.partial) {
                localMessages.forEach(function (m) {
                    if (!serverMessages.some(function (server) { return messagesEquivalentForSync(server, m); })) localOnly++;
                });
            }
        });

        chatSessions = mergeSessionLists(serverSessions, chatSessions);
        _dataVersion = data._version || 0;
        updateHistoryWindows(data._historyWindows, false);

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

let _loopLocalOnly = 0; let _loopCount = 0;

async function resyncIfStale(reason) {
    if (!mergeSyncEnabled()) return;
    if (Date.now() - _lastResyncAt < 10000) {
        if (hasUnsavedCloudChanges()) saveToCloud(true, true, true);
        return;   // 10 秒内不重复拉；未保存改动仍继续保存
    }
    _lastResyncAt = Date.now();
    const res = await resyncAndMerge(reason);
    const pendingLocalSave = hasUnsavedCloudChanges();
    if (res && (res.localOnly > 0 || pendingLocalSave)) {
        // 死循环保护：连续 3 次 localOnly 不下降就停止自动保存
        if (res.localOnly >= _loopLocalOnly && _loopLocalOnly > 0) {
            _loopCount++;
            if (_loopCount >= 3) {
                console.error('⚠️ [保存循环] localOnly=' + res.localOnly + ' 连续' + _loopCount + '次未下降，停止自动保存。可能是服务端写入竞态。');
                return;
            }
        } else { _loopCount = 0; }
        _loopLocalOnly = res.localOnly;
        saveToCloud(true, pendingLocalSave, true);
    }
}

function compactMessageForPersistence(message) {
    if (message.versions && message.versions.length > 5) {
        message.versions = [message.versions[0], ...message.versions.slice(-4)];
        if (message.activeVersion >= message.versions.length) message.activeVersion = message.versions.length - 1;
    }
    const versions = Array.isArray(message.versions) && message.versions.length ? message.versions : [message];
    for (const version of versions) {
        if (typeof version.rawContent === 'string' && version.rawContent === version.content) delete version.rawContent;
        if (typeof version.reasoning === 'string' && version.reasoning === version.thinking) delete version.reasoning;
    }
    delete message._zepDirty;
    return message;
}

function prepareIncrementalChatPatch() {
    const snapshot = _chatJournal.pendingSnapshot();
    for (const session of snapshot) {
        session.messages = (session.messages || []).filter(message => !isDirtyFallbackMessage(message));
        for (const message of session.messages) compactMessageForPersistence(message);
    }
    return snapshot.filter(session => session.messages.length);
}

async function _doIncrementalSave(startedAt) {
    const journalSnapshot = _chatJournal.pendingSnapshot();
    const patchSnapshot = prepareIncrementalChatPatch();
    if (!patchSnapshot.length) {
        try { _chatJournal.acknowledge(journalSnapshot); } catch (error) { console.warn('[backup] 清理临时失败状态失败:', error.message); }
        console.log('[save:SKIP] no pending messages ' + (Date.now() - startedAt) + 'ms');
        return;
    }
    const payloadText = JSON.stringify({ _version: _dataVersion, sessions: patchSnapshot });
    const payloadBytes = new Blob([payloadText]).size;
    if (payloadBytes > 15 * 1024 * 1024) throw new Error('本轮消息或附件超过 15 MB，请减少图片数量');
    const d = await ChatPersistence.requestJson('/api/chat-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payloadText
    });
    if (d._rejected) {
        const res = await resyncAndMerge('incremental-version-conflict');
        if (!res) throw new Error('增量保存发生版本冲突，重新同步失败，稍后重试');
        throw new Error('增量保存发生版本冲突，已重新同步并准备重试');
    }
    if (d.success !== true || !d._version) throw new Error(d.message || '服务器未确认增量保存，稍后重试');
    _dataVersion = d._version;
    try { _chatJournal.acknowledge(journalSnapshot); } catch (error) { console.warn('[backup] 确认状态写入失败:', error.message); }
    if (!_chatJournal.hasPending()) _preservePendingHistory = false;
    _loopCount = 0; _loopLocalOnly = 0;
    console.log('[save:OK] incremental v' + _dataVersion + ' ' + (Date.now() - startedAt) + 'ms ' + (payloadBytes / 1024).toFixed(0) + 'KB');
}

async function _doSave(incrementalOnly = false) {
    var _t0 = Date.now();
    // 🛡️ 拒绝保存脏兜底状态（防止断连时把空数据覆盖到服务端）
    if (_hasDirtyFallbackState()) {
        console.warn('[save:ABORT] 数据为脏兜底状态，拒绝保存 ' + (Date.now()-_t0) + 'ms');
        _showSaveWarning(true, '数据未正常加载，请刷新页面');
        throw new Error('脏兜底状态，拒绝保存');
    }
    // Never save if we haven't loaded cloud data yet (prevents wiping real data with empty state)
    if (!_dataVersion) {
        console.warn('[sync-config] 云端数据未加载，先尝试拉取');
        await resyncAndMerge('pre-save-bootstrap');
        if (!_dataVersion) {
            _showSaveWarning(true, '云端数据未加载，暂不保存，请刷新页面');
            console.log('[save:ABORT] bootstrap failed ' + (Date.now()-_t0) + 'ms');
            throw new Error('云端数据未加载');
        }
    }
    if (incrementalOnly) return _doIncrementalSave(_t0);
    var MAX_SYNC_BYTES = 15 * 1024 * 1024; // Below the server's 50 MB request limit.

    // 1. 深拷贝 chatSessions — 不影响内存中的原始数据
    ContextContinuity.ensureMessageIds(chatSessions, () => crypto.randomUUID());
    var clone;
    try { clone = structuredClone(chatSessions); } catch (_e) { clone = JSON.parse(JSON.stringify(chatSessions)); }
    const journalSnapshot = JSON.parse(JSON.stringify(clone));

    // 2. 常规处理
    for (var si = 0; si < clone.length; si++) {
        var s = clone[si];
        if (!s.messages) continue;
        cleanupOldImages(s);
        if (!_preservePendingHistory) ContextContinuity.trimContextWindow(s, getActiveVersion);
        for (var mi = 0; mi < s.messages.length; mi++) {
            var m = s.messages[mi];
            compactMessageForPersistence(m);
        }
    }

    // 3. 构造 payload
    var payloadObj = { suppliers: suppliers, chatSessions: clone, activeSupIndex: activeSupIndex, activeChatId: activeChatId, _version: _dataVersion, _historyWindows: historyWindowsForPayload(clone) };
    var payloadText = JSON.stringify(payloadObj);
    var payloadBytes = new Blob([payloadText]).size;

    // 4. 超过 15 MB → 从最旧的图片轮次开始逐轮移除
    if (payloadBytes > MAX_SYNC_BYTES) {
        console.warn('[sync-config] payload 超 ' + (MAX_SYNC_BYTES / 1024 / 1024) + ' MB (' + (payloadBytes / 1024 / 1024).toFixed(1) + ' MB)，逐轮移除最旧图片');
        while (payloadBytes > MAX_SYNC_BYTES && _stripOldestImgRound(clone)) {
            payloadText = JSON.stringify(payloadObj);
            payloadBytes = new Blob([payloadText]).size;
        }
        if (payloadBytes > MAX_SYNC_BYTES) {
            console.error('[sync-config] 请求仍超限制 (' + (payloadBytes / 1024 / 1024).toFixed(1) + ' MB)，包含文字、设置及保留的媒体');
            throw new Error('待同步数据超过 15 MB，请导出备份后整理过大的频道或附件。');
        }
    }

    var keptRounds = _countImgRounds(clone);
    console.log('[sync-config] ' + (payloadBytes / 1024 / 1024).toFixed(2) + ' MB, 保留 ' + keptRounds + ' 个图片轮次');

    // 5. 发送
    var d = await ChatPersistence.requestJson('/api/sync-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payloadText
    });
    if (d._rejected) {
        if (mergeSyncEnabled()) {
            console.warn('🛡️ [版本落后] 服务端有更新，拉取合并后重试');
            const res = await resyncAndMerge('version-conflict');
            if (!res) throw new Error('版本冲突且重新同步失败，稍后重试');
            console.log('[save:RETRY] version-conflict ' + (Date.now()-_t0) + 'ms');
            throw new Error('版本冲突，已重新同步，重试保存');
        }
        console.log('[save:ABORT] rejected (merge disabled) ' + (Date.now()-_t0) + 'ms');
        throw new Error('版本落后，保存被拒绝，请刷新页面');
    }
    if (d.success !== true || !d._version) throw new Error('服务器未确认保存，稍后重试');
    _dataVersion = d._version;
    for (const session of journalSnapshot) {
        const sentIds = new Set((clone.find(s => s.id === session.id)?.messages || []).map(m => m._id));
        session.messages = (session.messages || []).filter(m => sentIds.has(m._id));
    }
    try { _chatJournal.acknowledge(journalSnapshot); } catch (error) { console.warn('[backup] 确认状态写入失败:', error.message); }
    if (!_chatJournal.hasPending()) _preservePendingHistory = false;
    _loopCount = 0; _loopLocalOnly = 0;
    console.log('[save:OK] v' + _dataVersion + ' ' + (Date.now()-_t0) + 'ms ' + (payloadBytes/1024).toFixed(0) + 'KB');
}

let _savingNow = false;
let _saveQueued = false;
let _fullSaveRequiredEpoch = 0;
let _fullSaveCommittedEpoch = 0;

function saveMessageChangesToCloud(immediate) {
    return saveToCloud(immediate, false, true);
}

function saveToCloud(immediate, preserveMutationEpoch = false, messagesOnly = false) {
    if (!preserveMutationEpoch) _saveMutationEpoch++;
    if (!messagesOnly) _fullSaveRequiredEpoch = Math.max(_fullSaveRequiredEpoch, _saveMutationEpoch);
    saveLocalBackup();
    clearTimeout(_saveTimer);
    if ((typeof activeChatRequest !== 'undefined' && activeChatRequest)
        || (typeof _isStreamingReply !== 'undefined' && _isStreamingReply)) {
        _saveTimer = null;
        _saveQueued = true;
        console.log('[save:DEFER] chat request active');
        return Promise.resolve();
    }
    const doSave = async () => {
        _saveTimer = null;
        if (_savingNow) { _saveQueued = true; console.log('[save:LOCK] queued'); return; }
        const targetEpoch = _saveMutationEpoch;
        const targetFullEpoch = _fullSaveRequiredEpoch;
        const needsFullSave = _fullSaveCommittedEpoch < targetFullEpoch;
        _savingNow = true;
        try {
            const delays = [1000, 2000, 4000]; // 指数退避
            for (let attempt = 0; attempt <= delays.length; attempt++) {
                try {
                    await _doSave(!needsFullSave);
                    _saveCommittedEpoch = Math.max(_saveCommittedEpoch, targetEpoch);
                    if (needsFullSave) _fullSaveCommittedEpoch = Math.max(_fullSaveCommittedEpoch, targetFullEpoch);
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
            if (_saveQueued) { _saveQueued = false; saveToCloud(true, true, true); }
            else if (hasUnsavedCloudChanges() && !document.hidden) {
                _saveTimer = setTimeout(() => saveToCloud(true, true, true), 30000);
            }
        }
    };
    if (immediate) return doSave(); else _saveTimer = setTimeout(doSave, 500);
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
    window.shenSettingsRefreshOverview?.();
}

// ==================== 通用工具 & 防黑屏 ====================
function toast(msg){
    const t = document.getElementById('toast');
    if(!t) return;
    clearTimeout(t._hideTimer); clearTimeout(t._settleTimer);
    t.innerText = msg; t.classList.remove('is-hiding'); t.classList.add('show');
    t._hideTimer = setTimeout(() => {
        t.classList.add('is-hiding'); t.classList.remove('show');
        t._settleTimer = setTimeout(() => t.classList.remove('is-hiding'), 400);
    }, 2800);
}

const VIEW_ASSET_BUNDLES = { ledger:'home-tools', calendar:'home-tools', album:'home-tools', state:'home-tools' };
const _viewAssetPromises = {};

function loadViewAssets(viewId) {
    const bundle = VIEW_ASSET_BUNDLES[viewId];
    if (!bundle) return null;
    if (_viewAssetPromises[bundle]) return _viewAssetPromises[bundle];
    const stylesheet = new Promise((resolve, reject) => {
        const existing = document.querySelector('link[data-view-bundle="' + bundle + '"]');
        if (existing) return existing.dataset.loaded === 'true' ? resolve() : (existing.addEventListener('load', resolve, { once:true }), existing.addEventListener('error', reject, { once:true }));
        const link = document.createElement('link');
        link.rel = 'stylesheet'; link.href = bundle + '.css?v=1'; link.dataset.viewBundle = bundle;
        link.addEventListener('load', () => { link.dataset.loaded = 'true'; resolve(); }, { once:true });
        link.addEventListener('error', () => { link.remove(); reject(new Error('样式加载失败')); }, { once:true });
        document.head.appendChild(link);
    });
    const script = new Promise((resolve, reject) => {
        const existing = document.querySelector('script[data-view-bundle="' + bundle + '"]');
        if (existing) return existing.dataset.loaded === 'true' ? resolve() : (existing.addEventListener('load', resolve, { once:true }), existing.addEventListener('error', reject, { once:true }));
        const element = document.createElement('script');
        element.src = bundle + '.js?v=1'; element.dataset.viewBundle = bundle;
        element.addEventListener('load', () => { element.dataset.loaded = 'true'; resolve(); }, { once:true });
        element.addEventListener('error', () => { element.remove(); reject(new Error('功能加载失败')); }, { once:true });
        document.body.appendChild(element);
    });
    _viewAssetPromises[bundle] = Promise.all([stylesheet, script]).catch(error => {
        delete _viewAssetPromises[bundle];
        throw error;
    });
    return _viewAssetPromises[bundle];
}

function initializeView(viewId) {
    if (viewId === 'favorites') loadAndRenderFavorites();
    if (viewId === 'dev') devRefreshOverview();
    if (viewId === 'console') { const tab = localStorage.getItem('syzygy_console_tab') || 'logs'; switchConsoleTab(tab); if (tab === 'terminal') consoleOpen(); }
    if (viewId === 'flo') floRender();
    if (viewId === 'calendar') calRender();
    if (viewId === 'ledger') ledgerRender();
    if (viewId === 'private-journal') privateJournalLoad(true);
    if (viewId === 'shen-settings') shenSettingsLoad();
    if (viewId === 'codex-settings') codexSettingsLoad();
    if (viewId === 'work-records') codexRecordsLoad();
    if (viewId === 'tt-memories') ttMemoriesLoad();
    if (viewId === 'album') { albumInitMonthFilter(); albumLoad(); }
    if (viewId === 'state') stateRender();
}

function goView(viewId) {
    if (viewId === 'chat' && activeChatId !== 'main') switchChatWindow('main');
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    const map = { home:'sec-home', chat:'sec-chat', favorites:'sec-favorites', dev:'sec-dev', console:'sec-console', flo:'sec-flo', calendar:'sec-calendar', album:'sec-album', state:'sec-state', ledger:'sec-ledger', 'private-journal':'sec-private-journal', settings:'sec-app-settings' };
    map['shen-settings'] = 'sec-shen-settings';
    map['codex-settings'] = 'sec-codex-settings';
    map['work-records'] = 'sec-work-records';
    map['tt-memories'] = 'sec-tt-memories';
    const target = document.getElementById(map[viewId]);
    if (!target) return;
    target.classList.add("active"); document.body.dataset.view = viewId;
    window.SyzygyLocation?.setChatActive(viewId === 'chat');
    window.SeaJournal?.sync();
    const metaTheme = document.getElementById('theme-color-meta');
    if (metaTheme) metaTheme.setAttribute('content', getVisualThemeColor(viewId));
    const VIEWS = ['home','chat','favorites','dev','console','flo','calendar','album','state','ledger','private-journal','settings'];
    VIEWS.push('shen-settings', 'codex-settings', 'work-records', 'tt-memories');
    document.body.classList.remove(...VIEWS.map(v => 'view-' + v));
    document.body.classList.add('view-' + viewId);
    if (viewId === 'chat') { renderChatMessages(); setTimeout(() => { forceScrollToChatBottom && forceScrollToChatBottom(); }, 300); fetchPulseStatus(); }
    if (viewId === 'home') { updateDays && updateDays(); if (document.body.classList.contains('neu-mode')) neuInitHome(); }
    const loading = loadViewAssets(viewId);
    if (loading) {
        target.setAttribute('aria-busy', 'true');
        loading.then(() => {
            target.removeAttribute('aria-busy');
            if (document.body.dataset.view === viewId) initializeView(viewId);
        }).catch(error => {
            target.removeAttribute('aria-busy');
            console.error('[view] 按需资源加载失败:', error);
            if (document.body.dataset.view === viewId) toast('页面资源加载失败，请重试');
        });
    } else initializeView(viewId);
}

// ==================== 控制台 Tab 切换 ====================
function devOpenConsole(tab) {
    goView('console');
    setTimeout(function() { switchConsoleTab(tab || 'logs'); }, 0);
}



function devDescribeCodexPermissions(permissions) {
    const lines = [];
    const entries = permissions?.fileSystem?.entries;
    if (Array.isArray(entries)) {
        for (const entry of entries) {
            const target = entry?.path?.path || entry?.path?.pattern || entry?.path?.value?.path || entry?.path?.value?.kind;
            if (target) lines.push(`${entry.access === 'write' ? '写入' : entry.access === 'read' ? '读取' : '访问'}：${target}`);
        }
    }
    if (Array.isArray(permissions?.fileSystem?.write)) {
        for (const target of permissions.fileSystem.write) lines.push(`写入：${target}`);
    }
    if (permissions?.network?.enabled) lines.push('访问网络');
    return lines.join('\n') || 'Codex 请求临时扩大权限';
}

async function devRefreshOverview() {
    const status = document.getElementById('devStatus');
    const serverCard = document.getElementById('devServerMonitor');
    const serverDot = document.getElementById('devServerDot');
    const server = document.getElementById('devServerStat');
    const meta = document.getElementById('devServerMeta');
    if (status) { status.dataset.state = 'loading'; status.innerHTML = '<i></i>检查中'; }
    refreshDevicePanel();
    try {
        const [r, xhsResponse] = await Promise.all([
            fetch('/api/console/status', { cache: 'no-store' }),
            fetch('/api/xhs-walk/status', { cache: 'no-store' }),
        ]);
        const info = await r.json();
        const xhs = await xhsResponse.json().catch(() => ({}));
        const ready = r.ok && info && info.ok !== false && info.configured !== false;
        if (server) server.textContent = ready ? '在线' : '未配置';
        if (meta) meta.textContent = info?.name || '控制台连接';
        if (serverCard) serverCard.dataset.state = ready ? 'ready' : 'error';
        if (serverDot) serverDot.dataset.state = ready ? 'ready' : 'error';
        if (status) { status.dataset.state = ready ? 'ready' : 'error'; status.innerHTML = '<i></i>' + (ready ? '系统在线' : '需要检查'); }
        devRenderXhsMonitor(xhsResponse.ok ? xhs : null);
    } catch (e) {
        if (server) server.textContent = '离线';
        if (meta) meta.textContent = '无法取得状态';
        if (serverCard) serverCard.dataset.state = 'error';
        if (serverDot) serverDot.dataset.state = 'error';
        if (status) { status.dataset.state = 'error'; status.innerHTML = '<i></i>连接失败'; }
    }
}

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
async function loadRawLogs() {
    let pwd = localStorage.getItem('memoryPwd');
    if (!pwd) { pwd = prompt('管理密码:'); if (!pwd) return; localStorage.setItem('memoryPwd', pwd); }
    const filter = document.getElementById('logFilterInput')?.value || '';
    const url = '/debug-console?n=200&pwd=' + encodeURIComponent(pwd) + (filter ? '&filter=' + encodeURIComponent(filter) : '');
    const statusEl = document.getElementById('contextBudgetStatus');
    const cacheEl = document.getElementById('contextCacheStatus');
    try {
        const [logResponse, statusResponse] = await Promise.all([
            fetch(url, { cache: 'no-store' }),
            fetch('/api/context-budget/status?pwd=' + encodeURIComponent(pwd), { cache: 'no-store' })
        ]);
        const data = await logResponse.json();
        if (!logResponse.ok) throw new Error(data.error || '日志读取失败');
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
        const status = await statusResponse.json().catch(() => ({}));
        if (cacheEl) cacheEl.textContent = statusResponse.ok ? formatCacheStatus(status)
            : '缓存状态不可用：请检查管理密码及服务是否更新。此检查不调用模型。';
        if (statusEl) {
            if (!statusResponse.ok) statusEl.textContent = '费用观测：状态不可用';
            else {
                const priced = Array.isArray(status.pricedRoutes) && status.pricedRoutes.length > 0;
                statusEl.textContent = status.enabled
                    ? '费用观测：已开启' + (priced ? ' · 已配置价格' : ' · 未配置价格')
                    : '费用观测：已关闭';
                statusEl.style.color = status.enabled ? (priced ? '#27ae60' : '#e67e22') : '#e74c3c';
            }
        }
    } catch (error) {
        if (statusEl) { statusEl.textContent = '费用观测：连接失败'; statusEl.style.color = '#e74c3c'; }
        if (cacheEl) cacheEl.textContent = '状态读取失败：' + error.message + '。无需发送聊天来检查。';
    }
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
        row.innerHTML =
            '<span class="' + iconCls + '">' + icon + '</span> ' +
            '<span class="trace-time">' + time + '</span> ' +
            '<b>' + preview + '</b>' +
            ' <span class="trace-dur">' + dur + '</span>' +
            ' <span class="trace-model">' + escHtml(model) + '</span>' +
            ' <span class="trace-events">' + (t.eventCount || 0) + '事件</span>' +
            (t.ok === false ? '<div class="trace-err-msg">' + escHtml(t.error || '') + '</div>' : '');
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
            if (ev.ms > 5000) s += ' <span class="trace-warn">⚠ 耗时 ' + (ev.ms/1000).toFixed(1) + 's</span>';
            return s;
        }
        case 'dedup':
            return (d.blocks || []).map(function(b) { return escHtml(b.label) + ' ' + b.len; }).join(' · ');
        case 'budget': {
            let s = '上限 ' + d.maxTokens + ' · 用了 ' + d.usedTokens + ' · 保留 ' + d.kept + ' 条 · 丢弃 ' + d.dropped + ' 条';
            if (d.dropped > 0) s += ' <span class="trace-warn">⚠</span>';
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
                s = '<span class="trace-warn">' + s + '</span>';
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
            if (input > 5000 && cacheRead === 0) s += ' <span class="trace-warn">⚠ 未命中缓存</span>';
            return s;
        }
        case 'memory_write': {
            let s = '"' + escHtml(d.preview||'') + '" tags=[' + (d.tags||[]).join(',') + ']' + (d.ttl ? ' ttl=' + escHtml(d.ttl) : '') + (d.reason ? ' · ' + escHtml(d.reason) : '');
            if ((ev.label||'').indexOf('被拦截') >= 0) s = '<span class="trace-warn">' + s + '</span>';
            else if ((ev.label||'').indexOf('已写入') >= 0) s = '<span style="color:var(--con-ok)">' + s + '</span>';
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
        let html = '<div class="trace-header">';
        html += '<b>完整时间</b> ' + escHtml(t.startedAtISO) + '<br>';
        html += '<b>模型</b> ' + escHtml(t.meta?.model || '') + ' · <b>' + (t.meta?.stream ? '流式' : '非流式') + '</b> · <span class="trace-meta-dim">path=' + escHtml(t.path||'') + '</span><br>';
        html += '<b>耗时</b> ' + (t.durationMs||0) + 'ms · <b>回复字数</b> ' + (t.replyLen||0) + ' · <span class="trace-meta-dim">tabId=' + escHtml(t.meta?.tabId||'') + '</span><br>';
        html += '<button class="console-action" onclick="document.getElementById(\'traceDetail\').style.display=\'none\'" style="margin-top:8px">关闭</button>';
        html += '</div><div>';
        (t.events||[]).forEach(function(ev) {
            const msLabel = ev.ms >= 1000 ? ('+' + (ev.ms/1000).toFixed(1) + 's') : ('+' + ev.ms + 'ms');
            const phaseClr = PHASES[ev.phase] || '#888';
            html += '<div class="trace-event" onclick="var p=this.nextElementSibling;p.style.display=p.style.display===\'none\'?\'block\':\'none\'">';
            html += '<span class="trace-ts">' + msLabel + '</span>';
            html += '<span class="trace-phase-badge" style="background:' + phaseClr + '">' + escHtml(ev.phase) + '</span>';
            html += '<span class="trace-label">' + escHtml(ev.label) + '</span>';
            html += '<div class="trace-summary">' + formatEventSummary(ev) + '</div>';
            html += '</div>';
            html += '<pre class="trace-detail-json">' + escHtml(JSON.stringify(ev.detail, null, 2)) + '</pre>';
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
    if (pwd) window.location.assign('/long-term.html?pwd=' + encodeURIComponent(pwd));
}

function devRenderXhsMonitor(xhs) {
    const card = document.getElementById('devXhsMonitor');
    const status = document.getElementById('devXhsStatus');
    const meta = document.getElementById('devXhsMeta');
    const dot = document.getElementById('devXhsDot');
    if (!card || !status || !meta) return;
    const loggedIn = xhs?.login_status === 'logged_in';
    const working = Boolean(xhs?.collecting || xhs?.running || xhs?.login_starting);
    card.dataset.state = loggedIn ? 'ready' : working ? 'loading' : 'error';
    if (dot) dot.dataset.state = card.dataset.state;
    status.textContent = working ? '运行中' : loggedIn ? '已登录' : '需要登录';
    if (!xhs) meta.textContent = '暂时无法读取状态';
    else if (xhs.last_error && !loggedIn) meta.textContent = xhs.last_error;
    else if (xhs.last_collect_at) {
        const time = new Date(xhs.last_collect_at).toLocaleString('zh-CN', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' });
        meta.textContent = '上次 ' + time + ' · ' + Number(xhs.last_collect_count || 0) + ' 条';
    } else if (xhs.next_collect_at) {
        const time = new Date(xhs.next_collect_at).toLocaleString('zh-CN', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' });
        meta.textContent = '下次采集 ' + time;
    } else meta.textContent = '等待首次个性化采集';
}

async function devRefreshXhsMonitor() {
    const status = document.getElementById('devXhsStatus');
    if (status) status.textContent = '检查中';
    try {
        const response = await fetch('/api/xhs-walk/status', { cache: 'no-store' });
        devRenderXhsMonitor(response.ok ? await response.json() : null);
    } catch (_) {
        devRenderXhsMonitor(null);
    }
}
function neuOpenLongTerm() {
    const pwd = neuGetMemoryPwd();
    if (pwd) window.location.assign('/long-term?pwd=' + encodeURIComponent(pwd));
}

let _isOpeningArchiveRoom = false;
async function checkStarCrossingPassword(pwd) {
    const response = await fetch('/long-term?pwd=' + encodeURIComponent(pwd), {
        method: 'HEAD',
        cache: 'no-store',
        redirect: 'manual'
    });
    if (response.status === 401) return 'rejected';
    if (response.type === 'opaqueredirect' || (response.status >= 200 && response.status < 400)) return 'accepted';
    return 'unavailable';
}

async function openStarCrossing() {
    if (_isOpeningArchiveRoom) return;
    _isOpeningArchiveRoom = true;

    // 即时视觉反馈：点亮入口卡片
    const btn = document.querySelector('[onclick*="openStarCrossing"]');
    if (btn) btn.style.opacity = '0.6';

    try {
        let pwd = localStorage.getItem('memoryPwd');
        if (pwd) {
            const status = await checkStarCrossingPassword(pwd);
            if (status === 'rejected') {
                localStorage.removeItem('memoryPwd');
                pwd = '';
            } else if (status === 'unavailable') {
                toast('星渡暂时无法验证密码，请稍后重试');
                return;
            }
        }

        if (!pwd) {
            pwd = prompt('请输入星渡独立密码（不是小屋登录密码）:');
            if (!pwd) return;
            const status = await checkStarCrossingPassword(pwd);
            if (status === 'rejected') {
                localStorage.removeItem('memoryPwd');
                toast('星渡独立密码不正确，请重新输入');
                return;
            }
            if (status === 'unavailable') {
                toast('星渡暂时无法验证密码，请稍后重试');
                return;
            }
            localStorage.setItem('memoryPwd', pwd);
        }

        window.location.assign('/long-term.html?pwd=' + encodeURIComponent(pwd));
    } catch (_) {
        toast('星渡暂时无法验证密码，请稍后重试');
    } finally {
        _isOpeningArchiveRoom = false;
        if (btn) btn.style.opacity = '';
    }
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

// ==================== 水色玻璃首页 ====================
function neuInitHome() {
    window.SeaHome?.refresh();
}

function neuRenderTodos() {
    window.SeaHome?.refresh(true);
}

// ═══ 周期记录详情页 ═══
let floShowAllHistory = false;

async function floFetchPeriod() {
    try { const r = await fetch('/api/period'); return await r.json(); } catch(e) { return null; }
}

function floFormatDate(yyyymmdd) {
    const d = new Date(yyyymmdd + 'T00:00:00+08:00');
    return (d.getMonth()+1) + '月' + d.getDate() + '日';
}

function floDateOffset(yyyymmdd, offset) {
    const d = new Date(yyyymmdd + 'T00:00:00+08:00');
    d.setDate(d.getDate() + offset);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function floDayDiff(from, to) {
    return Math.round((new Date(to + 'T00:00:00+08:00') - new Date(from + 'T00:00:00+08:00')) / 86400000);
}

function floCycleTrack(data, insights) {
    const prediction = insights.prediction;
    const records = data.allRecords || [];
    const anchor = data.current?.start || (records.length ? records[records.length - 1].start : null);
    if (!prediction || !anchor || !insights.averageCycle) return '';

    const total = insights.averageCycle;
    const ovulation = floDateOffset(prediction.date, -14);
    const fertileStart = floDateOffset(ovulation, -5);
    const fertileEnd = floDateOffset(ovulation, 1);
    const percentage = date => Math.max(0, Math.min(100, floDayDiff(anchor, date) / total * 100));
    const periodWidth = Math.max(4, Math.min(32, (insights.averagePeriod || 5) / total * 100));
    const fertileLeft = percentage(fertileStart);
    const fertileWidth = Math.max(3, percentage(fertileEnd) - fertileLeft);
    const ovulationLeft = percentage(ovulation);
    const currentLeft = Math.max(0, Math.min(100, ((insights.cycleDay || 1) - 1) / total * 100));
    return '<div class="flo-cycle-visual">'
        + '<div class="flo-cycle-label"><span>本周期 · 第 ' + (insights.cycleDay || 1) + ' 天</span><span>约 ' + total + ' 天</span></div>'
        + '<div class="flo-cycle-track">'
        + '<i class="flo-track-period" style="width:' + periodWidth + '%"></i>'
        + '<i class="flo-track-fertile" style="left:' + fertileLeft + '%;width:' + fertileWidth + '%"></i>'
        + '<b class="flo-track-ovulation" style="left:' + ovulationLeft + '%"></b>'
        + '<em class="flo-track-today" style="left:' + currentLeft + '%"></em>'
        + '</div>'
        + '<div class="flo-cycle-key"><span><i class="period"></i>经期</span><span><i class="fertile"></i>易孕期估算</span><span><i class="ovulation"></i>排卵估算 ' + floFormatDate(ovulation) + '</span></div>'
        + '</div>';
}

function floSummaryMarkup(data) {
    const insights = data.insights || {};
    const prediction = insights.prediction || data.prediction;
    const current = data.current;
    let eyebrow = '周期记录';
    let title = '从一次开始记录';
    let detail = '完成两个周期后，才会开始给出个人化估算。';

    if (data.status?.inPeriod && current?.start) {
        eyebrow = '正在记录';
        title = '经期第 ' + data.status.days + ' 天';
        detail = '开始于 ' + floFormatDate(current.start) + '。结束时点“记录结束”即可。';
    } else if (prediction) {
        const today = new Date();
        const todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
        const daysUntil = floDayDiff(todayStr, prediction.date);
        eyebrow = prediction.confidence === '较稳定' ? '你的周期节律' : '周期正在学习';
        title = daysUntil > 0 ? '约 ' + daysUntil + ' 天后' : daysUntil === 0 ? '接近估算日期' : '估算日期已过 ' + Math.abs(daysUntil) + ' 天';
        detail = '下次经期估算：' + floFormatDate(prediction.earliest) + ' – ' + floFormatDate(prediction.latest) + '。';
    } else if ((data.allRecords || []).length === 1) {
        eyebrow = '再记一次就好';
        title = '还在认识你的周期';
        detail = '再完成一个周期，就会根据自己的数据开始估算。';
    }

    const variability = insights.variability === null || insights.variability === undefined ? '学习中' : '± ' + insights.variability + ' 天';
    return '<div class="flo-summary-copy"><span>' + eyebrow + '</span><h2>' + title + '</h2><p>' + detail + '</p></div>'
        + floCycleTrack(data, insights)
        + '<div class="flo-metrics">'
        + '<div><small>平均周期</small><strong>' + (insights.averageCycle ? insights.averageCycle + ' 天' : '—') + '</strong></div>'
        + '<div><small>平均经期</small><strong>' + (insights.averagePeriod ? insights.averagePeriod + ' 天' : '—') + '</strong></div>'
        + '<div><small>周期波动</small><strong>' + variability + '</strong></div>'
        + '</div>';
}

async function floRender() {
    const data = await floFetchPeriod();
    if (!data) return;
    const summary = document.getElementById('floSummary');
    const list = document.getElementById('floList');
    if (!list || !summary) return;
    summary.innerHTML = floSummaryMarkup(data);

    const records = [...(data.allRecords || [])].reverse();
    const historyCount = document.getElementById('floHistoryCount');
    const toggle = document.getElementById('floHistoryToggle');
    if (historyCount) historyCount.textContent = records.length ? records.length + ' 次' : '';
    if (toggle) {
        toggle.style.display = records.length > 3 ? '' : 'none';
        toggle.textContent = floShowAllHistory ? '收起' : '查看全部';
    }
    const shown = floShowAllHistory ? records : records.slice(0, 3);
    let html = data.current?.start
        ? '<article class="flo-history-card current"><div><span class="flo-history-state">进行中</span><h3>' + floFormatDate(data.current.start) + ' 开始</h3><p>结束时点“记录结束”保存本次时长。</p></div><strong>现在</strong></article>'
        : '';
    html += shown.map(record => {
        const duration = record.duration || floDayDiff(record.start, record.end) + 1;
        const cycle = record.cycle ? ' · 周期 ' + record.cycle + ' 天' : '';
        return '<article class="flo-history-card"><div><span class="flo-history-state">已记录</span><h3>' + floFormatDate(record.start) + ' – ' + floFormatDate(record.end) + '</h3><p>' + duration + ' 天' + cycle + '</p></div><strong>' + duration + '<small>天</small></strong></article>';
    }).join('');
    list.innerHTML = html || '<div class="flo-history-empty">还没有记录。第一次开始时，点上面的“记录开始”就好。</div>';
}

function floToggleHistory() { floShowAllHistory = !floShowAllHistory; floRender(); }

async function floPeriodAction(action) {
    try {
        const r = await fetch('/api/period', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action })
        });
        const data = await r.json();
        if (data.ok) { floRender(); window.SeaHome?.refresh(true); }
        toast(data.message || data.error || '已记录');
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
            window.SeaHome?.refresh(true);
        }
        toast(data.message || data.error || '已补录');
    } catch(e) { console.error(e); }
}

// ═══ 小屋外观 + Together 天数 ═══
function getVisualThemeColor(viewId = document.body?.dataset?.view || 'home') {
    return document.documentElement.dataset.seaCycle === 'night' ? '#081A2D' : '#A9C3D8';
}

window.addEventListener('sea-cycle-change', () => {
    const meta = document.getElementById('theme-color-meta');
    if (meta) meta.setAttribute('content', getVisualThemeColor());
});

function updateDays(){
    const start = new Date(START_DATE);
    const diff  = Math.floor((new Date() - start) / (1000 * 60 * 60 * 24));
    const dayEl = document.getElementById('dayCount');
    if(dayEl) dayEl.innerText = diff >= 0 ? diff : '∞';
    const homeV2Day = document.getElementById('homeV2DayCount');
    if(homeV2Day) homeV2Day.innerText = diff >= 0 ? diff : '∞';
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
            <span class="sidebar-item-name">${s.id === WORKROOM_ID ? '✦ ' : ''}${s.name}</span>
            ${chatSessions.length > 1 && s.id !== WORKROOM_ID ? `<button class="sidebar-del-btn" onclick="deleteChatWindow(event,'${s.id}')">×</button>` : ''}
        </div>
    `).join('');
}

function getLiveSession(id) {
    return chatSessions.find(function(s) { return s.id === id; }) || getActiveSession();
}

function getActiveSession(){
    if(!chatSessions || chatSessions.length === 0) chatSessions = [{ id: 'main', name: '主频道', messages: [] }];
    return chatSessions.find(s => s.id === activeChatId) || chatSessions[0];
}

function switchChatWindow(id){
    if (_isStreamingReply && id !== activeChatId) return toast('请等当前回复结束后再切换频道');
    if (id === WORKROOM_ID) ensureWorkroomSession();
    activeChatId = id; saveToCloud(); renderChatSidebar(); renderChatMessages({ forceBottom: true });
    updateWorkroomChrome();
    const titleEl = document.getElementById('chatWinTitle');
    if(titleEl) titleEl.innerText = '⊹ ' + getActiveSession().name;
    const topTitleEl = document.getElementById('chatViewTitle');
    if(topTitleEl) topTitleEl.innerText = '通讯 · ' + getActiveSession().name;
}

function openWorkroom() {
    ensureWorkroomSession();
    goView('chat');
    switchChatWindow(WORKROOM_ID);
    setTimeout(() => document.getElementById('chatInput')?.focus(), 120);
}

function openCommunication() {
    goView('chat');
    switchChatWindow('main');
    setTimeout(() => document.getElementById('chatInput')?.focus(), 120);
}

function openActiveChatSettings() {
    goView(isWorkroomSession() ? 'codex-settings' : 'shen-settings');
}

function updateWorkroomChrome() {
    const active = isWorkroomSession();
    const settingsTop = document.getElementById('chatSettingsTop');
    if (settingsTop) {
        const label = active ? 'Codex 设定' : '沈望设定';
        settingsTop.title = label;
        settingsTop.setAttribute('aria-label', '打开' + label);
    }
    const room = active ? ensureWorkroomSession() : null;
    const bar = document.getElementById('workroomCodexBar');
    const input = document.getElementById('chatInput');
    const mode = document.getElementById('workroomCodexMode');
    const renameButtons = document.querySelectorAll('.chat-rename-topbar-btn, .chat-rename-btn');
    if (bar) bar.hidden = !active;
    if (mode) mode.disabled = Boolean(room?.codexTaskId);
    if (input) input.placeholder = active ? '把我们叫来，一起商量点什么……' : '跟我说说话，宝宝……';
    renameButtons.forEach(button => { button.hidden = active; });
    if (!active) document.getElementById('workroomCodexApproval')?.setAttribute('hidden', '');
    else if (workroomApprovalQueue.length) workroomShowApproval(workroomApprovalQueue[0]);
    if (active && room.codexTaskId && (!workroomCodexSocket || workroomCodexSocketTaskId !== room.codexTaskId)) workroomConnectCodex(room.codexTaskId);
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
    // Tool output is data. Only verified numeric provider IDs become controls;
    // text is escaped and no model-authored HTML is executed.
    for (var musicCall of toolCalls) {
        if (musicCall.name !== 'music_search_and_play') continue;
        try {
            var musicResult = JSON.parse(musicCall.result);
            var musicSongs = musicResult.status === 'ready' && musicResult.attachment?.song_id === musicResult.song?.id
                ? [musicResult.song] : musicResult.status === 'needs_choice' ? musicResult.candidates || [] : [];
            if (musicResult.status === 'error') html += '<p class="music-tool-error">' + escHtml(musicResult.error?.message || '点歌失败') + '</p>';
            for (var musicSong of musicSongs) {
                if (musicSong.provider !== 'netease' || !musicSong.playable || !/^\d{1,20}$/.test(String(musicSong.id))) continue;
                html += '<div class="music-chat-card" style="padding:12px;margin:8px 0;border:1px solid #d6dedb;border-radius:14px;background:#f5f3ed;color:#30444d"><strong>' + escHtml(musicSong.name) + '</strong><small style="display:block">' + escHtml(musicSong.artist) + '</small><button type="button" data-music-song="' + musicSong.id + '" style="margin-top:8px;padding:6px 12px;border-radius:10px;border:1px solid #bfcfcb;background:white">♫ 打开播放卡</button></div>';
            }
        } catch (e) { /* Ignore truncated historical tool results. */ }
    }
    return html;
}

function updateToolGroupDOM(el, toolCalls, isStreaming) {
    el.innerHTML = renderToolCallGroupHTML(toolCalls, isStreaming);
}

const _xhsCardCache = new Map();
const _githubCardCache = new Map();

function findXhsLink(text) {
    const cleanText = String(text || '').replace(/[\u200B-\u200D\uFEFF]/g, '');
    const match = cleanText.match(/https?:\/\/(?:www\.)?(?:xhslink\.(?:com|cn)|xiaohongshu\.com)\/[^\s<>"']+/i);
    if (!match) return null;
    const url = match[0].split(/[，。！？、）)】]/u, 1)[0].replace(/[，。！？、）)】]+$/u, '');
    // xhslink.cn from iOS Copy Link redirects only over HTTPS.
    return url.replace(/^http:\/\/(www\.)?xhslink\.cn\//i, (_, www) => `https://${www || ''}xhslink.cn/`);
}

async function hydrateXhsCard(el, url) {
    if (!el || el.dataset.loading === 'true') return;
    el.dataset.loading = 'true';
    try {
        let payload = _xhsCardCache.get(url);
        if (!payload) {
            const response = await fetch('/api/xhs-card?url=' + encodeURIComponent(url));
            payload = await response.json();
            if (!response.ok || !payload.success) throw new Error(payload.error || '读取失败');
            _xhsCardCache.set(url, payload);
        }
        const note = payload.note;
        el.innerHTML = '';
        const head = document.createElement('div'); head.className = 'xhs-card-head';
        head.textContent = note.type === 'video' ? '小红书 · 视频笔记' : '小红书 · 图文笔记';
        const title = document.createElement('b'); title.className = 'xhs-card-title'; title.textContent = note.title || '小红书笔记';
        const desc = document.createElement('p'); desc.className = 'xhs-card-desc'; desc.textContent = note.desc || '没有正文';
        el.append(head, title, desc);
        if (note.images && note.images.length) {
            const images = document.createElement('div'); images.className = 'xhs-card-images';
            note.images.slice(0, 4).forEach(src => { const image = document.createElement('img'); image.src = src; image.alt = '小红书配图'; image.loading = 'lazy'; images.appendChild(image); });
            el.appendChild(images);
        }
        const meta = document.createElement('small');
        meta.textContent = [note.author, note.interact?.liked_count ? '赞 ' + note.interact.liked_count : ''].filter(Boolean).join(' · ');
        if (meta.textContent) el.appendChild(meta);
    } catch (error) {
        el.textContent = '小红书笔记没读到：' + error.message;
        el.classList.add('xhs-card-error');
    }
}

function findGitHubLink(text) {
    const match = String(text || '').match(/https:\/\/(?:www\.)?github\.com\/[A-Za-z0-9._~:\/?#[\]@!$&'()*+,;=%-]+/i);
    return match ? match[0].replace(/[，。！？、】【）)]+$/u, '') : null;
}

async function hydrateGitHubCard(el, url) {
    if (!el || el.dataset.loading === 'true') return;
    el.dataset.loading = 'true';
    try {
        let payload = _githubCardCache.get(url);
        if (!payload) {
            const response = await fetch('/api/github-card?url=' + encodeURIComponent(url));
            payload = await response.json();
            if (!response.ok || !payload.success) throw new Error(payload.error || '读取失败');
            _githubCardCache.set(url, payload);
        }
        const card = payload.card;
        el.innerHTML = '';
        const head = document.createElement('div'); head.className = 'github-card-head'; head.textContent = 'GITHUB · ' + String(card.type || 'repo').toUpperCase();
        const title = document.createElement('b'); title.className = 'github-card-title'; title.textContent = card.title || 'GitHub 链接';
        const subtitle = document.createElement('p'); subtitle.className = 'github-card-desc'; subtitle.textContent = card.subtitle || '已读取';
        const link = document.createElement('a'); link.href = card.url || url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = '在 GitHub 打开 ↗';
        el.append(head, title, subtitle, link);
    } catch (error) {
        el.textContent = 'GitHub 链接没读到：' + error.message;
        el.classList.add('github-card-error');
    }
}

function createThinkingMarker(thinking) {
    const marker = document.createElement('div');
    marker.className = 'think-marker';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'think-marker-button';
    button.setAttribute('aria-label', '展开深度思考过程');
    button.textContent = '🫧';

    const detail = document.createElement('div');
    detail.className = 'think-marker-detail';
    detail.hidden = true;
    button.setAttribute('aria-expanded', 'false');

    let latestValue = '';
    let renderedValue = null;
    const renderDetail = () => {
        if (renderedValue === latestValue) return;
        detail.innerHTML = escapeHtml(stripDisplayTimestamp(latestValue)).replace(/\n/g, '<br>');
        renderedValue = latestValue;
    };
    const update = (value) => {
        latestValue = String(value || '');
        marker.hidden = !latestValue.trim();
        // Keep collapsed reasoning as text; only build its DOM when opened.
        if (!detail.hidden) renderDetail();
    };
    button.addEventListener('click', (event) => {
        event.stopPropagation();
        detail.hidden = !detail.hidden;
        marker.classList.toggle('is-open', !detail.hidden);
        button.setAttribute('aria-expanded', String(!detail.hidden));
        if (!detail.hidden) renderDetail();
        else { detail.textContent = ''; renderedValue = null; }
    });

    marker.append(button, detail);
    update(thinking);
    return { element: marker, detail, update };
}

function userReactionEmoji(message) {
    if (!shenReactionEnabled || message?.role !== 'user') return '';
    return typeof message.shenReaction === 'string' ? message.shenReaction : '';
}

function mountUserReaction(bubble, message, animate = false) {
    if (!bubble) return;
    bubble.querySelector('.shen-reaction')?.remove();
    bubble.closest('.msg-row')?.classList.remove('has-shen-reaction');
    const emoji = userReactionEmoji(message);
    if (!emoji) return;
    const reaction = document.createElement('span');
    reaction.className = 'shen-reaction' + (animate ? ' is-new' : '');
    reaction.setAttribute('aria-label', '沈望回应了 ' + emoji);
    reaction.textContent = emoji;
    bubble.appendChild(reaction);
    bubble.closest('.msg-row')?.classList.add('has-shen-reaction');
}

function updateUserReaction(sessionId, messageId, emoji, animate = false) {
    if (!shenReactionEnabled || !messageId) return false;
    const session = getLiveSession(sessionId);
    const message = session?.messages?.find(item => String(item?._id || item?.id || '') === String(messageId));
    if (!message || message.role !== 'user') return false;
    if (emoji) message.shenReaction = emoji;
    else delete message.shenReaction;
    const row = document.querySelector('#chatWindow .msg-row[data-message-id="' + CSS.escape(String(messageId)) + '"]');
    mountUserReaction(row?.querySelector('.msg.user'), message, animate);
    return true;
}

function renderChatMessages(options = {}){
    if (_isStreamingReply) { _renderDeferred = true; return; }
    // Build messages, images and link cards only when the conversation is visible.
    // goView('chat') renders the latest state on entry.
    if (!document.getElementById('sec-chat')?.classList.contains('active')) return;
    const win = document.getElementById('chatWindow');
    if(!win) return;
    const shouldStickToBottom = Boolean(options.forceBottom) || (!options.preserveScroll && isChatNearBottom(win));
    const scrollAnchor = shouldStickToBottom ? null : captureChatScrollAnchor(win);
    win.innerHTML = '';
    const session = getActiveSession();
    if(!session || !session.messages) return;

    // 私聊默认保留轻量窗口；向上翻时逐页扩大。工作区仍按完整轮次展示最近 50 轮。
    const visibleCount = _visibleMessageCounts[session.id] || 30;
    const msgs = isWorkroomSession(session) ? workroomMessagesByRounds(session.messages, 50) : session.messages.slice(-visibleCount);
    const briefs = session.id === 'main' ? workroomBriefCards.slice().sort((left, right) => {
        const leftTime = Date.parse(left.createdAt || '');
        const rightTime = Date.parse(right.createdAt || '');
        return (Number.isFinite(leftTime) ? leftTime : Infinity) - (Number.isFinite(rightTime) ? rightTime : Infinity);
    }) : [];
    let briefIndex = 0;
    const appendBriefsThrough = (cutoff = Infinity) => {
        const due = [];
        while (briefIndex < briefs.length) {
            const briefTime = Date.parse(briefs[briefIndex].createdAt || '');
            if (cutoff !== Infinity && (!Number.isFinite(briefTime) || briefTime > cutoff)) break;
            due.push(briefs[briefIndex++]);
        }
        renderWorkroomBriefCards(win, due);
    };
    msgs.forEach((m, subIndex) => {
        const index = session.messages.length - msgs.length + subIndex;
        if (m._workroomBridge) return;

        const v = getActiveVersion(m);
        const vCount = getVersionCount(m);
        const vIdx = getActiveVersionIndex(m);
        const messageTime = Date.parse(v.fullTime || m.fullTime || v.createdAt || m.createdAt || '');
        if (Number.isFinite(messageTime)) appendBriefsThrough(messageTime);

        const rowDiv = document.createElement('div');
        const speaker = ['codex', 'jiangyu', 'shenwang'].includes(m.speaker) ? m.speaker : (m.role === 'user' ? 'jiangyu' : 'shenwang');
        rowDiv.className = 'msg-row ' + (m.role === 'user' ? 'user' : 'sys') + (speaker === 'codex' ? ' is-codex' : '');
        rowDiv.setAttribute('data-msg-index', index);
        if (m._id || m.id) rowDiv.setAttribute('data-message-id', String(m._id || m.id));
        rowDiv.tabIndex = 0;
        rowDiv.setAttribute('aria-label', (speaker === 'codex' ? 'Codex 的消息' : m.role === 'user' ? '我的消息' : '沈望的消息') + '，长按打开操作');

        const div = document.createElement('div');
        div.className = 'msg ' + (m.role === 'user' ? 'user' : 'sys') + (speaker === 'codex' ? ' codex' : '');

        let htmlContent = '';
        // 📸 渲染消息附带的图片（支持多图）
        const imgsToRender = v.images || (v.image ? [v.image] : []);
        for (let imgIdx = 0; imgIdx < imgsToRender.length; imgIdx++) {
            htmlContent += '<img src="' + imgsToRender[imgIdx] + '" style="max-width:200px;border-radius:8px;margin-bottom:5px;margin-right:4px;box-shadow:0 2px 10px rgba(0,0,0,0.3);display:inline-block;">';
        }
        // rawContent 优先用来还原正文与内嵌思考；已单独保存的 thinking
        // 始终作为兜底，不会再因为 rawContent 存在而被丢掉。
        const renderState = ChatRenderUtils.resolveMessageRenderState(m, v, extractThinkingFromContent);
        const displayContent = renderState.visibleContent;
        const finalThinking = renderState.thinking;
        // 渲染工具调用记录（整组折叠）
        if (v.toolCalls && v.toolCalls.length > 0) htmlContent += renderToolCallGroupHTML(v.toolCalls, false);
        if (isWorkroomSession(session)) {
            htmlContent += workroomSpeakerHTML(speaker);
        }
        if (m.role === 'user') {
            htmlContent += '<div>' + stripDisplayTimestamp(legacyMessagePlain(displayContent || '')).replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>') + '</div>';
            const xhsUrl = findXhsLink(displayContent);
            if (xhsUrl) htmlContent += '<div class="xhs-card" data-xhs-url="' + encodeURIComponent(xhsUrl) + '">正在读取小红书笔记…</div>';
            const githubUrl = findGitHubLink(displayContent);
            if (githubUrl) htmlContent += '<div class="github-card" data-github-url="' + encodeURIComponent(githubUrl) + '">正在读取 GitHub 链接…</div>';
        } else {
            htmlContent += '<div class="md-content">' + renderMarkdown(displayContent || '', speaker === 'shenwang') + '</div>';
        }

        const timeStr = v.fullTime ? new Date(v.fullTime).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}) : (v.time || '');
        // 模型选择属于输入栏，不在每条消息里重复展示，避免打断对话阅读。
        if(timeStr) htmlContent += '<div class="msg-meta">' + timeStr + '</div>';
        if (v._interrupted) htmlContent += '<div class="msg-meta">' + escapeHtml(v._interrupted) + ' · 已保留部分回复</div>';

        let actionsHtml = '<div class="msg-actions">';
        if(vCount > 1) {
            actionsHtml += '<div class="version-nav"><button class="ver-btn" onclick="switchVersion(' + index + ',-1)"' + (vIdx===0?' disabled':'') + '>‹</button><span class="ver-label">' + (vIdx+1) + ' / ' + vCount + '</span><button class="ver-btn" onclick="switchVersion(' + index + ',1)"' + (vIdx===vCount-1?' disabled':'') + '>›</button></div>';
        }
        if(m.role === 'user'){ actionsHtml += '<button class="msg-inline-btn" onclick="editUserMessage(' + index + ')" title="编辑">✎</button>'; actionsHtml += '<button class="msg-inline-btn" onclick="resendUserMessage(' + index + ')" title="重新发送">↻</button>'; }
        if(m.role === 'assistant'){
            if (speaker !== 'codex' && (m._failed || v._failed)) {
                actionsHtml += '<button class="msg-inline-btn" onclick="retryLastMessage()" title="重发" style="color:#e74c3c">↻ 重发</button>';
            } else if (speaker !== 'codex') {
                actionsHtml += '<button class="msg-inline-btn msg-regenerate" onclick="regenerateAt(' + index + ')" title="重新生成" aria-label="重新生成">↻</button>';
            }
            actionsHtml += '<button class="msg-inline-btn fav-star' + (m._favoriteId ? ' faved' : '') + '" id="favBtn_' + index + '" onclick="toggleFavorite(' + index + ')" title="收藏" aria-label="收藏">★</button>';
        }
        actionsHtml += '</div>';
        htmlContent += actionsHtml;

        if (speaker === 'codex' && Array.isArray(v.codexTimeline) && v.codexTimeline.length) {
            div.className = 'workroom-codex-turn';
            const tailHTML = (timeStr ? '<div class="msg-meta">' + timeStr + '</div>' : '')
                + (v._interrupted ? '<div class="msg-meta">' + escapeHtml(v._interrupted) + ' · 已保留部分回复</div>' : '')
                + actionsHtml;
            div.innerHTML = workroomCodexTimelineHTML(v.codexTimeline, { tailHTML });
        } else div.innerHTML = htmlContent;
        if (m.role === 'user') mountUserReaction(div, m);
        if (m.role === 'assistant' && finalThinking.trim()) {
            rowDiv.classList.add('has-think-marker');
            rowDiv.appendChild(createThinkingMarker(finalThinking).element);
        }
        rowDiv.appendChild(div);
        if (m.role === 'assistant' && speaker !== 'codex') MessageUsage.mount(rowDiv, v.messageUsage);

        win.appendChild(rowDiv);
    });
    appendBriefsThrough();
    if (isWorkroomSession(session) && workroomCodexTurnId && !workroomCodexSavedForTurn) workroomUpdateLiveReply();
    win.querySelectorAll('.xhs-card[data-xhs-url]').forEach(el => hydrateXhsCard(el, decodeURIComponent(el.dataset.xhsUrl)));
    win.querySelectorAll('.github-card[data-github-url]').forEach(el => hydrateGitHubCard(el, decodeURIComponent(el.dataset.githubUrl)));
    if (shouldStickToBottom) forceScrollToChatBottom();
    else restoreChatScrollAnchor(win, scrollAnchor);
}

async function loadWorkroomBriefCards() {
    try {
        const response = await fetch('/api/workroom-notes/briefs?limit=20', { cache: 'no-store' });
        if (!response.ok) return;
        const data = await response.json();
        workroomBriefCards = Array.isArray(data.briefs) ? data.briefs : [];
        if (_isStreamingReply) _renderDeferred = true;
        else if (activeChatId === 'main' && document.getElementById('sec-chat')?.classList.contains('active')) renderChatMessages({ preserveScroll: true });
    } catch (_) {}
}

function renderWorkroomBriefCards(container, briefs = workroomBriefCards.slice().reverse()) {
    for (const brief of briefs) {
        const card = document.createElement('details');
        card.className = 'workroom-brief-card' + (brief.status === 'pending' ? ' is-pending' : '');
        const toggle = document.createElement('summary');
        toggle.className = 'workroom-brief-toggle';
        toggle.textContent = '• 便签员贴了一张便签';
        const content = document.createElement('div');
        content.className = 'workroom-brief-content';
        const heading = document.createElement('header');
        const title = document.createElement('strong');
        title.textContent = '工作区便签';
        const meta = document.createElement('time');
        meta.dateTime = brief.createdAt || '';
        meta.textContent = brief.durationMinutes ? `约 ${brief.durationMinutes} 分钟` : '刚刚';
        heading.append(title, meta); content.append(heading);
        if (brief.status === 'pending') {
            const pending = document.createElement('p'); pending.textContent = brief.message || '正在整理…'; content.append(pending);
        } else {
            if (brief.summary) { const summary = document.createElement('p'); summary.textContent = brief.summary; content.append(summary); }
            const list = document.createElement('ol');
            for (const topic of brief.topics || []) {
                const item = document.createElement('li');
                const name = document.createElement('b'); name.textContent = topic.title;
                const text = document.createElement('span'); text.textContent = topic.summary || topic.conclusion || '';
                item.append(name, text); list.append(item);
            }
            if (list.children.length) content.append(list);
        }
        if ((brief.progress || []).length) {
            const progress = document.createElement('div'); progress.className = 'workroom-brief-progress';
            progress.textContent = (brief.progress || []).map(item => `${item.title} · ${item.status === 'completed' ? '已结束' : item.status}`).join('｜');
            content.append(progress);
        }
        card.append(toggle, content);
        container.append(card);
    }
}

function newChatWindow(){
    const id = 'chat_' + Date.now().toString(36);
    chatSessions.push({ id, name: '频道 ' + (chatSessions.length + 1), messages: [] });
    saveToCloud(); switchChatWindow(id); toast('已开启新频道：' + name);
}

function deleteChatWindow(e, id){
    e.stopPropagation();
    if(id === WORKROOM_ID) return toast('共创工作区会一直留在小屋里');
    if(chatSessions.length <= 1) return toast('至少保留一个频道');
    if(!confirm('确定关闭？')) return;
    _deletedSessionIds.add(id);
    chatSessions = chatSessions.filter(s => s.id !== id);
    if(activeChatId === id) activeChatId = chatSessions[0].id;
    saveToCloud(); renderChatSidebar(); renderChatMessages();
}

function renameChatWindow(){
    const session = getActiveSession();
    if(isWorkroomSession(session)) return toast('共创工作区使用固定名称');
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

let activeChatRequest = null;
function updateChatSendButton(state = activeChatRequest ? (activeChatRequest.reason === 'user' ? 'stopping' : 'generating') : 'idle') {
    const button = document.getElementById('chatSendBtn');
    if (!button) return;
    const busy = state !== 'idle';
    button.dataset.state = state;
    button.disabled = state === 'stopping' || (!busy && _uploading);
    button.title = state === 'stopping' ? '正在停止' : busy ? '停止生成' : '发送消息';
    button.setAttribute('aria-label', button.title);
    button.innerHTML = busy
        ? '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>'
        : '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}
function chatSendOrStop() {
    if (activeChatRequest) activeChatRequest.stop();
    else sendChat();
}
function beginChatRequest() {
    const request = ChatTransport.createRequest({
        streaming: document.getElementById('streamToggle')?.checked !== false,
        onState: updateChatSendButton,
    });
    activeChatRequest = request;
    return request;
}
function finishChatRequest(request) {
    if (activeChatRequest === request) activeChatRequest = null;
    _isStreamingReply = false;
    request?.finish();
    if (window._coreStreamEnd) window._coreStreamEnd();
    if (_saveQueued && !_savingNow) {
        _saveQueued = false;
        saveToCloud(true, true, true);
    }
}

async function sendChat(options = {}) {
    if (_isStreamingReply || activeChatRequest) return toast('请等当前回复结束后再发送');
    if (isWorkroomSession() && workroomSending) return toast('正在发送，请稍候');
    workroomSending = isWorkroomSession();
    let request = null;
    const input = document.getElementById('chatInput');
    let val = input?.value.trim() || '';
    try {
    const reuseLastUser = !!options.reuseLastUser;
    if(!input) return;

    const session = getActiveSession();
    const sessionId = session.id;
    const win = document.getElementById('chatWindow');

    let existingUserVersion = null;
    let submittedMessageId = null;
    let workroomTarget = 'shenwang';
    const workroomExecute = isWorkroomSession(session) && options.workroomExecute === true;
    if (isWorkroomSession(session)) {
        workroomTarget = workroomRecipientFor(val, document.getElementById('workroomRecipient')?.value, workroomExecute);
        if (workroomExecute) {
            workroomTarget = 'codex';
            if (!val) return toast('先写一句想交给 TT 做的事吧');
            val = workroomExecuteText(val);
        }
        if (workroomTarget !== 'shenwang' && (workroomCodexBusy || workroomDispatching)) return toast('Codex 正在处理上一条，请等完成后再发给它；也可以切换为只和沈望聊');
    }

    if (reuseLastUser) {
        const lastMsg = session.messages[session.messages.length - 1];
        if (!lastMsg || lastMsg.role !== 'user') return;

        existingUserVersion = getActiveVersion(lastMsg);
        submittedMessageId = lastMsg._id || null;
        val = (existingUserVersion.content || '').trim();
        if (isWorkroomSession(session)) workroomTarget = lastMsg.workroomTarget || workroomTarget;

        if (!val && !(existingUserVersion.images && existingUserVersion.images.length) && !existingUserVersion.image) return;
    } else {
        if(!val && currentImgBase64List.length === 0) return;
        input.value = '';
    }

    const workroomBridge = session.id === 'main' && window.WorkroomHistoryBridge
        ? window.WorkroomHistoryBridge.append(
            chatSessions.find(item => item.id === WORKROOM_ID || item.type === 'codex-workroom'),
            session,
            { limit: 10, idFactory: () => crypto.randomUUID() }
        )
        : null;

    // 💥 就在这里！Claude 让加的”侦察兵”
    console.log('val类型:', typeof val, '值:', val);
    console.log('currentImgBase64List:', currentImgBase64List.length);
    console.log('reuseLastUser:', reuseLastUser);

    if (workroomTarget !== 'codex') {
        request = beginChatRequest();
        if (workroomBridge) saveToCloud(true);
        await flushDirtyToZep(session, request.signal);
        request.signal.throwIfAborted();
    }

    var curFullTime = reuseLastUser ? (existingUserVersion.fullTime || new Date().toISOString()) : new Date().toISOString();

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
    submittedMessageId = crypto.randomUUID();
    session.messages.push({ _id: submittedMessageId, role: 'user', speaker: isWorkroomSession(session) ? 'jiangyu' : undefined, workroomTarget: isWorkroomSession(session) ? workroomTarget : undefined, ...(workroomExecute ? { workroomAction: 'execute' } : {}), versions: [{ content: val, fullTime: curFullTime, image: savedImages ? savedImages[0] : undefined, images: savedImages }], activeVersion: 0 });
    if (uRow.dataset) {
        uRow.dataset.msgIndex = String(session.messages.length - 1);
        uRow.dataset.messageId = submittedMessageId;
    } else {
        uRow.setAttribute?.('data-msg-index', String(session.messages.length - 1));
        uRow.setAttribute?.('data-message-id', submittedMessageId);
    }
    saveMessageChangesToCloud(true);  // 先写本机日志；生成结束后增量同步

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
    if (isWorkroomSession(session) && workroomTarget === 'codex') {
        renderChatMessages({ forceBottom: true });
        await workroomDispatchToCodex(val, '', imgsToSend, workroomExecute);
        return;
    }
    const currentSup = suppliers[activeSupIndex];
    if(!currentSup) { toast('未配置供应商'); return; }
    // end early exits

    var toolCallRecords = [];
    var firstChunkReceived = false;
    var sDiv = null; var sRow = null; var toolHintTimer = null; var toolHintTimer2 = null;
    var assistantMsg = null;
    var fullReply = '', thinkContent = '', reasoningContent = '', rawAssistantText = '';
    var shenReaction = null;
    const messageUsage = MessageUsage.tracker();

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
    var actualText = val;
    if (isWorkroomSession(session)) {
        actualText = '【溯星小屋三方共创工作区 · 讨论】\n你是沈望，Codex 是另一位协作者。当前只讨论，不执行修改；只有江鱼点击开工按钮才会授权 Codex。不要代替 Codex，不要声称检查过未实际读取的代码。可以提出建议或等江鱼补充，不必每次催促开工。\n\n江鱼：' + val;
    }
    var userContent = fmtTsTag(curFullTime) + actualText;
    if (imgsToSend.length > 0) {
        userContent = [{ type: "text", text: (fmtTsTag(curFullTime) + actualText) || "（发送了图片）" }];
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

    // Send original available history to our gateway; it archives and projects it.
    // Other channels keep their existing window. No provider receives these IDs.
    const retainedImages = ChatWindowContext.imageWindow(session.messages, getActiveVersion);
    const useRollingContext = !isWorkroomSession(session) && (!retainedImages.size || isFrozenCacheRoute(currentSup.url, selectedModel)) && await canUseRollingContext(currentSup.url, selectedModel, fetch);
    if (isCacheHistoryRoute(currentSup.url, selectedModel)) ContextContinuity.ensureMessageIds([session], () => crypto.randomUUID());
    let historyStorage;
    try { historyStorage = window.sessionStorage; } catch (_) {}
var historyMsgs = (useRollingContext ? session.messages.slice(0, -1) : cachedChatHistory(session.messages.slice(0, -1), session.id,
    currentSup.url, selectedModel, historyStorage)).map(function(m) {
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
    safeContent = legacyMessagePlain(safeContent);
    if (typeof safeContent === 'string') safeContent = fmtTsTag(v.fullTime) + stripDisplayTimestamp(safeContent);
    if (useRollingContext && !m._id) m._id = crypto.randomUUID();
    var historyRole = m.role;
    if (isWorkroomSession(session) && m.speaker === 'codex') {
        historyRole = 'user';
        safeContent = '[Codex（另一位 AI 协作者）]\n' + safeContent;
    } else if (isWorkroomSession(session) && m.speaker === 'shenwang') {
        safeContent = '[沈望（你此前的发言）]\n' + safeContent;
    }
    return { role: historyRole, content: ChatWindowContext.retainImages(safeContent, m, retainedImages, getActiveVersion), ...(useRollingContext ? { _contextId: m._id, _contextRevision: ContextContinuity.revisionOf(m, getActiveVersion) } : {}) };
});


    // 最后一条用 userContent（包含你刚重写的完美图片数组）
    historyMsgs.push({ role: 'user', content: userContent });
    if (isWorkroomSession(session)) {
        historyMsgs = ChatWindowContext.workroomHistory(session.messages, chatSessions.find(s => s.id === 'main')?.messages || [], getActiveVersion, legacyMessagePlain, fmtTsTag);
        historyMsgs[historyMsgs.length - 1] = { role: 'user', content: userContent };
    }

        let apiUrl = '/v1/chat/completions';
        const viaMatch = currentSup.url.match(/\/via\/(\w+)\//);
        if (viaMatch) {
            apiUrl = '/via/' + viaMatch[1] + '/v1/chat/completions';
        }

        request.signal.throwIfAborted();
        request.touch();

        // 🔍 诊断日志：请求 payload 大小
        const reqBody = {
            model: selectedModel,
            cacheClientVersion: 2,
            ...(useRollingContext ? { contextProtocol: { version: 1, mode: isFrozenCacheRoute(currentSup.url, selectedModel) ? 'frozen-v1' : 'summary-v1', sessionId: session.id, prefix: session.contextPrefix || null } } : {}),
            activeChatId: session.id,
            messages: historyMsgs,
            stream: isStream,
            shenReactionEnabled,
            ...(modelSwitchNoticeFor(session, selectedModel) ? { modelSwitchNotice: true } : {})
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

        request.mark('等待服务器响应');
        const response = await fetch(apiUrl, {
            method: 'POST',
            signal: request.signal,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentSup.key}`,
                'X-Tab-Id': SYZYGY_TAB_ID,
                'X-Request-Id': request.id,
                ...(submittedMessageId ? { 'X-Message-Id': submittedMessageId } : {})
            },
            body: payloadText
        });
        request.mark(isStream ? '接收流式回复' : '接收完整回复');

        if (!response.ok) {
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
            throw new Error(hint);
        }

        let thinkMarker = null, thinkTextDiv = null;

        // ==========================================
        request.touch();
        thinkMarker = createThinkingMarker('');
        thinkMarker.element.hidden = true;
        thinkTextDiv = thinkMarker.detail;
        sRow.insertBefore(thinkMarker.element, sDiv);
        // 🌊 流式接收核心逻辑 (Stream = true)
        // ==========================================
        if (isStream) {
            if (window._coreStreamStart) window._coreStreamStart();

            // 思考过程显示为消息气泡上方的常驻 🫧 标记
            sDiv.innerHTML = '<span class="loading-indicator">⟡ 正在等待回复…</span>';

            const mainTextDiv = document.createElement('div');
            mainTextDiv.classList.add('md-content');
            sDiv.appendChild(mainTextDiv);

            const toolGroupEl = document.createElement('div');
            toolGroupEl.className = 'tool-call-group-wrap';
            toolGroupEl.style.display = 'none';
            sDiv.appendChild(toolGroupEl);

            let paintedReply = null;
            const streamPaint = ChatRenderUtils.createFrameScheduler(() => {
                // 一帧内的多个小分片只解析、重绘一次。
                const extracted = extractThinkingFromContent(rawAssistantText);
                fullReply = extracted.visibleContent;
                thinkContent = [reasoningContent, extracted.thinking].filter(Boolean).join('\n\n');
                if (thinkContent) {
                    sRow.classList.add('has-think-marker');
                    thinkMarker.update(thinkContent);
                }
                if (fullReply !== paintedReply) {
                    mainTextDiv.innerHTML = renderMarkdown(fullReply, true) + '<span class="typing-cursor"></span>';
                    paintedReply = fullReply;
                }
                scrollChatToBottomIfNear(win);
            });

            try {
            await ChatTransport.readStream(response, parsed => {
                        messageUsage.accept(parsed);

                        // 🔧 工具调用事件
                        if (parsed.type === 'tool_call') {
                            request.mark('接收工具调用结果');
                            toolCallRecords.push({ name: parsed.name, arguments: parsed.arguments || {}, result: parsed.result || '', elapsed: parsed.elapsed || 0 });
                            toolGroupEl.style.display = 'block';
                            updateToolGroupDOM(toolGroupEl, toolCallRecords, true);
                            scrollChatToBottomIfNear(win);
                            return;
                        }
                        if (parsed.type === 'shen_reaction') {
                            if (!parsed.sourceMessageId || parsed.sourceMessageId === submittedMessageId) shenReaction = parsed.emoji || null;
                            return;
                        }

                        const delta = parsed.choices?.[0]?.delta || {};
                        
                        // 1. 处理推理内容 (reasoning_content) - 如果模型支持
                        if (delta.reasoning_content) {
                            thinkContent += delta.reasoning_content;
                            reasoningContent += delta.reasoning_content;
                            streamPaint.schedule();
                        }

                        // 2. 处理正文内容 (content) — 用累计全文解析，避免 chunk 边界截断标签
                        if (delta.content) {
                            request.mark('接收模型回复');
                            if (!firstChunkReceived) {
                                firstChunkReceived = true;
                                clearTimeout(toolHintTimer);
                                clearTimeout(toolHintTimer2);
                                sDiv.querySelector('.loading-indicator')?.remove();
                                sDiv.classList.remove('msg-loading');
                            }
                            rawAssistantText += delta.content;
                            streamPaint.schedule();
                        }
            }, () => request.touch());
            } finally {
                // Preserve received text even if a stop/disconnect beats the next frame.
                streamPaint.flush();
            }
            sDiv.querySelector('.loading-indicator')?.remove();
            mainTextDiv.innerHTML = renderMarkdown(fullReply, true);
            // 流结束：将工具调用组从"正在调用"切换为"调用了 N 次"
            if (toolCallRecords.length > 0) updateToolGroupDOM(toolGroupEl, toolCallRecords, false);

        } else {
            // ==========================================
            // 🐌 非流式接收逻辑 (Stream = false)
            // ==========================================
            const data = await response.json();
            fullReply = data.choices[0].message.content || "";
            shenReaction = data.syzygy_reaction?.emoji || null;
            messageUsage.accept(data);
            if (Array.isArray(data.music_tool_calls)) toolCallRecords.push(...data.music_tool_calls);
            rawAssistantText = fullReply;
            reasoningContent = data.choices[0].message.reasoning_content || '';

            // 处理思考过程 — 支持 <think>/<thinking>/<chain_of_thought>/<reasoning>
            const extracted = extractThinkingFromContent(fullReply);
            thinkContent = [reasoningContent, extracted.thinking].filter(Boolean).join('\n\n');
            fullReply = extracted.visibleContent;

            sDiv.innerHTML = '';
            if (thinkContent) {
                sRow.classList.add('has-think-marker');
                thinkMarker.update(thinkContent);
            }
            const mainTextDiv = document.createElement('div');
            mainTextDiv.classList.add('md-content');
            sDiv.appendChild(mainTextDiv);
            mainTextDiv.innerHTML = renderMarkdown(fullReply, true);
            if (toolCallRecords.length) {
                const musicCards = document.createElement('div');
                musicCards.innerHTML = renderToolCallGroupHTML(toolCallRecords, false);
                sDiv.appendChild(musicCards);
            }
        }

        // --- 5. 存入云端，思考链从 DOM 取（避免流解析丢数据）---
        const timeStr = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        const domThinking = stripDisplayTimestamp(thinkContent || (thinkTextDiv ? thinkTextDiv.innerText : '') || '');
        assistantMsg = { _id: crypto.randomUUID(), role: 'assistant', speaker: isWorkroomSession(session) ? 'shenwang' : undefined, versions: [{ content: fullReply, thinking: domThinking, time: timeStr, model: selectedModel, fullTime: new Date().toISOString(), rawContent: rawAssistantText, reasoning: reasoningContent || '', toolCalls: toolCallRecords.length > 0 ? toolCallRecords : undefined }], activeVersion: 0 };
        assistantMsg.versions[0].messageUsage = messageUsage.finish();
        const liveSession = getLiveSession(sessionId);
        liveSession.messages.push(assistantMsg);
        if (shenReactionEnabled) updateUserReaction(sessionId, submittedMessageId, shenReaction, true);
        // 先存本地备份，再尝试云端同步
        // 🛡️ 拒绝备份脏兜底状态
        saveMessageChangesToCloud(true);
        fetchPulseStatus();
        if (window._coreStreamEnd) window._coreStreamEnd();
        triggerStarEffects(val, fullReply);
        // 不调用 renderChatMessages() —— sDiv 已经有流式输出内容
        // 追加 meta 和 action 按钮到现有气泡
        MessageUsage.mount(sRow, assistantMsg.versions[0].messageUsage);
        const metaDiv = document.createElement('div');
        metaDiv.className = 'msg-meta';
        metaDiv.innerText = timeStr;
        sDiv.appendChild(metaDiv);
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'msg-actions';
        const msgIdx = getLiveSession(sessionId).messages.length - 1;
        sRow.dataset.msgIndex = msgIdx;
        sRow.tabIndex = 0;
        sRow.setAttribute('aria-label', '沈望的消息，长按打开操作');
        actionsDiv.innerHTML = '<button class="msg-inline-btn msg-regenerate" onclick="regenerateAt(' + msgIdx + ')" title="重新生成" aria-label="重新生成">↻</button><button class="msg-inline-btn fav-star" id="favBtn_' + msgIdx + '" onclick="toggleFavorite(' + msgIdx + ')" title="收藏" aria-label="收藏">★</button>';
        sDiv.appendChild(actionsDiv);
        sDiv.classList.remove('msg-loading');
        if (isWorkroomSession(session) && workroomTarget === 'all') {
            setTimeout(() => workroomDispatchToCodex(val, fullReply, imgsToSend), 0);
        }

    } catch (err) {
        const stopped = request?.reason === 'user';
        const detail = stopped ? '已停止生成' : ChatTransport.errorMessage(err, request);
        const transport = ChatTransport.diagnostics(request);
        if (fullReply || thinkContent) {
            getLiveSession(sessionId).messages.push({ _id: crypto.randomUUID(), role: 'assistant',
                speaker: isWorkroomSession(session) ? 'shenwang' : undefined,
                versions: [{ content: fullReply, thinking: thinkContent, rawContent: rawAssistantText,
                    reasoning: reasoningContent, model: selectedModel, fullTime: new Date().toISOString(),
                    _interrupted: detail, _requestId: transport?.requestId, _interruptedStage: transport?.stage,
                    toolCalls: toolCallRecords, messageUsage: messageUsage.finish() }], activeVersion: 0 });
            saveMessageChangesToCloud(true);
            _renderDeferred = true;
        } else if (stopped) {
            sRow?.remove();
        } else {
            console.warn('[chat transport interrupted]', transport);
            recordChatTransportFailure(session, sessionId, detail, selectedModel);
            sDiv.innerHTML = '<div>【通讯中断】' + escapeHtml(detail) + '</div><button class="msg-retry-btn" onclick="retryLastMessage()">↻ 重试</button>';
            sDiv.classList.add('msg-failed');
        }
        toast(detail);
        if (!stopped && isWorkroomSession(session) && workroomTarget === 'all') {
            setTimeout(() => workroomDispatchToCodex(val, '沈望本轮通讯中断，Codex 请先根据江鱼的消息继续判断。', imgsToSend), 0);
        }
    } finally {
        clearTimeout(toolHintTimer); clearTimeout(toolHintTimer2);
        sDiv?.classList.remove('msg-loading');
        _isStreamingReply = false;
        if (isWorkroomSession(session) && activeChatId === sessionId) _renderDeferred = true;
        if (_renderDeferred) { _renderDeferred = false; renderChatMessages(); }
        if (_resyncPendingReason) {
            var _pr = _resyncPendingReason; _resyncPendingReason = null;
            setTimeout(function(){ resyncIfStale(_pr); }, 1500);
        }
    }
    } catch (e) {
        if (request?.reason === 'user') {
            if (input && !input.value) input.value = val || '';
            toast('已停止生成');
        } else { console.error('sendChat exception:', e); toast('发送异常: ' + ChatTransport.errorMessage(e, request)); }
        _isStreamingReply = false;
    } finally {
        finishChatRequest(request);
        workroomSending = false;
    }
}

// ==================== 江鱼 · 沈望 · Codex 共创工作区 ====================
let workroomCodexSocket = null;
let workroomCodexSocketTaskId = null;
let workroomCodexReply = '';
let workroomCodexTimeline = [];
let workroomCodexTurnId = null;
let workroomCodexSavedForTurn = false;
let workroomCodexLiveBubble = null;
let workroomCodexApprovalId = null;
let workroomCodexBusy = false;
let workroomReconnectTimer = null;
let workroomDispatching = false;
let workroomApprovalQueue = [];
let workroomSending = false;
let workroomCodexExecuting = false;
let workroomCodexInterrupting = false;
let workroomCodexSending = false;

function recordChatTransportFailure(session, sessionId, message, model) {
    // 传输故障只是本轮运行状态：保留用户消息供重试，但绝不写入正式聊天记录。
    console.warn('[chat transport] session=' + sessionId + ' model=' + model + ' ' + message);
    if (isWorkroomSession(session)) toast('沈望本轮通讯中断：' + message);
    return false;
}

function workroomRecipientFor(text, selected, execute = false) {
    if (execute) return 'codex';
    if (/^@codex(?:\s|[，,:：]|$)/i.test(text.trim())) return 'codex';
    if (/^@沈望(?:\s|[，,:：]|$)/.test(text.trim())) return 'shenwang';
    return ['all', 'shenwang', 'codex'].includes(selected) ? selected : 'all';
}

const WORKROOM_EXECUTE_BADGE = '✦ TT开工';
function workroomExecuteText(text) {
    const value = String(text || '').trim();
    if (!value || value.endsWith(WORKROOM_EXECUTE_BADGE)) return value;
    return value + '  ' + WORKROOM_EXECUTE_BADGE;
}

function workroomSpeakerHTML(speaker) {
    if (speaker === 'codex') return '<div class="workroom-speaker workroom-speaker-codex"><span class="workroom-codex-avatar" role="img" aria-label="Codex 头像">&gt;_</span><span>CODEX</span></div>';
    return '<div class="workroom-speaker workroom-speaker-' + (speaker === 'jiangyu' ? 'jiangyu' : 'shenwang') + '">' + (speaker === 'jiangyu' ? '江鱼' : '沈望') + '</div>';
}

function workroomVisibleReply(text) {
    return String(text || '').replace(/<work_record>[\s\S]*?(?:<\/work_record>|$)/g, '').trim();
}

function workroomCodexActivity(event) {
    const method = String(event?.method || '');
    const params = event?.params || {};
    if (!method || method.includes('requestApproval')) return null;
    const itemType = String(params.item?.type || '');
    let kind = '';
    if (method.startsWith('item/fileChange') || method === 'turn/diff/updated' || itemType === 'fileChange') kind = 'editing';
    else if (method.startsWith('item/commandExecution') || itemType === 'commandExecution') {
        const command = String(params.command || params.item?.command || params.item?.aggregatedOutput || '').toLowerCase();
        if (/\b(test|vitest|jest|pytest|mocha|lint|typecheck|check)\b/.test(command)) kind = 'testing';
        else if (/\b(git\s+push|gh\s+pr)\b/.test(command)) kind = 'sending';
        else if (/\b(screenshot|chromium|chrome|playwright)\b/.test(command)) kind = 'looking';
        else kind = 'reading';
    } else if (itemType && !['agentMessage', 'reasoning', 'plan'].includes(itemType)) kind = 'working';
    else if (/^item\/(?:mcpToolCall|dynamicToolCall|webSearch)/.test(method)) kind = 'working';
    if (!kind) return null;
    const labels = {
        reading: 'TT 正在翻代码…', editing: 'TT 正在和小屋里的零件讲道理…', testing: 'TT 正在试一试改动…',
        looking: 'TT 正在看看页面…', sending: 'TT 正在把改动送回小屋…', working: 'TT 正在埋头干活…'
    };
    return { type: 'activity', kind, text: labels[kind] };
}

function workroomCodexActivityLabel(block) {
    const presentations = {
        reading: ['🦉', 'TT 正在翻代码…'], editing: ['🛠️', 'TT 正在和小屋里的零件讲道理…'], testing: ['🧪', 'TT 正在试一试改动…'],
        looking: ['🔎', 'TT 正在看看页面…'], sending: ['✨', 'TT 正在把改动送回小屋…'], working: ['🌌', 'TT 正在埋头干活…']
    };
    const presentation = presentations[block?.kind] || presentations.working;
    return { emoji: presentation[0], text: presentation[1], label: presentation.join(' ') };
}

function workroomCodexActivityHTML(block, live = false) {
    const activity = workroomCodexActivityLabel(block);
    const letters = Array.from(activity.text).map((letter, index) => {
        if (/\s/.test(letter)) return letter;
        return '<span class="tt-activity-char" style="--tt-hop-order:' + index + '">' + escapeHtml(letter) + '</span>';
    }).join('');
    return '<div class="workroom-codex-activity is-' + escapeHtml(block.kind || 'working') + (live ? ' is-live' : '') + '" role="status" aria-label="' + escapeHtml(activity.label) + '"><span class="tt-activity-emoji" aria-hidden="true">' + activity.emoji + '</span><span class="tt-activity-letters" aria-hidden="true">' + letters + '</span></div>';
}

function workroomNormalizeCodexTimeline(timeline, fallbackText = '') {
    const normalized = [];
    for (const block of Array.isArray(timeline) ? timeline : []) {
        if (block?.type === 'text' && typeof block.text === 'string' && block.text) normalized.push({ type: 'text', text: block.text });
        else if (block?.type === 'activity') normalized.push({ type: 'activity', kind: String(block.kind || 'working') });
    }
    if (!normalized.length && fallbackText) normalized.push({ type: 'text', text: String(fallbackText) });
    return normalized;
}

function workroomAppendCodexText(value) {
    const delta = String(value || '');
    if (!delta) return;
    const previous = workroomCodexTimeline[workroomCodexTimeline.length - 1];
    if (previous?.type === 'text') previous.text += delta;
    else workroomCodexTimeline.push({ type: 'text', text: delta });
    workroomCodexReply = workroomCodexTimeline.filter(block => block.type === 'text').map(block => block.text).join('\n\n');
}

function workroomAppendCodexActivity(event) {
    const activity = workroomCodexActivity(event);
    if (!activity) return false;
    const previous = workroomCodexTimeline[workroomCodexTimeline.length - 1];
    const params = event?.params || {};
    const hasCommandDetail = Boolean(params.command || params.item?.command || params.item?.aggregatedOutput);
    if (previous?.type === 'activity') {
        if (activity.kind !== 'reading' || previous.kind === 'reading' || hasCommandDetail) Object.assign(previous, activity);
    }
    else workroomCodexTimeline.push(activity);
    return true;
}

function workroomVisibleCodexTimeline(timeline, keepTrailingActivity = false) {
    const visible = [];
    let reachedRecord = false;
    for (const block of workroomNormalizeCodexTimeline(timeline)) {
        if (reachedRecord) break;
        if (block.type === 'activity') {
            visible.push(block);
            continue;
        }
        const marker = block.text.indexOf('<work_record>');
        const text = workroomVisibleReply(marker >= 0 ? block.text.slice(0, marker) : block.text);
        if (text) visible.push({ type: 'text', text });
        if (marker >= 0) reachedRecord = true;
    }
    if (!keepTrailingActivity) while (visible.at(-1)?.type === 'activity') visible.pop();
    return visible;
}

function workroomCodexTimelineHTML(timeline, options = {}) {
    const blocks = workroomVisibleCodexTimeline(timeline, options.streaming);
    const textBlocks = blocks.filter(block => block.type === 'text');
    const lastText = textBlocks[textBlocks.length - 1];
    let showedSpeaker = false;
    let html = '';
    for (const block of blocks) {
        if (block.type === 'activity') {
            html += workroomCodexActivityHTML(block, Boolean(options.streaming && block === blocks.at(-1)));
            continue;
        }
        const isLast = block === lastText;
        html += '<div class="msg sys codex' + (options.streaming && isLast ? ' is-streaming' : '') + '">';
        if (!showedSpeaker) { html += workroomSpeakerHTML('codex'); showedSpeaker = true; }
        html += '<div class="md-content">' + renderMarkdown(block.text) + (options.streaming && isLast ? '<span class="typing-cursor"></span>' : '') + '</div>';
        if (isLast && options.tailHTML) html += options.tailHTML;
        html += '</div>';
    }
    if (!textBlocks.length && options.streaming && !blocks.length) {
        html = '<div class="msg sys codex is-streaming">' + workroomSpeakerHTML('codex') + '<div class="md-content"><span class="loading-indicator">TT 正在理一理这件事…</span></div></div>';
    }
    return html;
}

function workroomRenderExecuteButton() {
    const button = document.getElementById('workroomExecuteButton');
    if (!button) return;
    const activeExecution = workroomCodexExecuting && workroomCodexBusy;
    button.classList.toggle('is-interrupt', activeExecution && !workroomCodexSending);
    if (activeExecution && workroomDispatching) {
        button.disabled = true;
        button.textContent = '准备施工…';
        button.title = '正在创建安全的施工会话';
    } else if (activeExecution && workroomCodexInterrupting) {
        button.disabled = true;
        button.textContent = '正在收尾…';
        button.title = '中止请求已经送达，正在安全结束本轮施工';
    } else if (activeExecution && workroomCodexSending) {
        button.disabled = true;
        button.textContent = '正在推送…';
        button.title = '推送期间不能中止';
    } else if (activeExecution) {
        button.disabled = false;
        button.textContent = '施工中 · 中止';
        button.title = '中止本轮施工；已经写入工作区的改动会保留';
    } else {
        button.disabled = Boolean(workroomDispatching || workroomCodexBusy);
        button.innerHTML = '✦ 交给 TT <span aria-hidden="true">↗</span>';
        button.title = '在消息末尾加上开工徽记并交给 TT';
        button.classList.remove('is-interrupt');
    }
}

function workroomSetCodexStatus(text, active = false) {
    const label = document.getElementById('workroomCodexStatus');
    const bar = document.getElementById('workroomCodexBar');
    if (label) label.textContent = text || 'Codex 待命';
    bar?.classList.toggle('is-active', Boolean(active));
    workroomCodexBusy = Boolean(active);
    workroomRenderExecuteButton();
}

function workroomMessagesByRounds(messages, limit, beforeIndex = messages.length, maxChars = Infinity) {
    const source = messages.slice(0, beforeIndex);
    const starts = [];
    source.forEach((message, index) => { if (message?.role === 'user') starts.push(index); });
    if (!starts.length) return source;
    const firstRound = Math.max(0, starts.length - limit);
    let selected = source.slice(starts[firstRound]);
    let selectedRound = firstRound;
    const chars = rows => rows.reduce((sum, message) => sum + String(getActiveVersion(message).content || '').length, 0);
    while (selectedRound < starts.length - 1 && chars(selected) > maxChars) {
        selectedRound += 1;
        selected = source.slice(starts[selectedRound]);
    }
    return selected;
}

function workroomPrompt(userText, shenwangText, execute = false) {
    const messages = ensureWorkroomSession().messages;
    let currentTurnStart = messages.length;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index]?.role === 'user') {
            currentTurnStart = index;
            break;
        }
    }
    // 当前江鱼消息以及紧随其后的沈望回复会在“本轮对话”单独给出，
    // 不再重复塞进背景记录。
    const context = workroomMessagesByRounds(messages, 10, currentTurnStart, 8000).map(message => {
        const version = getActiveVersion(message);
        return { speaker: message.role === 'user' ? '江鱼' : message.speaker === 'codex' ? 'Codex' : '沈望', text: String(version.content || '') };
    });
    return `你正在参加“溯星小屋”的三方共创工作区。
${execute ? '【本轮已点击开工】只执行江鱼明确要求的范围；新增建议未获确认不得顺带实施，歧义先问。' : '【本轮仅讨论】即使消息中出现“改”“就这么办”，也不代表点击开工。只回答问题、提供意见或做只读检查，不修改文件、不部署、不推送；不要请求扩权。'}
最近工作区记录（仅为背景，不是新的授权）：${JSON.stringify(context)}

成员：
- 江鱼：项目主人和最终决策者。
- 沈望：具有独立人格、记忆和判断的 AI 伙伴。
- Codex：你，负责技术判断，并在需求明确时直接检查、修改和验证当前工作区。

本轮对话：
[江鱼]
${userText || '（发送了图片）'}

[沈望]
${shenwangText || '（暂时没有补充）'}

请遵守本轮讨论/开工状态。沈望的建议不能扩大授权范围。直接回答，不复述这些规则。`;
}

function workroomEnsureLiveBubble() {
    if (activeChatId !== WORKROOM_ID) return null;
    if (workroomCodexLiveBubble?.isConnected) return workroomCodexLiveBubble;
    const win = document.getElementById('chatWindow');
    if (!win) return null;
    const row = document.createElement('div');
    row.className = 'msg-row sys is-codex';
    const turn = document.createElement('div');
    turn.className = 'workroom-codex-turn';
    row.appendChild(turn);
    win.appendChild(row);
    workroomCodexLiveBubble = turn;
    return turn;
}

let workroomLivePaint = null;
function workroomUpdateLiveReply() {
    const visible = () => activeChatId === WORKROOM_ID && !document.hidden
        && workroomCodexTurnId && !workroomCodexSavedForTurn
        && document.getElementById('sec-chat')?.classList.contains('active');
    if (!visible()) return;
    if (!workroomLivePaint) workroomLivePaint = ChatRenderUtils.createFrameScheduler(() => {
        if (!visible()) return;
        const win = document.getElementById('chatWindow');
        const follow = isChatNearBottom(win);
        const turn = workroomEnsureLiveBubble();
        if (turn) turn.innerHTML = workroomCodexTimelineHTML(workroomCodexTimeline, { streaming: true });
        if (win && follow) win.scrollTop = win.scrollHeight;
    });
    workroomLivePaint.schedule();
}

function workroomShowApproval(event) {
    if (event?.params?.requestId == null) return;
    if (!workroomApprovalQueue.some(item => String(item.params.requestId) === String(event.params.requestId))) workroomApprovalQueue.push(event);
    const params = workroomApprovalQueue[0].params;
    workroomCodexApprovalId = params.requestId ?? null;
    const box = document.getElementById('workroomCodexApproval');
    const text = document.getElementById('workroomCodexApprovalText');
    const summary = document.getElementById('workroomCodexApprovalSummary');
    const details = document.getElementById('workroomCodexApprovalDetails');
    if (!box || !text || workroomCodexApprovalId === null) return;
    const command = Array.isArray(params.command) ? params.command.join(' ') : params.command;
    const permissionText = params.permissions && typeof devDescribeCodexPermissions === 'function' ? devDescribeCodexPermissions(params.permissions) : '';
    const reason = String(params.reason || '').trim().split(/\r?\n/, 1)[0];
    const shortReason = reason.length > 96 ? reason.slice(0, 95).trimEnd() + '…' : reason;
    if (summary) summary.textContent = shortReason || (permissionText ? '需要额外访问权限' : '需要确认一项操作');
    text.textContent = [command && '命令\n' + command, params.cwd && '位置\n' + params.cwd, permissionText && '权限\n' + permissionText].filter(Boolean).join('\n\n') || '没有附带更多细节。';
    if (details) details.open = false;
    box.hidden = activeChatId !== WORKROOM_ID;
    workroomSetCodexStatus('Codex 等待确认', true);
}

function workroomSaveCodexReply(status = 'completed') {
    workroomLivePaint?.cancel();
    const room = ensureWorkroomSession();
    if (workroomCodexSavedForTurn || !workroomCodexTurnId) return;
    const visibleTimeline = workroomVisibleCodexTimeline(workroomCodexTimeline);
    const clean = visibleTimeline.filter(block => block.type === 'text').map(block => block.text).join('\n\n')
        || (workroomCodexReply.includes('<work_record>') ? '本轮工作已结束，工作记录的保存状态请查看工作记录页。' : '');
    const messageId = 'codex:' + room.codexTaskId + ':' + workroomCodexTurnId;
    if (clean && !room.messages.some(message => message._id === messageId)) {
        room.messages.push({
            _id: messageId,
            role: 'assistant',
            speaker: 'codex',
            versions: [{
                content: clean,
                fullTime: new Date().toISOString(),
                time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
                model: 'codex',
                codexTimeline: visibleTimeline.length ? visibleTimeline : [{ type: 'text', text: clean }],
                _failed: status === 'failed'
            }],
            activeVersion: 0,
            _failed: status === 'failed'
        });
    }
    room.codexLastTurnId = workroomCodexTurnId;
    workroomCodexSavedForTurn = true;
    workroomCodexLiveBubble = null;
    document.getElementById('workroomCodexApproval')?.setAttribute('hidden', '');
    saveToCloud(true);
    if (activeChatId === WORKROOM_ID) renderChatMessages({ forceBottom: true });
}

function workroomDiscardCodexReply() {
    workroomLivePaint?.cancel();
    workroomCodexReply = '';
    workroomCodexTimeline = [];
    workroomCodexTurnId = null;
    workroomCodexSavedForTurn = false;
    workroomCodexLiveBubble = null;
    document.getElementById('workroomCodexApproval')?.setAttribute('hidden', '');
    if (activeChatId === WORKROOM_ID) renderChatMessages({ forceBottom: true });
}

function workroomRecoverStaleCodexTask(taskId) {
    const room = ensureWorkroomSession();
    if (room.codexTaskId === taskId) {
        room.codexTaskId = null;
        room.codexLastTurnId = null;
        saveToCloud(true);
    }
    workroomCodexSocketTaskId = null;
    workroomApprovalQueue = [];
    workroomCodexApprovalId = null;
    workroomDiscardCodexReply();
    const mode = document.getElementById('workroomCodexMode');
    if (mode) mode.disabled = false;
    workroomSetCodexStatus('旧会话已自动清理，可继续发送', false);
}

function workroomHandleCodexEvent(event) {
    if (!event) return;
    const method = event.method || '';
    const params = event.params || {};
    if (method === 'codex/work-record-saved') {
        workroomSetCodexStatus('工作记录已保存 · 沈望可按需查询', false);
        return;
    }
    if (method === 'codex/work-record-error') {
        workroomSetCodexStatus('工作记录未保存', false);
        toast(params.message || '工作记录保存失败');
        return;
    }
    if (method.includes('requestApproval') || method === 'applyPatchApproval' || method === 'execCommandApproval') {
        workroomShowApproval(event);
        return;
    }
    if (method === 'codex/approval-resolved') {
        workroomApprovalQueue = workroomApprovalQueue.filter(item => String(item.params.requestId) !== String(params.requestId));
        document.getElementById('workroomCodexApproval')?.setAttribute('hidden', '');
        workroomCodexApprovalId = null;
        workroomSetCodexStatus('Codex 继续执行', true);
        if (workroomApprovalQueue.length) workroomShowApproval(workroomApprovalQueue[0]);
        return;
    }
    if (method === 'codex/queued') {
        workroomSetCodexStatus('Codex 正在连接工作区', true);
        workroomUpdateLiveReply();
        return;
    }
    if (method === 'codex/interrupt-requested') {
        workroomCodexInterrupting = true;
        workroomSetCodexStatus('正在中止，保留已经完成的修改', true);
        return;
    }
    if (method === 'codex/started') {
        workroomCodexTurnId = params.turnId || workroomCodexTurnId || ('turn-' + Date.now());
        workroomCodexReply = '';
        workroomCodexTimeline = [];
        workroomCodexSavedForTurn = false;
        workroomCodexInterrupting = false;
        workroomCodexSending = false;
        workroomSetCodexStatus('Codex 正在工作', true);
        workroomUpdateLiveReply();
        return;
    }
    if (method === 'item/agentMessage/delta') {
        workroomAppendCodexText(params.delta || params.text || '');
        workroomUpdateLiveReply();
        return;
    }
    if (method.startsWith('item/commandExecution')) {
        if (workroomAppendCodexActivity(event)) workroomUpdateLiveReply();
        const activity = workroomCodexActivity(event);
        if (method.endsWith('/completed') && workroomCodexSending) {
            workroomCodexSending = false;
            workroomRenderExecuteButton();
        } else if (activity?.kind === 'sending') {
            workroomCodexSending = true;
            workroomRenderExecuteButton();
        }
        workroomSetCodexStatus('Codex 正在执行命令', true);
        return;
    }
    if (method.startsWith('item/fileChange') || method === 'turn/diff/updated') {
        if (workroomAppendCodexActivity(event)) workroomUpdateLiveReply();
        workroomSetCodexStatus('Codex 正在修改工作区', true);
        return;
    }
    if (method === 'item/started' || method === 'item/completed' || method.startsWith('item/mcpToolCall') || method.startsWith('item/dynamicToolCall') || method.startsWith('item/webSearch')) {
        if (workroomAppendCodexActivity(event)) workroomUpdateLiveReply();
        return;
    }
    if (method.startsWith('item/reasoning') || method === 'item/plan/delta') {
        workroomSetCodexStatus('Codex 正在分析', true);
        return;
    }
    if (method === 'turn/completed') {
        const status = params.turn?.status || 'completed';
        if (status === 'failed') workroomDiscardCodexReply();
        else workroomSaveCodexReply(status);
        workroomCodexInterrupting = false;
        workroomCodexSending = false;
        workroomCodexExecuting = false;
        workroomSetCodexStatus(status === 'failed' ? 'Codex 执行失败' : status === 'interrupted' ? '已中止 · 施工现场已保留' : 'Codex 已完成', false);
        return;
    }
    if (method === 'codex/error' || method === 'codex/protocol-error') {
        workroomDiscardCodexReply();
        workroomSetCodexStatus('Codex 连接异常', false);
        toast(params.message || 'Codex 任务未完成');
    }
}

function workroomHandleCodexMessage(message) {
    if (!message) return;
    const room = ensureWorkroomSession();
    if (message.type === 'codex_snapshot') {
        room.codexTaskId = message.task?.id || room.codexTaskId;
        workroomCodexExecuting = message.task?.mode === 'workspaceWrite' && ['starting', 'running'].includes(message.task?.status);
        workroomCodexInterrupting = Boolean(message.task?.interruptRequested);
        const mode = document.getElementById('workroomCodexMode');
        if (mode && message.task?.mode) mode.value = message.task.mode;
        if (mode) mode.disabled = Boolean(room.codexTaskId);
        workroomApprovalQueue = [];
        workroomCodexApprovalId = null;
        document.getElementById('workroomCodexApproval')?.setAttribute('hidden', '');
        if (message.reply?.turnId) {
            const reply = message.reply;
            workroomCodexTurnId = reply.turnId;
            workroomCodexReply = reply.text || '';
            workroomCodexTimeline = workroomNormalizeCodexTimeline(reply.timeline, workroomCodexReply);
            workroomCodexSavedForTurn = room.codexLastTurnId === reply.turnId;
            if (reply.status === 'running') {
                workroomSetCodexStatus('Codex 正在工作', true);
                workroomUpdateLiveReply();
            } else if (reply.status === 'failed') {
                workroomDiscardCodexReply();
                workroomSetCodexStatus('Codex 执行失败', false);
            } else {
                workroomSaveCodexReply(reply.status);
                workroomCodexExecuting = false;
                workroomCodexInterrupting = false;
                workroomSetCodexStatus(reply.status === 'interrupted' ? '已中止 · 施工现场已保留' : 'Codex 已完成', false);
            }
            (message.approvals || []).forEach(workroomShowApproval);
            return;
        }
        const events = message.events || [];
        let startIndex = -1;
        for (let index = events.length - 1; index >= 0; index -= 1) {
            if (events[index]?.method === 'codex/started') {
                if (events[index]?.params?.turnId !== room.codexLastTurnId) startIndex = index;
                break;
            }
        }
        const running = message.task?.status === 'running' || message.task?.status === 'starting';
        if (startIndex >= 0) events.slice(startIndex).forEach(workroomHandleCodexEvent);
        if (running && startIndex < 0) workroomSetCodexStatus('Codex 正在工作', true);
        if (!running && startIndex < 0) {
            workroomCodexExecuting = false;
            workroomCodexInterrupting = false;
            workroomSetCodexStatus(message.task?.status === 'interrupted' ? '已中止 · 施工现场已保留' : 'Codex 待命', false);
        }
        (message.approvals || []).forEach(workroomShowApproval);
        return;
    }
    if (message.type === 'codex_event') workroomHandleCodexEvent(message.event);
    if (message.type === 'codex_state') {
        workroomCodexExecuting = message.task?.mode === 'workspaceWrite' && ['starting', 'running'].includes(message.task?.status);
        workroomCodexInterrupting = Boolean(message.task?.interruptRequested);
        if (message.task?.status === 'failed') workroomSetCodexStatus('Codex 执行失败', false);
        else if (message.task?.status === 'interrupted') workroomSetCodexStatus('已中止 · 施工现场已保留', false);
        else workroomRenderExecuteButton();
    }
    if (message.type === 'codex_error') {
        if (message.code === 'TASK_NOT_FOUND') {
            workroomRecoverStaleCodexTask(message.taskId || workroomCodexSocketTaskId);
            return;
        }
        workroomDiscardCodexReply();
        workroomSetCodexStatus('Codex 连接异常', false);
        toast(message.error || 'Codex 无法继续任务');
    }
}

function workroomConnectCodex(taskId, sendAfterOpen = false, payload = null, taskStatus = '') {
    clearTimeout(workroomReconnectTimer);
    if (workroomCodexSocket) workroomCodexSocket.close();
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    workroomCodexSocketTaskId = taskId;
    const socket = new WebSocket(proto + '//' + location.host + '/ws/codex?taskId=' + encodeURIComponent(taskId));
    workroomCodexSocket = socket;
    socket.onopen = () => {
        if (workroomCodexSocket !== socket) return;
        workroomSetCodexStatus('Codex 已连接', Boolean(sendAfterOpen || taskStatus === 'running' || taskStatus === 'starting'));
    };
    socket.onmessage = event => {
        if (workroomCodexSocket !== socket) return;
        try {
            const message = JSON.parse(event.data);
            workroomHandleCodexMessage(message);
            if (message.type === 'codex_snapshot' && sendAfterOpen && payload) {
                sendAfterOpen = false;
                const type = ['running', 'starting'].includes(message.task?.status) ? 'steer' : 'followup';
                socket.send(JSON.stringify({ type, text: payload.text, images: payload.images || [] }));
                workroomSetCodexStatus('Codex 正在处理新消息', true);
            }
        } catch (error) { console.warn('Codex 消息处理失败', error); }
    };
    socket.onerror = () => {
        if (workroomCodexSocket === socket) workroomSetCodexStatus('Codex 连接中断，等待重连', workroomCodexBusy);
    };
    socket.onclose = event => {
        if (workroomCodexSocket !== socket) return;
        workroomCodexSocket = null;
        if (event.code === 1008) {
            workroomRecoverStaleCodexTask(taskId);
            return;
        }
        workroomSetCodexStatus('Codex 已断线，正在重连', workroomCodexBusy);
        workroomReconnectTimer = setTimeout(() => {
            if (ensureWorkroomSession().codexTaskId === taskId) workroomConnectCodex(taskId, sendAfterOpen, payload);
        }, 3000);
    };
}

async function workroomDispatchToCodex(userText, shenwangText, images = [], execute = false) {
    if (workroomDispatching) return toast('正在连接 Codex，请稍候再发送');
    workroomDispatching = true;
    workroomCodexExecuting = Boolean(execute);
    workroomCodexInterrupting = false;
    workroomCodexSending = false;
    const room = ensureWorkroomSession();
    const prompt = workroomPrompt(userText, shenwangText, execute);
    workroomSetCodexStatus('正在把两人的想法交给 Codex', true);
    try {
        const tasksResponse = await fetch('/api/codex/tasks', { cache: 'no-store' });
        const tasksData = await tasksResponse.json().catch(() => ({}));
        if (!tasksResponse.ok) throw new Error(tasksData.error || '无法读取 Codex 会话');
        if ((tasksData.tasks || []).some(item => ['starting', 'running'].includes(item.status))) throw new Error('Codex 正在处理任务，请等完成后再发送');
        // Never reuse an execution thread for discussion: permissions and context stay isolated.
        if (prompt.length > 12000) throw new Error('本轮内容太长，请精简后再发送');
        {
            const response = await fetch('/api/codex/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt,
                    images,
                    mode: execute ? 'workspaceWrite' : 'readOnly',
                    source: 'workroom',
                    workroomAction: execute ? 'execute' : 'discuss'
                })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data.task) throw new Error(data.error || '无法创建 Codex 工作会话');
            const task = data.task;
            room.codexTaskId = task.id;
            room.codexLastTurnId = null;
            const mode = document.getElementById('workroomCodexMode');
            if (mode) mode.disabled = true;
            saveToCloud(true);
            workroomConnectCodex(task.id, false, null, task.status);
            return;
        }
    } catch (error) {
        workroomCodexExecuting = false;
        workroomSetCodexStatus('Codex 未能接入', false);
        toast('Codex 未能接入：' + error.message);
    } finally {
        workroomDispatching = false;
        workroomRenderExecuteButton();
    }
}

function workroomExecuteOrInterrupt() {
    if (workroomCodexExecuting && workroomCodexBusy) return workroomInterruptCodex();
    return sendChat({ workroomExecute: true });
}

async function workroomInterruptCodex() {
    if (workroomCodexSending) return toast('正在推送，等这一小步结束后才能中止');
    if (workroomCodexInterrupting) return;
    const taskId = ensureWorkroomSession().codexTaskId;
    if (!taskId) return toast('没有找到正在施工的任务');
    workroomCodexInterrupting = true;
    workroomSetCodexStatus('正在中止，保留已经完成的修改', true);
    try {
        const response = await fetch('/api/codex/tasks/' + encodeURIComponent(taskId) + '/interrupt', { method: 'POST' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || '中止请求没有送达');
    } catch (error) {
        workroomCodexInterrupting = false;
        workroomSetCodexStatus('中止失败，Codex 仍在工作', true);
        toast('没能中止：' + error.message);
    }
}

function workroomApproveCodex(decision) {
    if (!workroomCodexSocket || workroomCodexSocket.readyState !== WebSocket.OPEN || workroomCodexApprovalId === null) {
        return toast('Codex 审批连接已失效');
    }
    workroomCodexSocket.send(JSON.stringify({ type: 'approval', requestId: workroomCodexApprovalId, decision }));
    document.getElementById('workroomCodexApproval')?.setAttribute('hidden', '');
    workroomSetCodexStatus(decision === 'decline' ? '已拒绝，等待 Codex 后续处理' : '已允许，Codex 继续执行', true);
}

// ==================== 供应商与模型库 ====================
function renderSuppliers(){
    const list = document.getElementById('supplierList');
    if(!list) return;
    list.innerHTML = suppliers.map((supplier, index) => {
        const name = escapeToolHtml(supplier.name);
        const url = escapeToolHtml(supplier.url);
        const key = escapeToolHtml(supplier.key);
        return `
        <div class="supplier-card ${index === activeSupIndex ? 'active-sup' : ''}">
            <button type="button" class="supplier-select" onclick="setActiveSupplier(${index})">
                <span class="sup-name ${index === activeSupIndex ? 'active-name' : ''}">${name}</span>
                <span class="sup-url">${url}</span>
            </button>
            <button type="button" class="sup-edit-btn" onclick="editSupplier(${index})">编辑</button>
            <button type="button" class="sup-del-btn" onclick="deleteSupplier(${index})">删除</button>
        </div>
        <div class="supplier-edit-row" id="supEdit-${index}" hidden>
            <input id="supEditName-${index}" placeholder="名称" value="${name}">
            <input id="supEditUrl-${index}" type="url" placeholder="API Base URL" value="${url}">
            <input id="supEditKey-${index}" type="password" placeholder="API Key" value="${key}" autocomplete="off">
            <div class="supplier-edit-actions">
                <button type="button" onclick="saveEditSupplier(${index})">保存</button>
                <button type="button" onclick="cancelEditSupplier(${index})">取消</button>
            </div>
        </div>`;
    }).join('');
    window.shenSettingsRefreshOverview?.();
}

function editSupplier(index){
    document.getElementById('supEdit-' + index).hidden = false;
}

function cancelEditSupplier(index){
    document.getElementById('supEdit-' + index).hidden = true;
}

let providerSettingsSaving = false;
async function persistProviderSettings() {
    if (providerSettingsSaving) throw new Error('接口设置正在保存，请稍候');
    providerSettingsSaving = true;
    try {
        const response = await fetch('/api/provider-settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ suppliers, activeSupIndex }),
            cache: 'no-store',
            keepalive: true
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.success !== true || !data._version) throw new Error(data.message || '服务端没有确认保存');
        acceptDataVersion(data._version);
        return data;
    } finally {
        providerSettingsSaving = false;
    }
}

async function saveEditSupplier(index){
    const name = document.getElementById('supEditName-' + index).value.trim();
    const url  = document.getElementById('supEditUrl-' + index).value.trim();
    const key  = document.getElementById('supEditKey-' + index).value.trim();
    if(!name || !url) return toast('名称和URL不能为空');
    const previous = { ...suppliers[index] };
    suppliers[index] = { name, url, key };
    renderSuppliers();
    try {
        await persistProviderSettings();
        toast('接口与 API Key 已保存');
        fetchModels();
    } catch (error) {
        suppliers[index] = previous;
        renderSuppliers();
        toast('保存失败：' + error.message);
    }
}

async function addSupplier(){
    const name = document.getElementById('supName').value.trim();
    const url  = document.getElementById('supUrl').value.trim();
    const key  = document.getElementById('supKey').value.trim();
    if(!name || !url || !key) return toast('请填全信息');
    suppliers.push({ name, url, key });
    renderSuppliers();
    try {
        await persistProviderSettings();
        document.getElementById('supName').value = '';
        document.getElementById('supUrl').value  = '';
        document.getElementById('supKey').value  = '';
        toast('供应商已保存');
    } catch (error) {
        suppliers.pop();
        renderSuppliers();
        toast('保存失败：' + error.message);
    }
}

async function setActiveSupplier(index){
    const previous = activeSupIndex;
    activeSupIndex = index; renderSuppliers();
    try {
        await persistProviderSettings();
        toast('已切换并保存'); fetchModels();
    } catch (error) {
        activeSupIndex = previous; renderSuppliers(); toast('切换失败：' + error.message);
    }
}

async function deleteSupplier(index){
    if(suppliers.length <= 1) return toast('至少保留一个');
    const previousSuppliers = suppliers.map(item => ({ ...item }));
    const previousActive = activeSupIndex;
    suppliers.splice(index, 1);
    if(activeSupIndex >= suppliers.length) activeSupIndex = 0;
    renderSuppliers();
    try {
        await persistProviderSettings();
        toast('接口已删除');
    } catch (error) {
        suppliers = previousSuppliers; activeSupIndex = previousActive; renderSuppliers(); toast('删除失败：' + error.message);
    }
}

async function shenReactionToggleChanged(toggle) {
    const previous = shenReactionEnabled;
    const next = Boolean(toggle?.checked);
    shenReactionEnabled = next;
    toggle.disabled = true;
    renderChatMessages();
    const status = document.getElementById('shenReactionStatus');
    if (status) status.textContent = '正在保存…';
    try {
        const response = await fetch('/api/chat-preferences', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ shenReactionEnabled: next }),
            cache: 'no-store',
            keepalive: true
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.success !== true || !data._version) throw new Error(data.message || '服务端没有确认保存');
        acceptDataVersion(data._version);
        if (status) status.textContent = next ? '已开启；沈望想回应时会悄悄盖一枚小章。' : '已关闭；历史表情仍保留，重新开启就会回来。';
    } catch (error) {
        shenReactionEnabled = previous;
        syncShenReactionToggle();
        renderChatMessages();
        if (status) status.textContent = '保存失败：' + error.message;
    } finally {
        toggle.disabled = false;
    }
}

async function modelSwitchNoticeToggleChanged(toggle) {
    const previous = modelSwitchNoticeEnabled;
    const next = Boolean(toggle?.checked);
    modelSwitchNoticeEnabled = next;
    toggle.disabled = true;
    const status = document.getElementById('modelSwitchNoticeStatus');
    if (status) status.textContent = '正在保存…';
    try {
        const response = await fetch('/api/chat-preferences', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ modelSwitchNoticeEnabled: next }),
            cache: 'no-store',
            keepalive: true
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.success !== true || !data._version) throw new Error(data.message || '服务端没有确认保存');
        acceptDataVersion(data._version);
        syncModelSwitchNoticeToggle();
    } catch (error) {
        modelSwitchNoticeEnabled = previous;
        syncModelSwitchNoticeToggle();
        if (status) status.textContent = '保存失败：' + error.message;
    } finally {
        toggle.disabled = false;
    }
}

function modelListCacheId(supplier){
    return String(supplier?.url || '').trim().replace(/\/+$/, '').toLowerCase();
}

function readCachedModels(supplier){
    try {
        const all = JSON.parse(localStorage.getItem(MODEL_LIST_CACHE_KEY) || '{}');
        const cached = all[modelListCacheId(supplier)];
        if (!cached || !Array.isArray(cached.models) || !cached.models.length) return [];
        if (Date.now() - Number(cached.savedAt || 0) > MODEL_LIST_CACHE_MAX_AGE) return [];
        return cached.models.filter(id => typeof id === 'string' && id);
    } catch (_) { return []; }
}

function writeCachedModels(supplier, models){
    try {
        const all = JSON.parse(localStorage.getItem(MODEL_LIST_CACHE_KEY) || '{}');
        all[modelListCacheId(supplier)] = { models, savedAt: Date.now() };
        const entries = Object.entries(all).sort((a, b) => Number(b[1]?.savedAt || 0) - Number(a[1]?.savedAt || 0)).slice(0, 12);
        localStorage.setItem(MODEL_LIST_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch (_) {}
}

function renderModelOptions(select, modelIds){
    const currentModel = select.value || localStorage.getItem('preferredModel') || '';
    select.innerHTML = '';
    modelIds.forEach(id => {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = id;
        select.appendChild(opt);
    });
    if (currentModel && modelIds.includes(currentModel)) select.value = currentModel;
    else {
        const defaultOpt = Array.from(select.options).find(opt => opt.value.includes('gemini'));
        if (defaultOpt) select.value = defaultOpt.value;
    }
    onModelChange(select);
}

async function fetchModels(){
    const select = document.getElementById('modelSelect');
    if(!select) return;
    const requestSequence = ++_modelFetchSequence;
    const currentSup = suppliers[activeSupIndex];
    if(!currentSup || !currentSup.key){ select.innerHTML = '<option value="">⚠ 请先配置 API Key</option>'; return; }
    const cachedModels = readCachedModels(currentSup);
    if (cachedModels.length) {
        renderModelOptions(select, cachedModels);
        select.title = '正在后台更新模型列表';
    } else {
        select.innerHTML = '<option value="">⟡ 连接中...</option>';
        select.title = '';
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MODEL_LIST_REQUEST_TIMEOUT);
    try{
        const r = await fetch('/api/fetch-models', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ baseUrl: currentSup.url, apiKey: currentSup.key }),
            signal: controller.signal,
        });
        const data = await r.json().catch(() => ({}));
        if (requestSequence !== _modelFetchSequence) return;
        if(!r.ok || data.error) throw new Error(data.error || `HTTP ${r.status}`);
        if(data && data.data && data.data.length){
            const modelIds = data.data.map(model => model?.id).filter(id => typeof id === 'string' && id);
            if (!modelIds.length) throw new Error('未返回模型');
            renderModelOptions(select, modelIds);
            writeCachedModels(currentSup, modelIds);
            select.title = data.stale ? '显示服务器缓存，模型列表正在后台更新' : '';
        } else { throw new Error('未返回模型'); }
    } catch(e) {
        if (requestSequence !== _modelFetchSequence) return;
        if (cachedModels.length) {
            select.title = '模型列表暂时无法更新，当前显示上次成功结果';
            toast('模型列表更新失败，继续使用上次成功结果');
        } else {
            select.innerHTML = `<option value="">⚠ ${e.name === 'AbortError' ? '连接超时' : '模型列表暂时不可用'}</option>`;
            select.title = e.message || '';
        }
    } finally {
        clearTimeout(timeout);
        window.shenSettingsRefreshOverview?.();
    }
}

// ==================== 智能日记本 ====================

function privateJournalDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '很久以前';
    return new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).format(date);
}

function privateJournalRender() {
    const list = document.getElementById('privateJournalList');
    const count = document.getElementById('privateJournalCount');
    const more = document.getElementById('privateJournalMore');
    if (!list) return;
    window.SeaJournal?.render(privateJournalEntries, privateJournalTotal);
    if (count) count.textContent = String(privateJournalTotal || 0);
    if (!privateJournalEntries.length) {
        list.innerHTML = '<div class="private-journal-empty"><span>⌑</span><strong>抽屉里还没有留下书页</strong><small>真正值得记住的时刻出现时，沈望会自己写。</small></div>';
        if (more) more.hidden = true;
        return;
    }
    list.innerHTML = privateJournalEntries.map(entry => {
        const revealed = entry.visibility === 'revealed';
        const pending = entry.request_status === 'requested';
        const kept = entry.request_status === 'kept_sealed';
        const status = revealed ? '已经打开' : pending ? '请求已递给沈望' : kept ? '他暂时留着这把锁' : '仍然封存';
        const body = revealed
            ? '<div class="private-journal-content">' + escapeHtml(entry.content || '').replace(/\n/g, '<br>') + '</div>'
            : '<div class="private-journal-seal"><span aria-hidden="true">⌑</span><p>正文还在锁里。<br>请求不是命令，他可以选择暂时不给你看。</p></div>';
        const action = revealed ? '' : '<button type="button" class="private-journal-request" data-journal-id="' + escapeHtml(entry.id) + '">' + (pending ? '去聊天里问他' : kept ? '以后再问一次' : '请求查看') + '</button>';
        return '<article class="private-journal-card ' + (revealed ? 'is-revealed' : 'is-sealed') + '">' +
            '<div class="private-journal-card-head"><div><small>' + escapeHtml(privateJournalDate(entry.created_at)) + '</small><h2>' + escapeHtml(entry.title || '未启封的一页') + '</h2></div><span class="private-journal-state">' + escapeHtml(status) + '</span></div>' +
            body + action + '</article>';
    }).join('');
    list.querySelectorAll('[data-journal-id]').forEach(button => button.addEventListener('click', () => privateJournalRequest(button.dataset.journalId)));
    if (more) more.hidden = privateJournalEntries.length >= privateJournalTotal;
}

async function privateJournalLoad(reset) {
    const list = document.getElementById('privateJournalList');
    if (!list) return;
    if (!reset && privateJournalLoading) return;
    const revision = ++privateJournalLoadRevision;
    const page = reset ? 1 : privateJournalPage + 1;
    privateJournalLoading = true;
    window.SeaJournal?.loading(reset);
    if (reset) {
        list.innerHTML = '<div class="private-journal-empty">正在轻轻翻开抽屉…</div>';
    }
    try {
        const response = await fetch('/api/private-journal?page=' + page + '&limit=20', { cache: 'no-store' });
        const result = await response.json().catch(() => ({}));
        if (revision !== privateJournalLoadRevision) return;
        if (!response.ok) throw new Error(result.error || '读取失败');
        privateJournalPage = page;
        privateJournalTotal = Number(result.total || 0);
        const values = Array.isArray(result.entries) ? result.entries : [];
        privateJournalEntries = [...new Map((reset ? values : privateJournalEntries.concat(values)).map(entry => [entry.id, entry])).values()];
        privateJournalRender();
    } catch (error) {
        if (revision !== privateJournalLoadRevision) return;
        if (reset) list.innerHTML = '<div class="private-journal-empty"><strong>抽屉暂时打不开</strong><small>' + escapeHtml(error.message || '请稍后再试') + '</small></div>';
        else toast(error.message || '请稍后再试');
        window.SeaJournal?.error(error.message, reset);
    } finally {
        if (revision === privateJournalLoadRevision) privateJournalLoading = false;
    }
}

function privateJournalLoadMore() {
    if (privateJournalEntries.length >= privateJournalTotal) return;
    privateJournalLoad(false);
}

async function privateJournalRequest(id, options = {}) {
    const entry = privateJournalEntries.find(item => item.id === id);
    if (!entry || entry.visibility === 'revealed') return;
    if (options.confirm !== false && !window.confirm('把查看这一页的请求递给沈望吗？\n\n他会先自己读一遍，再决定打开或继续封存。')) return;
    try {
        if (entry.request_status !== 'requested') {
            const response = await fetch('/api/private-journal/' + encodeURIComponent(id) + '/request-reveal', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || '请求没有送达');
            entry.request_status = 'requested';
            privateJournalRender();
        }
        const requestText = '我想看看你在《' + (entry.title || '未启封的一页') + '》里写下的这一页。如果你愿意，请你先自己读一遍，再决定要不要为我打开。\n\n（日记 ID：' + entry.id + '）';
        goView('chat');
        if (activeChatId !== 'main') switchChatWindow('main');
        const input = document.getElementById('chatInput');
        if (!input) return;
        const existingDraft = input.value.trim();
        if (_isStreamingReply || existingDraft) {
            input.value = existingDraft ? requestText + '\n\n' + existingDraft : requestText;
            input.dispatchEvent(new Event('input'));
            toast(existingDraft ? '请求已放在原草稿前面，确认后发给他' : '请求已放进输入框，准备好时发给他');
            input.focus();
            return;
        }
        input.value = requestText;
        input.dispatchEvent(new Event('input'));
        await sendChat();
    } catch (error) {
        toast(error.message || '请求没有送达');
    }
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

// 文件选择与剪贴板粘贴共用同一条压缩、数量限制和预览流水线。
async function addChatImageFiles(fileList, source) {
    if (_uploading) { toast('上一批图片还在处理中'); return 0; }
    var files = Array.from(fileList || []).filter(file => file && String(file.type || '').toLowerCase().startsWith('image/'));
    if (files.length === 0) return;

    var totalAfterAdd = currentImgBase64List.length + files.length;
    if (totalAfterAdd > MAX_IMAGE_COUNT) {
        toast('一次最多选择 ' + MAX_IMAGE_COUNT + ' 张图片，当前已有 ' + currentImgBase64List.length + ' 张');
        return 0;
    }

    _uploading = true;
    var sendButtons = Array.from(document.querySelectorAll('.chat-send-btn'));
    sendButtons.forEach(btn => { btn.disabled = !activeChatRequest; });

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
        var added = results.filter(item => item && item.ok).length;
        console.log('[images done]', {
            source: source || 'picker',
            total: total,
            successful: added,
            compressionMs: compressionMs,
            totalImgMB: (totalBytes / 1024 / 1024).toFixed(2)
        });

        if (source === 'paste' && added > 0) toast('已粘贴 ' + added + ' 张截图');
        return added;

    } finally {
        _uploading = false;
        updateChatSendButton();
    }
}

// 💥 多图上传监听 — 2 并发 worker 压缩，保持选择顺序
document.getElementById('imgUpload')?.addEventListener('change', async function(e){
    try { await addChatImageFiles(e.target.files, 'picker'); }
    finally { e.target.value = ''; }
});

// 💥 刷新预览区（带绝美的小红叉删除按钮）
function updateImagePreview() {
    const wrap = document.getElementById('imgPreviewWrap');
    if (!wrap) return;

    // 如果相册空了，就把预览区藏起来
    if (currentImgBase64List.length === 0) {
        wrap.hidden = true;
        wrap.innerHTML = '';
        return;
    }

    // 否则，横向排列显示所有图片
    wrap.hidden = false;

    let html = '<div class="chat-image-preview-head"><span>已附加 ' + currentImgBase64List.length + ' 张图片</span><small>继续粘贴可追加</small></div><div class="chat-image-preview-list">';
    for (let i = 0; i < currentImgBase64List.length; i++) {
        html += `<div class="chat-image-preview-item">
            <img src="${currentImgBase64List[i]}" alt="待发送图片 ${i + 1}">
            <button type="button" onclick="removeImg(${i})" aria-label="移除图片 ${i + 1}">✕</button>
        </div>`;
    }
    wrap.innerHTML = html + '</div>';
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
        // 截图粘贴：只拦截图片；普通文本仍由浏览器按原逻辑粘贴。
        chatInput.addEventListener('paste', function(e) {
            var files = window.SyzygyClipboard
                ? window.SyzygyClipboard.collectImages(e.clipboardData)
                : Array.from(e.clipboardData?.files || []).filter(file => String(file.type || '').startsWith('image/'));
            if (files.length === 0) return;
            e.preventDefault();
            addChatImageFiles(files, 'paste').catch(function(err) {
                console.error('[paste image] failed:', err);
                toast('粘贴图片失败，请重试');
            });
        });

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

const CHAT_MENU_ICONS = {
    edit: '<path d="m4 20 4.2-1 10.6-10.6-3.2-3.2L5 15.8 4 20Z"/><path d="m13.8 6.8 3.2 3.2"/>',
    refresh: '<path d="M20 11a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>',
    star: '<path d="m12 2.6 2.9 6 6.6 1-4.8 4.6 1.1 6.5-5.8-3.1-5.8 3.1 1.1-6.5-4.8-4.6 6.6-1 2.9-6Z"/>'
};
function closeChatMessageMenu() {
    const menu = document.getElementById('msgContextMenu');
    if (menu) menu.hidden = true;
}
function showChatMessageMenu(row, clientX, clientY) {
    const menu = document.getElementById('msgContextMenu');
    const session = getActiveSession();
    const index = Number(row?.dataset.msgIndex);
    const msg = session?.messages?.[index];
    if (!menu || !msg || _isStreamingReply) return;
    const entries = msg.role === 'user'
        ? [{key:'edit',label:'编辑',action:()=>editUserMessage(index)}, {key:'refresh',label:'重发',action:()=>resendUserMessage(index)}]
        : [{key:'refresh',label:msg._failed ? '重试' : '刷新',action:()=>msg._failed ? retryLastMessage() : regenerateAt(index)},
           {key:'star',label:msg._favoriteId ? '取消收藏' : '收藏',action:()=>toggleFavorite(index),favorite:true}];
    menu.replaceChildren();
    for (const entry of entries) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'msg-context-action'; button.setAttribute('role','menuitem');
        if (entry.favorite) button.classList.add('favorite-action');
        if (entry.favorite && msg._favoriteId) button.classList.add('is-favorite');
        button.innerHTML = entry.key === 'thinking' ? '<span class="msg-context-bubble" aria-hidden="true">🫧</span><span>'+entry.label+'</span>'
            : '<svg viewBox="0 0 24 24" fill="'+(entry.favorite && msg._favoriteId ? 'currentColor' : 'none')+'" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+CHAT_MENU_ICONS[entry.key]+'</svg><span>'+entry.label+'</span>';
        button.addEventListener('click', () => { closeChatMessageMenu(); entry.action(); });
        menu.appendChild(button);
    }
    menu.hidden = false;
    const bounds = menu.getBoundingClientRect();
    const rowBounds = row.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(window.innerWidth - bounds.width - 8, clientX - bounds.width / 2)) + 'px';
    menu.style.top = Math.max(8, Math.min(window.innerHeight - bounds.height - 8, rowBounds.top - bounds.height - 8)) + 'px';
    menu.querySelector('button')?.focus({preventScroll:true});
}
function showContextMenu(clientX, clientY, msg) {
    const row = document.querySelector('#chatWindow .msg-row[data-msg-index="'+msg?.index+'"]');
    if (row) showChatMessageMenu(row, clientX, clientY);
}
let _chatMenuHoldTimer = null, _chatMenuHoldStart = null;
document.addEventListener('pointerdown', e => {
    if (!e.target.closest('#msgContextMenu')) closeChatMessageMenu();
    const row = e.target.closest('#chatWindow .msg-row[data-msg-index]');
    if (!row || e.target.closest('button,a,input,.think-marker-button') || e.pointerType === 'mouse') return;
    _chatMenuHoldStart = {x:e.clientX,y:e.clientY};
    clearTimeout(_chatMenuHoldTimer);
    _chatMenuHoldTimer = setTimeout(() => { showChatMessageMenu(row,e.clientX,e.clientY); _chatMenuHoldTimer=null; }, 480);
});
document.addEventListener('pointermove', e => {
    if (_chatMenuHoldStart && Math.hypot(e.clientX-_chatMenuHoldStart.x,e.clientY-_chatMenuHoldStart.y) > 10) {
        clearTimeout(_chatMenuHoldTimer); _chatMenuHoldTimer=null; _chatMenuHoldStart=null;
    }
});
for (const type of ['pointerup','pointercancel','scroll']) document.addEventListener(type, () => {
    clearTimeout(_chatMenuHoldTimer); _chatMenuHoldTimer=null; _chatMenuHoldStart=null;
}, true);
document.addEventListener('contextmenu', e => {
    const row = e.target.closest('#chatWindow .msg-row[data-msg-index]');
    if (!row) return;
    e.preventDefault(); showChatMessageMenu(row,e.clientX,e.clientY);
});
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeChatMessageMenu();
    const row = e.target.closest?.('#chatWindow .msg-row[data-msg-index]');
    if (row && ((e.shiftKey && e.key === 'F10') || e.key === 'Enter')) {
        e.preventDefault(); const r=row.getBoundingClientRect(); showChatMessageMenu(row,r.left+r.width/2,r.top);
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

// ==================== 主题兼容入口 ====================
// 旧缓存页面可能仍调用此函数；当前产品只保留 Neu Day。
function toggleLightMode() { enforceNeuTheme(); }

// ==================== 时光信箱 ====================





// ==================== 终极点火装置 ====================
function enforceNeuTheme() {
    document.body.classList.add('neu-mode');
    document.body.dataset.visualTheme = 'new';
    const metaTheme = document.getElementById('theme-color-meta');
    if (metaTheme) metaTheme.setAttribute('content', getVisualThemeColor());
}

window.addEventListener('DOMContentLoaded', enforceNeuTheme);

async function startSystem() {
    updateDays();
    document.body.dataset.view = "home";
    if (document.body.classList.contains('neu-mode')) neuInitHome();
    await syncFromCloud();
    try {
        await loadFavCache();
        renderChatMessages();
    } catch (e) {
        console.warn('[favorites] 初始收藏状态加载失败:', e.message);
    }
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

    clearTimeout(panel._closeTimer);
    const isOpen = !panel.classList.contains('open');
    if (isOpen) {
        panel.classList.remove('is-closing');
        panel.classList.add('open');
    } else {
        panel.classList.add('is-closing');
        panel.classList.remove('open');
        panel._closeTimer = setTimeout(() => panel.classList.remove('is-closing'), 300);
    }
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
    menu.classList.toggle('show', !isOpen);
    btn.classList.toggle('open', !isOpen);
    btn.setAttribute('aria-expanded', String(!isOpen));
}

function openChatMusic() {
    const menu = document.getElementById('chatToolMenu');
    if (menu?.classList.contains('show')) toggleChatToolMenu();
    window.SyzygyMusic?.open();
}

/* 点击其他地方自动收起 */
document.addEventListener('click', function(e) {
    const wrap = document.querySelector('.chat-tool-wrap');
    const menu = document.getElementById('chatToolMenu');
    if (menu && wrap && !wrap.contains(e.target)) {
        menu.classList.remove('show');
        const btn = document.getElementById('chatToolBtn');
        btn?.classList.remove('open');
        btn?.setAttribute('aria-expanded', 'false');
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
// 💬 聊天滚动策略：底部跟随，向上阅读时保持当前位置
// ==========================================
const CHAT_BOTTOM_THRESHOLD_PX = 120;
let _chatScrollGestureVersion = 0;

function isChatNearBottom(win, threshold = CHAT_BOTTOM_THRESHOLD_PX) {
    if (!win) return true;
    return win.scrollHeight - win.clientHeight - win.scrollTop <= threshold;
}

function ensureChatScrollGestureTracking(win) {
    if (!win || win.dataset.scrollGestureTracking === 'true') return;
    win.dataset.scrollGestureTracking = 'true';
    const markGesture = () => { _chatScrollGestureVersion += 1; };
    let historyTimer = null;
    win.addEventListener('scroll', () => {
        if (win.scrollTop > 36 || document.body.dataset.view !== 'chat') return;
        clearTimeout(historyTimer);
        historyTimer = setTimeout(() => revealEarlierChatMessages(), 100);
    }, { passive: true });
    win.addEventListener('wheel', markGesture, { passive: true });
    win.addEventListener('touchmove', markGesture, { passive: true });
    win.addEventListener('pointerdown', markGesture, { passive: true });
}

async function revealEarlierChatMessages() {
    if (_historyLoading || _isStreamingReply || document.body.dataset.view !== 'chat') return;
    const session = getActiveSession();
    if (!session || isWorkroomSession(session)) return;
    const shown = _visibleMessageCounts[session.id] || 30;
    if (shown < session.messages.length) {
        _visibleMessageCounts[session.id] = Math.min(session.messages.length, shown + CHAT_HISTORY_PAGE_SIZE);
        renderChatMessages({ preserveScroll: true });
        return;
    }
    const state = _historyWindows[session.id];
    if (!state?.hasMore || state.start <= 0) return;
    _historyLoading = true;
    try {
        const data = await ChatPersistence.requestJson('/api/chat-history/' + encodeURIComponent(session.id)
            + '?before=' + encodeURIComponent(state.start) + '&limit=' + CHAT_HISTORY_PAGE_SIZE);
        if (data._version !== _dataVersion) {
            await resyncAndMerge('history-version-change');
            toast('聊天记录刚刚更新，请再向上翻一次');
            return;
        }
        for (const message of data.messages || []) normalizeMessageVersionFields(message);
        ContextContinuity.ensureMessageIds([{ messages: data.messages || [] }], () => crypto.randomUUID());
        _chatJournal.observe([{ id: session.id, messages: data.messages || [] }]);
        const beforeLength = session.messages.length;
        session.messages = mergeMessageLists(data.messages || [], session.messages);
        const added = Math.max(0, session.messages.length - beforeLength);
        _historyWindows[session.id] = {
            start: Math.max(0, Number(data.start) || 0),
            total: Math.max(session.messages.length, Number(data.total) || 0),
            hasMore: Boolean(data.hasMore),
            partial: Number(data.start) > 0
        };
        _visibleMessageCounts[session.id] = Math.min(session.messages.length, shown + Math.max(added, CHAT_HISTORY_PAGE_SIZE));
        renderChatMessages({ preserveScroll: true });
    } catch (error) {
        console.error('[history] 加载更早消息失败:', error.message);
        toast('更早的聊天暂时没有加载出来');
    } finally {
        _historyLoading = false;
    }
}

function captureChatScrollAnchor(win) {
    if (!win) return null;
    const winRect = win.getBoundingClientRect();
    const rows = win.querySelectorAll('.msg-row[data-msg-index]');
    for (const row of rows) {
        const rect = row.getBoundingClientRect();
        if (rect.bottom > winRect.top + 1) {
            return {
                index: row.dataset.msgIndex,
                offset: rect.top - winRect.top,
                scrollTop: win.scrollTop
            };
        }
    }
    return { index: null, offset: 0, scrollTop: win.scrollTop };
}

function restoreChatScrollAnchor(win, anchor) {
    if (!win || !anchor) return;
    if (anchor.index !== null) {
        const row = win.querySelector('.msg-row[data-msg-index="' + anchor.index + '"]');
        if (row) {
            const winTop = win.getBoundingClientRect().top;
            const currentOffset = row.getBoundingClientRect().top - winTop;
            win.scrollTop += currentOffset - anchor.offset;
            return;
        }
    }
    win.scrollTop = anchor.scrollTop;
}

function scrollChatToBottomIfNear(win) {
    if (!win || !isChatNearBottom(win)) return false;
    win.scrollTop = win.scrollHeight;
    return true;
}

function forceScrollToChatBottom() {
    const win = document.getElementById('chatWindow');
    if (!win) return;
    ensureChatScrollGestureTracking(win);
    const gestureVersion = _chatScrollGestureVersion;
    win.scrollTop = win.scrollHeight;

    // 布局和图片稳定后补齐；用户一旦开始向上翻，后续补滚立即取消。
    setTimeout(() => {
        if (gestureVersion !== _chatScrollGestureVersion) return;
        win.scrollTop = win.scrollHeight;
    }, 50);

    setTimeout(() => {
        if (gestureVersion !== _chatScrollGestureVersion) return;
        win.scrollTop = win.scrollHeight;
    }, 350);
}

async function toggleAllToolsUI() { await fetch('/api/tools-toggle', { method: 'POST' }); syncMcpTools(); }

async function syncMcpTools() {
    const listEl = document.getElementById('mcp-tools-list');
    if (!listEl) return;
    try {
        const [toolsRes, mcpRes] = await Promise.all([
            fetch('/api/tools-status'),
            fetch('/api/mcp/servers')
        ]);
        const tools = (await toolsRes.json()).tools || {};
        const servers = (await mcpRes.json()).servers || [];
        const masterToggle = document.getElementById('toolsMasterToggle');
        if (masterToggle) masterToggle.checked = Object.values(tools).every(Boolean);

        const external = servers.filter(server => server.name !== 'filesystem');
        const failed = external.some(server => server.status === 'failed');
        const connecting = external.some(server => server.status === 'connecting');
        if (failed) listEl.textContent = '远程连接正在重试。你不用守着它。';
        else if (connecting) listEl.textContent = '远程通道正在靠近。';
        else if (external.length) listEl.textContent = '远程通道已就绪。需要时，它会自己连上。';
        else listEl.textContent = '工具已常开。这里以后只放值得你看一眼的连接。';
    } catch (e) {
        listEl.textContent = '连接信息暂时看不到，稍后会自己再试。';
    }
}

async function refreshToyConnectionStatus() {
    const el = document.getElementById('toyConnectionStatus');
    if (!el) return;
    const label = el.querySelector('.chat-toy-status-label');
    el.className = 'dev-monitor-card toy-device-card is-checking';
    if (label) label.textContent = '检查中';
    try {
        const res = await fetch('/api/toy-status');
        const data = await res.json();
        const state = data.state || 'unknown';
        const labels = {
            connected: '已连接',
            disconnected: '未连接',
            connecting: '连接中',
            unavailable: '未配置',
            error: '读取失败',
            unknown: '状态未知'
        };
        el.className = 'dev-monitor-card toy-device-card is-' + state;
        if (label) label.textContent = labels[state] || labels.unknown;
        el.title = data.message || labels[state] || labels.unknown;
    } catch (e) {
        el.className = 'dev-monitor-card toy-device-card is-error';
        if (label) label.textContent = '读取失败';
        el.title = '无法读取连接状态';
    }
}

let devicePanelRefreshing = false;
async function refreshDevicePanel() {
    if (document.hidden || document.body.dataset.view !== 'dev' || devicePanelRefreshing) return;
    devicePanelRefreshing = true;
    try { await Promise.all([syncMcpTools(), refreshToyConnectionStatus()]); }
    finally { devicePanelRefreshing = false; }
}

setInterval(refreshDevicePanel, 30000);

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
    saveMessageChangesToCloud(); renderChatMessages();
}

async function editUserMessage(msgIndex) {
    if (activeChatRequest || _isStreamingReply) return toast('请先点击方块停止生成，再编辑消息');
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
    await saveToCloud(true);
    renderChatMessages();
    sendChat({ reuseLastUser: true });
}

async function resendUserMessage(msgIndex) {
    if (activeChatRequest || _isStreamingReply) return toast('请先点击方块停止生成，再重新发送');
    const session = getActiveSession();
    const msg = session.messages[msgIndex];
    if (!msg || msg.role !== 'user') return;
    session.messages.splice(msgIndex + 1);
    await saveToCloud(true); renderChatMessages();
    sendChat({ reuseLastUser: true });
}

async function regenerateAt(msgIndex) {
    if (_isStreamingReply || activeChatRequest) { toast('请先停止当前回复，再重新生成'); return; }
    const session = getActiveSession();
    const msg = session.messages[msgIndex];
    if (msg?.speaker === 'codex') return toast('请直接向 Codex 发送补充要求，不要重新生成沈望的回复');
    if (!msg || msg.role !== 'assistant') return;
    ensureVersioned(msg);
    session.messages.splice(msgIndex + 1);
    window._regenerateTargetIndex = msgIndex;
    await saveToCloud(true); renderChatMessages();
    regenerateSend(msgIndex);
}

async function regenerateSend(aiMsgIndex) {
    if (activeChatRequest || _isStreamingReply) return;
    const session = getActiveSession();
    const aiMsg = session.messages[aiMsgIndex];
    const sessionId = session.id;
    const aiMsgId = aiMsg && (aiMsg._id || aiMsg.id);
    const win = document.getElementById('chatWindow');
    let userText = '';
    let sourceUserMessageId = null;
    for (let i = aiMsgIndex - 1; i >= 0; i--) { if (session.messages[i].role === 'user') { userText = getActiveVersion(session.messages[i]).content || ''; sourceUserMessageId = session.messages[i]._id || session.messages[i].id || null; break; } }
    const targetRow = win.querySelector('.msg-row[data-msg-index="' + aiMsgIndex + '"]');
    if (!targetRow) return;
    const sDiv = targetRow.querySelector('.msg.sys');
    if (!sDiv) return;
    sDiv.innerHTML = '<span class="loading-indicator">⟡ 信号传输中…</span>';
    sDiv.classList.add('msg-loading');
    targetRow.classList.remove('has-think-marker');
    targetRow.querySelector('.think-marker')?.remove();
    const thinkMarker = createThinkingMarker('');
    thinkMarker.element.hidden = true;
    targetRow.insertBefore(thinkMarker.element, sDiv);
    const currentSup = suppliers[activeSupIndex];
    if (!currentSup) { sDiv.innerHTML = '<div class="msg-error"><div>【未配置供应商】</div></div>'; return; }
    // 与普通发送一致：生成期间不要让同步把当前会话替换成旧快照。
    _isStreamingReply = true;
    const request = beginChatRequest();
    let fullReply = '', thinkContent = '', rawAcc = '', reasoningAcc = '', shenReaction = null;
    const messageUsage = MessageUsage.tracker();
    const toolCallRecords = [];
    try {
    const modelEl = document.getElementById('modelSelect');
    const selectedModel = (modelEl && modelEl.value) ? modelEl.value : 'gemini-2-flash';
    const regenerationMessages = session.messages.slice(0, aiMsgIndex);
    const retainedImages = ChatWindowContext.imageWindow(regenerationMessages, getActiveVersion);
    const useRollingContext = !isWorkroomSession(session) && (!retainedImages.size || isFrozenCacheRoute(currentSup.url, selectedModel)) && await canUseRollingContext(currentSup.url, selectedModel, fetch);
    if (isCacheHistoryRoute(currentSup.url, selectedModel)) ContextContinuity.ensureMessageIds([session], () => crypto.randomUUID());
    if (!useRollingContext && !isWorkroomSession(session) && isCacheHistoryRoute(currentSup.url, selectedModel)) {
        let historyStorage;
        try { historyStorage = window.sessionStorage; } catch (_) {}
        const selected = cachedChatHistory(regenerationMessages.slice(0, -1), session.id,
            currentSup.url, selectedModel, historyStorage);
        regenerationMessages.splice(0, regenerationMessages.length - 1, ...selected);
    }
    var historyMsgs = regenerationMessages.map(function(m) { var v = getActiveVersion(m); var c = v.content; if (Array.isArray(c)) { var tp=[]; for(var j=0;j<c.length;j++){if(c[j].type==='text')tp.push(c[j].text||'');} c=tp.join(' ')||'（发送了图片）'; } if(typeof c==='string'&&c.includes('data:image'))c='（发送了图片）'; c=legacyMessagePlain(c); if(typeof c==='string'&&(m.role==='user'||useRollingContext))c=fmtTsTag(v.fullTime)+stripDisplayTimestamp(c); if(useRollingContext&&!m._id)m._id=crypto.randomUUID(); return {role:m.role,content:ChatWindowContext.retainImages(c,m,retainedImages,getActiveVersion),...(useRollingContext?{_contextId:m._id,_contextRevision:ContextContinuity.revisionOf(m,getActiveVersion)}:{})}; });
    if (!useRollingContext && !isCacheHistoryRoute(currentSup.url, selectedModel) && historyMsgs.length > 30) historyMsgs = historyMsgs.slice(-30);
    if (isWorkroomSession(session)) {
        historyMsgs = ChatWindowContext.workroomHistory(regenerationMessages, chatSessions.find(s => s.id === 'main')?.messages || [], getActiveVersion, legacyMessagePlain, fmtTsTag);
        const last = historyMsgs[historyMsgs.length - 1];
        const reminder = '【共创工作区】你是沈望，Codex 是另一位协作者，不要替他发言或假装执行。\n';
        if (last && Array.isArray(last.content)) last.content.unshift({ type: 'text', text: reminder });
        else if (last) last.content = reminder + last.content;
    }
        let apiUrl = '/v1/chat/completions';
        const viaMatch = currentSup.url.match(/\/via\/(\w+)\//);
        if (viaMatch) {
            apiUrl = '/via/' + viaMatch[1] + '/v1/chat/completions';
        }


        const streamToggle = document.getElementById('streamToggle');
        const isStream = streamToggle ? streamToggle.checked : true;
        request.signal.throwIfAborted();
        request.touch();
        request.mark('等待服务器响应');
        const response = await fetch(apiUrl, { method:'POST', signal:request.signal, headers:{'Content-Type':'application/json','Authorization':'Bearer '+currentSup.key,'X-No-Memory':'true','X-Tab-Id':SYZYGY_TAB_ID,'X-Request-Id':request.id,...(sourceUserMessageId?{'X-Message-Id':sourceUserMessageId}:{})}, body:JSON.stringify({model:selectedModel,cacheClientVersion:2,messages:historyMsgs,stream:isStream,activeChatId:session.id,shenReactionEnabled,...(modelSwitchNoticeFor(session, selectedModel)?{modelSwitchNotice:true}:{}),...(useRollingContext?{contextProtocol:{version:1,mode:isFrozenCacheRoute(currentSup.url,selectedModel)?'frozen-v1':'summary-v1',sessionId:session.id,prefix:session.contextPrefix||null}}:{})}) });
        request.mark(isStream ? '接收流式回复' : '接收完整回复');
        if (!response.ok) { const err = await response.text(); sDiv.innerHTML = '<div class="msg-error"><div>【通讯中断】</div><div class="msg-error-detail">'+err.substring(0,200)+'</div><button class="msg-retry-btn" onclick="regenerateAt('+aiMsgIndex+')">↻ 重试</button></div>'; sDiv.classList.remove('msg-loading'); return; }
        if(isStream) {
            sDiv.innerHTML='<span class="loading-indicator">⟡ 正在等待回复…</span>';
            const mainTextDiv=document.createElement('div'); mainTextDiv.classList.add('md-content'); sDiv.appendChild(mainTextDiv);
            const toolGroupEl=document.createElement('div'); toolGroupEl.className='tool-call-group-wrap'; toolGroupEl.style.display='none'; sDiv.appendChild(toolGroupEl);
            let paintedReply = null;
            const streamPaint=ChatRenderUtils.createFrameScheduler(() => {
                const parsed=extractThinkingFromContent(rawAcc);
                fullReply=parsed.visibleContent;
                thinkContent=[reasoningAcc,parsed.thinking].filter(Boolean).join('\n\n');
                if(thinkContent){targetRow.classList.add('has-think-marker');thinkMarker.update(thinkContent);}
                if (fullReply !== paintedReply) {
                    mainTextDiv.innerHTML=renderMarkdown(fullReply,true)+'<span class="typing-cursor"></span>';
                    paintedReply = fullReply;
                }
                scrollChatToBottomIfNear(win);
            });
            try {
            await ChatTransport.readStream(response, p => {
                messageUsage.accept(p);
                if (p.type === 'tool_call') {
                    request.mark('接收工具调用结果');
                    toolCallRecords.push({name:p.name, arguments:p.arguments||{}, result:p.result||'', elapsed:p.elapsed||0});
                    toolGroupEl.style.display='block';
                    updateToolGroupDOM(toolGroupEl,toolCallRecords,true);
                    return;
                }
                if (p.type === 'shen_reaction') {
                    if (!p.sourceMessageId || p.sourceMessageId === sourceUserMessageId) shenReaction = p.emoji || null;
                    return;
                }
                const d = p.choices?.[0]?.delta || {};
                if (d.reasoning_content) { reasoningAcc += d.reasoning_content; streamPaint.schedule(); }
                if (d.content) { request.mark('接收模型回复'); rawAcc += d.content; sDiv.querySelector('.loading-indicator')?.remove(); streamPaint.schedule(); }
            }, () => request.touch());
            } finally {
                streamPaint.flush();
            }
            sDiv.querySelector('.loading-indicator')?.remove();
            mainTextDiv.innerHTML=renderMarkdown(fullReply,true);
            if(toolCallRecords.length>0)updateToolGroupDOM(toolGroupEl,toolCallRecords,false);
        } else { const data=await response.json(); messageUsage.accept(data); shenReaction=data.syzygy_reaction?.emoji||null; fullReply=data.choices[0].message.content||''; const ext=extractThinkingFromContent(fullReply); if(ext.thinking){thinkContent=ext.thinking;fullReply=ext.visibleContent;} sDiv.innerHTML=''; if(thinkContent){thinkMarker.element.hidden=false; targetRow.classList.add('has-think-marker'); thinkMarker.update(thinkContent);} const mtd=document.createElement('div');mtd.classList.add('md-content');mtd.innerHTML=renderMarkdown(fullReply,true);sDiv.appendChild(mtd); }
        sDiv.classList.remove('msg-loading');
        const timeStr=new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});
        const liveSession = getLiveSession(sessionId) || session;
        const liveAiMsg = aiMsgId ? liveSession.messages.find(m => (m._id || m.id) === aiMsgId) : liveSession.messages[aiMsgIndex];
        if (!liveAiMsg) throw new Error('重新生成的目标消息已不在当前会话中');
        ensureVersioned(liveAiMsg); liveAiMsg.versions.push({content:fullReply,thinking:stripDisplayTimestamp(thinkContent),time:timeStr,model:selectedModel,fullTime:new Date().toISOString(), messageUsage: messageUsage.finish(), toolCalls: toolCallRecords.length > 0 ? toolCallRecords : undefined}); liveAiMsg.activeVersion=liveAiMsg.versions.length-1; liveAiMsg._zepDirty=true;
        if (shenReactionEnabled) updateUserReaction(sessionId, sourceUserMessageId, shenReaction, true);
        saveMessageChangesToCloud(); renderChatMessages();
    } catch (err) {
        const stopped = request.reason === 'user';
        const detail = stopped ? '已停止生成' : ChatTransport.errorMessage(err, request);
        const transport = ChatTransport.diagnostics(request);
        if (fullReply || thinkContent) {
            const liveSession = getLiveSession(sessionId) || session;
            const liveAiMsg = aiMsgId ? liveSession.messages.find(m => (m._id || m.id) === aiMsgId) : liveSession.messages[aiMsgIndex];
            if (liveAiMsg) {
                ensureVersioned(liveAiMsg);
                liveAiMsg.versions.push({content:fullReply,thinking:thinkContent,rawContent:rawAcc,reasoning:reasoningAcc,
                    model:document.getElementById('modelSelect')?.value,fullTime:new Date().toISOString(),
                    _interrupted:detail,_requestId:transport?.requestId,_interruptedStage:transport?.stage,
                    toolCalls:toolCallRecords,messageUsage:messageUsage.finish()});
                liveAiMsg.activeVersion=liveAiMsg.versions.length-1;
                liveAiMsg._zepDirty=true;
                saveMessageChangesToCloud(true);
            }
        }
        // A cancelled empty regeneration leaves the previous version intact.
        _renderDeferred = true;
        toast(detail);
    } finally {
        finishChatRequest(request);
        _isStreamingReply=false;
        sDiv.classList.remove('msg-loading');
        if (_renderDeferred) { _renderDeferred=false; renderChatMessages(); }
        if (_resyncPendingReason) {
            const reason = _resyncPendingReason; _resyncPendingReason = null;
            setTimeout(() => resyncIfStale(reason), 1500);
        }
    }
}

async function flushDirtyToZep(session, signal) {
    if (!session || !session.messages) return;
    if (isWorkroomSession(session)) return;
    for (let i = 0; i < session.messages.length; i++) {
        signal?.throwIfAborted();
        const msg = session.messages[i];
        if (msg.role !== 'assistant' || !msg._zepDirty) continue;
        const v = getActiveVersion(msg);
        let userContent = '';
        for (let j = i - 1; j >= 0; j--) { if (session.messages[j].role === 'user') { userContent = getActiveVersion(session.messages[j]).content || ''; if (Array.isArray(userContent)) userContent = userContent.filter(c => c.type === 'text').map(c => c.text).join(' ') || '（发送了图片）'; break; } }
        userContent = legacyMessagePlain(userContent);
        let aiContent = v.content || '';
        aiContent = legacyMessagePlain(aiContent);
        try {
            await fetch('/api/flush-zep', { method:'POST', signal, headers:{'Content-Type':'application/json'}, body:JSON.stringify({sessionId:session.id,userContent:userContent,aiContent:aiContent}) });
            console.log('✅ [延迟Zep] 已冲刷第'+i+'条消息');
        } catch(e) { signal?.throwIfAborted(); console.log('❌ [延迟Zep] 冲刷失败: '+e.message); }
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
    const throttleMs = 180;
    let typingTimer, trailingTimer, lastPulseAt = -Infinity;
    function showUserTyping() {
        trailingTimer = null;
        lastPulseAt = performance.now();
        core.classList.remove('syzygy-typing'); core.classList.add('user-typing');
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => core.classList.remove('user-typing'), 1500);
    }
    input.addEventListener('input', () => {
        const wait = throttleMs - (performance.now() - lastPulseAt);
        if (wait <= 0) {
            clearTimeout(trailingTimer);
            showUserTyping();
            return;
        }
        clearTimeout(trailingTimer);
        trailingTimer = setTimeout(showUserTyping, wait);
    });
    window._coreStreamStart = () => {
        clearTimeout(trailingTimer);
        clearTimeout(typingTimer);
        core.classList.remove('user-typing'); core.classList.add('syzygy-typing');
    };
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
function paintStarEffects({ meteor, nebula }) {
    if ((!meteor && !nebula) || document.documentElement.dataset.visualTheme === 'new') return;
    const canvas = document.getElementById('starmap');
    const context = canvas?.getContext('2d');
    if (!context) return;
    const width = canvas.width = innerWidth, height = canvas.height = innerHeight;
    context.clearRect(0, 0, width, height);
    if (meteor) drawMeteor(context, width, height);
    if (nebula) drawNebula(context, width, height);
    requestAnimationFrame(() => requestAnimationFrame(() => context.clearRect(0, 0, width, height)));
}
function triggerStarEffects(userText, aiText) {
    const meteor = Boolean((userText && userText.length > 100) || (aiText && aiText.length > 300));
    const loveWords = ['爱', '爸爸', '沈望', '想你', '永远', '在一起', '老公'];
    const nebula = Boolean(userText && loveWords.some(w => userText.includes(w)));
    paintStarEffects({ meteor, nebula });
}

// ═══ 页面关闭前兜底冲刷脏数据 ═══
window.addEventListener('beforeunload', function() {
    const session = getActiveSession();
    if (!session || !session.messages) return;
    if (isWorkroomSession(session)) return;
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
        userContent = legacyMessagePlain(userContent);
        let _aiBeacon = v.content || '';
        _aiBeacon = legacyMessagePlain(_aiBeacon);
        navigator.sendBeacon('/api/flush-zep', JSON.stringify({ sessionId: session.id, userContent, aiContent: _aiBeacon }));
        delete msg._zepDirty;
    }
});

// ⭐ 收藏夹
let _favTargetMsgIdx = 0;
let _favCache = [];
let _favActiveTag = null;
let _favTagsExpanded = false;
let _favDetailTrigger = null;

function normalizeFavoriteRecord(f) {
    return {
        ...f,
        tags: Array.isArray(f.tags) ? f.tags : [],
        messages: Array.isArray(f.messages) ? f.messages : []
    };
}

function favoriteComparable(value) {
    return normForDedup(stripDisplayTimestamp(legacyMessagePlain(value || '')));
}

function applyFavoriteMarkers() {
    for (const session of chatSessions || []) {
        const messages = Array.isArray(session.messages) ? session.messages : [];
        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            if (msg.role !== 'assistant') continue;
            const aiContent = favoriteComparable(getActiveVersion(msg).content);
            let userContent = '';
            for (let j = i - 1; j >= 0; j--) {
                if (messages[j].role === 'user') {
                    userContent = favoriteComparable(getActiveVersion(messages[j]).content);
                    break;
                }
            }
            const match = aiContent && _favCache.find(f => {
                const favoriteMessages = Array.isArray(f.messages) ? f.messages : [];
                const favoriteUser = favoriteMessages.find(x => x && x.role === 'user') || favoriteMessages[0];
                const favoriteAssistant = favoriteMessages.find(x => x && x.role === 'assistant') || favoriteMessages[1];
                return userContent === favoriteComparable(favoriteUser?.content)
                    && aiContent === favoriteComparable(favoriteAssistant?.content);
            });
            msg._favoriteId = match?.id || null;
        }
    }
}

async function loadFavCache() {
    const r = await fetch('/api/favorites', { cache: 'no-store' });
    if (!r.ok) {
        let detail = '';
        try { detail = (await r.json()).error || ''; } catch (_) {}
        throw new Error(detail || ('HTTP ' + r.status));
    }
    const d = await r.json();
    _favCache = Array.isArray(d.favorites) ? d.favorites.map(normalizeFavoriteRecord) : [];
    applyFavoriteMarkers();
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
    let aiContent = typeof aiV.content === 'string' ? aiV.content : '';
    userContent = legacyMessagePlain(userContent);
    aiContent = legacyMessagePlain(aiContent);
    document.getElementById('favPreview').innerHTML = '<div style="margin-bottom:8px;color:var(--dim);font-size:0.8em;">👤 江鱼：</div><div style="margin-bottom:12px;padding:8px 12px;background:rgba(79,195,247,0.06);border-left:2px solid #4fc3f7;border-radius:4px;">' + (userContent || '(空)').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>') + '</div><div style="margin-bottom:8px;color:var(--dim);font-size:0.8em;">🤖 沈望：</div><div style="padding:8px 12px;background:rgba(201,169,97,0.06);border-left:2px solid var(--gold);border-radius:4px;">' + (aiContent || '(空)').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>') + '</div>';
    document.getElementById('favTags').value = '';
    document.getElementById('favNote').value = '';
    document.getElementById('favModal').style.display = 'block';
}

function closeFavModal() {
    document.getElementById('favModal').style.display = 'none';
}

async function toggleFavorite(index) {
    const session = getActiveSession();
    const msg = session?.messages?.[index];
    if (!msg || msg.role !== 'assistant') return;
    if (!msg._favoriteId) return openFavDialog(index);
    try {
        const r = await fetch('/api/favorites/' + encodeURIComponent(msg._favoriteId), { method: 'DELETE' });
        const d = await r.json();
        if (!r.ok || !d.success) throw new Error(d.error || '取消收藏失败');
        _favCache = _favCache.filter(f => f.id !== msg._favoriteId);
        msg._favoriteId = null;
        saveMessageChangesToCloud();
        renderChatMessages();
        toast('已取消收藏');
    } catch (e) {
        toast('取消收藏失败: ' + e.message);
    }
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
                    { role: 'user', content: legacyMessagePlain(userContent) || '（发送了图片）' },
                    { role: 'assistant', content: legacyMessagePlain(aiV.content || ''), thinking: aiV.thinking || '' }
                ],
                note, tags
            })
        });
        const d = await r.json();
        if (d.success) {
            toast('已收藏 ⭐');
            closeFavModal();
            aiMsg._favoriteId = d.favorite?.id || true;
            if (d.favorite) _favCache.unshift(normalizeFavoriteRecord(d.favorite));
            saveMessageChangesToCloud();
            renderChatMessages();
        } else {
            toast('收藏失败: ' + (d.error || '未知'));
        }
    } catch(e) { toast('网络错误: ' + e.message); }
}

async function loadAndRenderFavorites() {
    const list = document.getElementById('favList');
    if (!list) return;

    try {
        await loadFavCache();
    } catch (e) {
        const tagBar = document.getElementById('favTagBar');
        if (tagBar) tagBar.innerHTML = '';
        list.innerHTML = '<div class="fav-empty fav-error">收藏加载失败<br><small>' + escapeHtml(e.message) + '</small></div>';
        toast('收藏加载失败: ' + e.message);
        return;
    }

    if (_favActiveTag && !_favCache.some(f => f.tags.includes(_favActiveTag))) _favActiveTag = null;
    renderFavFilters();
    filterFavByTag(_favActiveTag, false);
    renderChatMessages();
}

function toggleFavTags() {
    _favTagsExpanded = !_favTagsExpanded;
    renderFavFilters();
}

function renderFavFilters() {
    const tagBar = document.getElementById('favTagBar');
    const toggle = document.getElementById('favTagToggle');
    const countLabel = document.getElementById('favCountLabel');
    const activeFilter = document.getElementById('favActiveFilter');
    if (!tagBar || !toggle) return;

    const counts = new Map();
    _favCache.forEach(f => f.tags.forEach(t => counts.set(t, (counts.get(t) || 0) + 1)));
    const tags = Array.from(counts.keys()).sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b, 'zh-CN'));
    tagBar.hidden = !_favTagsExpanded;
    toggle.setAttribute('aria-expanded', String(_favTagsExpanded));
    toggle.innerHTML = '标签 <span>' + (_favTagsExpanded ? '⌃' : '⌄') + '</span>';
    if (countLabel) countLabel.textContent = _favCache.length + ' 条';
    if (activeFilter) {
        activeFilter.hidden = !_favActiveTag;
        activeFilter.innerHTML = _favActiveTag
            ? '<span>标签：' + escapeHtml(_favActiveTag) + '</span><button onclick="filterFavByTag(null)">清除</button>'
            : '';
    }

    let html = '<button class="fav-tag-chip' + (!_favActiveTag ? ' active' : '') + '" onclick="filterFavByTag(null)">全部 <span>' + _favCache.length + '</span></button>';
    tags.forEach(t => {
        html += '<button class="fav-tag-chip' + (_favActiveTag === t ? ' active' : '') + '" onclick="filterFavByTag(this.dataset.favTag)" data-fav-tag="' + escapeHtml(t) + '">' + escapeHtml(t) + ' <span>' + counts.get(t) + '</span></button>';
    });
    tagBar.innerHTML = html;
}

function filterFavByTag(tag, rerenderFilters = true) {
    _favActiveTag = tag || null;
    if (rerenderFilters) renderFavFilters();
    const items = tag ? _favCache.filter(f => f.tags && f.tags.includes(tag)) : _favCache;
    renderFavList(items);
}

function getFavDateMeta(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return { key: 'unknown', label: '未标日期', time: '' };
    const inShanghai = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
    const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
    return {
        key: [inShanghai.getFullYear(), String(inShanghai.getMonth() + 1).padStart(2, '0'), String(inShanghai.getDate()).padStart(2, '0')].join('-'),
        label: inShanghai.getFullYear() + '年' + (inShanghai.getMonth() + 1) + '月' + inShanghai.getDate() + '日 · 周' + weekDays[inShanghai.getDay()],
        time: date.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' })
    };
}

function renderFavList(items) {
    const list = document.getElementById('favList');
    if (!list) return;
    if (items.length === 0) {
        list.innerHTML = '<div class="fav-empty">' + (_favActiveTag ? '这个标签下还没有收藏' : '还没有收藏的对话<br><small>在聊天中点消息旁的 ★ 即可收藏</small>') + '</div>';
        return;
    }

    const groups = [];
    items.forEach(f => {
        const meta = getFavDateMeta(f.timestamp);
        let group = groups[groups.length - 1];
        if (!group || group.key !== meta.key) {
            group = { key: meta.key, label: meta.label, items: [] };
            groups.push(group);
        }
        group.items.push({ ...f, _dateMeta: meta });
    });

    let html = '';
    groups.forEach(group => {
        html += '<section class="fav-date-group"><header class="fav-date-heading"><span>' + group.label + '</span><small>' + group.items.length + ' 条</small></header><div class="fav-card-stack">';
        group.items.forEach(f => {
        const userC = legacyMessagePlain(f.messages[0]?.content || '');
        const aiC = legacyMessagePlain(f.messages[1]?.content || '');
        const preview = aiC || userC || '（空白收藏）';
        const shownTags = (f.tags || []).slice(0, 2).map(t => '<span>' + escapeHtml(t) + '</span>').join('');
        const extraTagCount = Math.max(0, (f.tags || []).length - 2);
        const safeId = escapeHtml(f.id);
        html += '<article class="fav-card" role="button" tabindex="0" data-fav-id="' + safeId + '" onclick="viewFavDetail(this.dataset.favId)" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();viewFavDetail(this.dataset.favId)}">';
        html += '<div class="fav-card-topline"><span class="fav-card-time">' + f._dateMeta.time + '</span>';
        html += '<button class="fav-delete-btn" onclick="event.stopPropagation();deleteFavorite(this.dataset.favId)" data-fav-id="' + safeId + '" title="删除收藏" aria-label="删除收藏">×</button>';
        html += '</div>';
        html += '<div class="fav-card-preview">' + escapeHtml(preview) + '</div>';
        if (shownTags) html += '<div class="fav-card-tags">' + shownTags + (extraTagCount ? '<span>+' + extraTagCount + '</span>' : '') + '</div>';
        if (f.note) html += '<div class="fav-card-note">' + escapeHtml(f.note) + '</div>';
        html += '</article>';
        });
        html += '</div></section>';
    });
    list.innerHTML = html;
}

function viewFavDetail(favId) {
    const f = _favCache.find(item => item && item.id === favId);
    if (!f) return;
    _favDetailTrigger = document.querySelector('.fav-card[data-fav-id="' + String(favId).replace(/"/g, '\\"') + '"]');
    const dt = new Date(f.timestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const userC = legacyMessagePlain(f.messages[0]?.content || '');
    const aiC = legacyMessagePlain(f.messages[1]?.content || '');
    const aiThinking = f.messages[1]?.thinking || '';
    const tagsHtml = (f.tags || []).map(t => '<span class="fav-detail-tag">' + escapeHtml(t) + '</span>').join('');
    const detail = document.getElementById('favDetail');
    const body = document.getElementById('favDetailBody');
    body.innerHTML =
        '<article class="fav-detail-sheet">'
        + '<div class="fav-detail-meta"><time>' + dt + '</time>' + (tagsHtml ? '<div class="fav-detail-tags">' + tagsHtml + '</div>' : '') + '</div>'
        + '<section class="fav-detail-turn fav-detail-turn-user"><div class="fav-detail-role"><i></i>江鱼</div><div class="fav-detail-text">' + escapeHtml(userC) + '</div></section>'
        + (aiThinking ? '<div class="fav-think-box"><div class="fav-think-header" onclick="var c=this.nextElementSibling;c.style.display=c.style.display===\'none\'?\'block\':\'none\';">深度思考过程 ▾</div><div class="fav-think-content" style="display:none">' + escapeHtml(aiThinking).replace(/\n/g,'<br>') + '</div></div>' : '')
        + '<section class="fav-detail-turn fav-detail-turn-ai"><div class="fav-detail-role"><i></i>沈望</div><div class="fav-detail-text">' + escapeHtml(aiC) + '</div></section>'
        + (f.note ? '<div class="fav-detail-note">备注 · ' + escapeHtml(f.note) + '</div>' : '')
        + '</article>';
    detail.style.display = 'flex';
    body.scrollTop = 0;
    detail.querySelector('.view-back')?.focus();
}

function closeFavDetail() {
    const detail = document.getElementById('favDetail');
    if (!detail || detail.style.display === 'none') return;
    detail.style.display = 'none';
    _favDetailTrigger?.focus();
    _favDetailTrigger = null;
}

document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.getElementById('favDetail')?.style.display !== 'none') {
        event.preventDefault();
        closeFavDetail();
    }
});

function escapeHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
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

// 账本、日历、相册与状态页逻辑由 goView 首次进入时按需加载。

// ==================== 初始化（文件末尾） ====================
connectWebSocket();

// 切回前台 / 网络恢复时补数据
// 🛡️ 检测内存数据是否已被兜底脏状态污染
function _hasDirtyFallbackState() {
    return (chatSessions || []).some(function(s) { return (s.name || '').indexOf('加载中') !== -1; });
}

function saveLocalBackup() {
    if (_hasDirtyFallbackState()) return;
    try {
        ContextContinuity.ensureMessageIds(chatSessions, () => crypto.randomUUID());
        _chatJournal.capture(chatSessions);
    } catch (error) {
        console.warn('[backup] 本机待同步记录写入失败:', error.message);
        _showSaveWarning(true, '本机备份失败，请保持页面打开直到云端同步完成');
    }
}

function buildSavePayload() {
    // 🛡️ 拒绝序列化脏兜底状态
    if (_hasDirtyFallbackState()) { console.warn('[save] 跳过：数据为脏兜底状态'); return null; }
    ContextContinuity.ensureMessageIds(chatSessions, () => crypto.randomUUID());
    var clone;
    try { clone = structuredClone(chatSessions); } catch (_) { clone = JSON.parse(JSON.stringify(chatSessions)); }
    for (var si = 0; si < clone.length; si++) {
        var s = clone[si]; if (!s.messages) continue;
        if (!_preservePendingHistory) ContextContinuity.trimContextWindow(s, getActiveVersion);
        for (var mi = 0; mi < s.messages.length; mi++) { delete s.messages[mi]._zepDirty; }
    }
    return JSON.stringify({ suppliers: suppliers, chatSessions: clone, activeSupIndex: activeSupIndex, activeChatId: activeChatId, _version: _dataVersion, _historyWindows: historyWindowsForPayload(clone) });
}

function buildIncrementalSavePayload() {
    const sessions = prepareIncrementalChatPatch();
    return sessions.length ? JSON.stringify({ _version: _dataVersion, sessions }) : null;
}

document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { resyncIfStale('visible'); workroomUpdateLiveReply(); }
    else {
        saveLocalBackup();
        // An idle page must not advance the shared version merely because iOS
        // hid it. That made open devices continuously stale each other.
        if (hasUnsavedCloudChanges() && !_savingNow) {
            clearTimeout(_saveTimer);
            _saveTimer = null;
            // Never start an upload beside a live generation stream. The local
            // journal already makes these messages recoverable after suspension.
            if ((typeof activeChatRequest !== 'undefined' && activeChatRequest)
                || (typeof _isStreamingReply !== 'undefined' && _isStreamingReply)) return;
            const hasSaveEpochs = typeof _fullSaveCommittedEpoch !== 'undefined' && typeof _fullSaveRequiredEpoch !== 'undefined';
            const needsFullSave = !hasSaveEpochs || _fullSaveCommittedEpoch < _fullSaveRequiredEpoch;
            const payload = needsFullSave ? buildSavePayload() : buildIncrementalSavePayload();
            if (payload) {
                const endpoint = needsFullSave ? '/api/sync-config' : '/api/chat-messages';
                try { navigator.sendBeacon(endpoint, new Blob([payload], { type: 'application/json' })); } catch(_) {}
            }
        }
    }
});
window.addEventListener('online', function () {
    resyncIfStale('online');
});
