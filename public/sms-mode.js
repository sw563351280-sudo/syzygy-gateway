/* ══════════════════════════════════════════
   短对话模式 · SMS mode
   ══════════════════════════════════════════ */

/* ── 适配器：全部接线到 script.js 实函数 ── */
const SMS_ADAPTER = {
  getMessages: () => {
    const s = (typeof getActiveSession === 'function') ? getActiveSession() : null;
    return s ? s.messages : [];
  },
  persist: () => {
    if (typeof saveToCloud === 'function') saveToCloud(true);
  },
  requestOnce: async (extraSystem) => {
    const currentSup = (typeof suppliers !== 'undefined' && suppliers[activeSupIndex]) || null;
    if (!currentSup) throw new Error('未配置供应商');

    const session = (typeof getActiveSession === 'function') ? getActiveSession() : null;
    if (!session) throw new Error('无活跃会话');

    // 组装历史（复用 sendChat 逻辑：最近 30 条，不含最后一条）
    const getActiveVersion = (typeof window.getActiveVersion === 'function')
      ? window.getActiveVersion
      : (m) => (m.versions && m.versions.length > 0 ? m.versions[m.activeVersion || 0] || m.versions[0] : m);

    const historyMsgs = session.messages.slice(-31, -1).map(function(m) {
      const v = getActiveVersion(m);
      let safeContent = v.content;
      if (Array.isArray(v.content)) {
        const textParts = [];
        for (let j = 0; j < v.content.length; j++) {
          if (v.content[j].type === 'text') textParts.push(v.content[j].text || '');
        }
        safeContent = textParts.join(' ') || '（发送了图片）';
      }
      if (typeof safeContent === 'string' && safeContent.includes('data:image')) {
        safeContent = '（发送了图片）';
      }
      return { role: m.role, content: safeContent };
    });

    // SMS system prompt 作为首条 system 消息（仅本次请求，不落盘）
    const messages = [{ role: 'system', content: extraSystem }, ...historyMsgs];

    let apiUrl = '/v1/chat/completions';
    const viaMatch = currentSup.url && currentSup.url.match(/\/via\/(\w+)\//);
    if (viaMatch) apiUrl = '/via/' + viaMatch[1] + '/v1/chat/completions';

    const modelEl = document.getElementById('modelSelect');
    const selectedModel = (modelEl && modelEl.value) ? modelEl.value : '[按量]gemini-3-flash-preview';

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    let response;
    try {
      response = await fetch(apiUrl, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + currentSup.key,
          'X-Tab-Id': (typeof SYZYGY_TAB_ID !== 'undefined') ? SYZYGY_TAB_ID : ''
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: messages,
          stream: false,
          useCrossplatform: localStorage.getItem('syzygy_crossplatform') !== 'false'
        })
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error('HTTP ' + response.status + ': ' + errText.slice(0, 100));
    }

    const data = await response.json();
    const content = data.choices && data.choices[0] && data.choices[0].message
      ? (data.choices[0].message.content || '')
      : '';
    const reasoning = data.choices && data.choices[0] && data.choices[0].message
      ? (data.choices[0].message.reasoning_content || '')
      : '';

    return { content, reasoning };
  },
  buildThinkBox: (reasoning) => {
    if (!reasoning) return null;
    const box = document.createElement('div');
    box.className = 'think-box';
    box.innerHTML =
      '<div class="think-header" onclick="var c=this.nextElementSibling;c.style.display=c.style.display===\'none\'?\'block\':\'none\';">🧠 深度思考过程 ▾</div>' +
      '<div class="think-content" style="display:none">' + String(reasoning).replace(/\n/g, '<br>') + '</div>';
    return box;
  },
};

/* ── 提示音（WebAudio 正弦波，无需音频文件） ── */
const SMS_SOUND = {
  ctx: null,
  on: localStorage.getItem('sms_sound') !== 'off',
  prime() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!this.ctx) this.ctx = new AC();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },
  blip(kind) {
    if (!this.on || !this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(kind === 'out' ? 520 : 680, t);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.05, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc.connect(gain); gain.connect(this.ctx.destination);
    osc.start(t); osc.stop(t + 0.18);
  },
};

const SMS = {
  on: false,
  queue: [],
  segTimes: [],    // epoch ms，与 queue 下标平行
  lastSegMs: 0,    // 上一条碎条的时间，供分隔线判断
  playing: false,
  skip: false,
  MAX_SEG: 12,
  CHAR_MS: 68,
};

const smsUid = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'sms-' + Date.now() + '-' + Math.random().toString(36).slice(2));

/* ── 相对时间 ── */
function smsRelTime(ms) {
  const diff = Date.now() - ms;
  if (diff < 60000) return '刚刚';
  const min = Math.floor(diff / 60000);
  if (min < 60) return min + '分钟前';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + '小时前';
  return new Date(ms).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

/* ── 时间分隔线 ── */
function smsMaybeDivider(prevMs, curMs, gapMin) {
  if (!prevMs || curMs - prevMs < (gapMin || 3) * 60000) return null;
  const el = document.createElement('div');
  el.className = 'sms-time-divider';
  el.textContent = new Date(curMs)
    .toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  return el;
}

/* ── 模式切换 ── */
function smsToggleMode() {
  if (SMS.playing) return;
  SMS.on = !SMS.on;

  const btn   = document.getElementById('smsModeBtn');
  const send  = document.getElementById('chatSendBtn');
  const fire  = document.getElementById('smsFireBtn');
  const input = document.getElementById('chatInput');

  if (btn) {
    btn.textContent = SMS.on ? '长' : '短';
    btn.setAttribute('aria-pressed', String(SMS.on));
    btn.classList.toggle('sms-active', SMS.on);
  }
  document.body.classList.toggle('sms-mode', SMS.on);

  // 短模式：隐掉「入队」按钮（Enter 就是同一件事），让输入框喘口气
  if (send) {
    send.textContent = SMS.on ? '入队 +' : '发送 ✦';
    send.style.display = SMS.on ? 'none' : '';
  }
  if (fire) fire.style.display = SMS.on ? '' : 'none';
  if (input) input.placeholder = SMS.on ? '一条一条发…' : '发消息给沈望...';

  // prime AudioContext（必须在用户手势里）
  if (SMS.on) SMS_SOUND.prime();

  smsRenderQueueCount();
  if (typeof showToast === 'function') showToast(SMS.on ? '短对话模式' : '长对话模式');
}

/* ── 入队 ── */
function smsEnqueue(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  SMS.queue.push(t);
  SMS.segTimes.push(Date.now());
  smsAppendBubble(t, 'user', { pending: true });
  smsRenderQueueCount();
  return true;
}

function smsRenderQueueCount() {
  const el = document.getElementById('smsQueueCount');
  if (el) el.textContent = String(SMS.queue.length);
  const fire = document.getElementById('smsFireBtn');
  if (fire) fire.disabled = SMS.queue.length === 0 || SMS.playing;
}

/* ── 触发回复 ── */
async function smsFire() {
  if (!SMS.on || SMS.playing || !SMS.queue.length) return;

  SMS_SOUND.prime();

  const segments = SMS.queue.slice();
  const segTimes = SMS.segTimes.slice();
  SMS.queue = [];
  SMS.segTimes = [];
  smsRenderQueueCount();

  // 把待发气泡标记为已发
  document.querySelectorAll('#chatWindow .sms-pending')
    .forEach(el => el.classList.remove('sms-pending'));

  // 用户侧：一条消息，多个碎条（扁平格式，兼容 getActiveVersion 回退）
  const userMsg = {
    _id: smsUid(),
    role: 'user',
    mode: 'sms',
    segments,
    segTimes,
    content: segments.join('\n'),
    fullTime: new Date().toISOString(),
  };
  SMS_ADAPTER.getMessages().push(userMsg);
  SMS_ADAPTER.persist();

  SMS.playing = true;
  SMS.lastSegMs = segTimes.length ? segTimes[segTimes.length - 1] : Date.now();
  smsRenderQueueCount();

  // 占住流式锁：防止 visibilitychange / WS 重连触发 renderChatMessages 清屏
  _isStreamingReply = true;
  if (window._coreStreamStart) window._coreStreamStart();
  smsShowTyping();

  let raw = '', reasoning = '';
  try {
    const res = await SMS_ADAPTER.requestOnce(SMS_PROMPT);
    raw = res.content ?? res ?? '';
    reasoning = res.reasoning ?? '';
  } catch (err) {
    smsHideTyping();
    smsCleanupStreamLock();
    smsShowError(err, () => { SMS.queue = segments.concat(SMS.queue); SMS.segTimes = segTimes.concat(SMS.segTimes); smsRenderQueueCount(); smsFire(); });
    return;
  }

  const parts = smsSplit(raw);
  const asstMsg = {
    _id: smsUid(),
    role: 'assistant',
    mode: 'sms',
    segments: parts,
    content: parts.join('\n'),
    reasoning: reasoning || undefined,
    fullTime: new Date().toISOString(),
  };
  SMS_ADAPTER.getMessages().push(asstMsg);
  SMS_ADAPTER.persist();

  await smsPlay(parts, reasoning);
  smsCleanupStreamLock();
}

/* 放掉流式锁，触发延迟的 render + resync */
function smsCleanupStreamLock() {
  SMS.playing = false;
  SMS.skip = false;
  smsRenderQueueCount();
  _isStreamingReply = false;
  if (window._coreStreamEnd) window._coreStreamEnd();
  if (typeof _renderDeferred !== 'undefined' && _renderDeferred) {
    _renderDeferred = false;
    if (typeof renderChatMessages === 'function') renderChatMessages();
  }
  if (typeof _resyncPendingReason !== 'undefined' && _resyncPendingReason) {
    const pr = _resyncPendingReason;
    _resyncPendingReason = null;
    setTimeout(() => { if (typeof resyncAndMerge === 'function') resyncAndMerge(pr); }, 1500);
  }
}

/* ── 切分：分隔符优先，退化到标点 ── */
function smsSplit(raw) {
  let t = String(raw || '').trim();
  t = t.replace(/^```[a-z]*\s*/i, '').replace(/```$/, '').trim();

  let parts;
  if (t.includes('|||')) {
    parts = t.split('|||');
  } else if (/\n/.test(t)) {
    parts = t.split(/\n+/);
  } else {
    // 无 lookbehind，兼容旧 Safari
    parts = t.match(/[^。！？…～~]+[。！？…～~]*/g) || [t];
  }

  parts = parts
    .map(s => s.replace(/^\s*\d+[.、)]\s*/, '').trim())
    .filter(Boolean);

  // 兜底：超长的按标点二次拆
  parts = smsResplitLong(parts, 18);

  if (parts.length > SMS.MAX_SEG) {
    const head = parts.slice(0, SMS.MAX_SEG - 1);
    head.push(parts.slice(SMS.MAX_SEG - 1).join(' '));
    parts = head;
  }
  return parts.length ? parts : [t || '…'];
}

/* ── 兜底切分：超过 maxChars 的按逗号/句号/分号拆开 ── */
function smsResplitLong(parts, maxChars) {
  const cap = maxChars || 18;
  const out = [];
  for (const p of parts) {
    if (Array.from(p).length <= cap) { out.push(p); continue; }
    const pieces = p.match(/[^，,。！？…；;～~]+[，,。！？…；;～~]*/g) || [p];
    let buf = '';
    for (const piece of pieces) {
      if (buf && Array.from(buf + piece).length > cap) { out.push(buf.trim()); buf = piece; }
      else buf += piece;
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out.filter(Boolean);
}

/* ── 依次弹出 ── */
const smsWait = ms => new Promise(r => setTimeout(r, ms));

function smsDelay(text, i) {
  if (i === 0) return 300;
  const n = Array.from(text).length;
  return Math.max(420, Math.min(1800, 260 + n * SMS.CHAR_MS));
}

async function smsPlay(parts, reasoning) {
  SMS.playing = true;
  SMS.skip = false;

  const now = Date.now();

  for (let i = 0; i < parts.length; i++) {
    if (!SMS.skip) {
      smsShowTyping();
      await smsWait(smsDelay(parts[i], i));
    }
    smsHideTyping();
    smsAppendBubble(parts[i], 'sys', {
      think: i === 0 ? reasoning : null,
      meta:  i === parts.length - 1,
      ts:    now,
    });
  }

  SMS.lastSegMs = now;
  // 锁由 smsCleanupStreamLock 在 smsFire 收尾时统一释放
}

/* ── 气泡 ── */
function smsAppendBubble(text, role, opt = {}) {
  const win = document.getElementById('chatWindow');
  if (!win) return;

  // 提示音（实时播放响，历史回放不响）
  if (!opt.silent) SMS_SOUND.blip(role === 'user' ? 'out' : 'in');

  const bubbleMs = opt.ts || Date.now();

  // 时间分隔线
  const divider = smsMaybeDivider(SMS.lastSegMs, bubbleMs, 3);
  if (divider) win.appendChild(divider);
  SMS.lastSegMs = bubbleMs;

  // 思考链
  if (opt.think) {
    const box = SMS_ADAPTER.buildThinkBox(opt.think);
    if (box) {
      const row = document.createElement('div');
      row.className = 'msg-row sys sms-think-row';
      row.appendChild(box);
      win.appendChild(row);
    }
  }

  const row = document.createElement('div');
  row.className = 'msg-row ' + (role === 'user' ? 'user' : 'sys') + ' sms-row';

  const bubble = document.createElement('div');
  bubble.className = 'msg ' + (role === 'user' ? 'user' : 'sys') + ' sms-bubble';
  if (opt.pending) bubble.classList.add('sms-pending');
  bubble.textContent = text;
  row.appendChild(bubble);

  if (opt.meta) {
    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    meta.setAttribute('data-sms-ts', String(bubbleMs));
    meta.textContent = smsRelTime(bubbleMs);
    bubble.appendChild(meta);
  }

  win.appendChild(row);
  win.scrollTop = win.scrollHeight;
}

/* ── 正在输入 ── */
function smsShowTyping() {
  const win = document.getElementById('chatWindow');
  if (!win || document.getElementById('smsTyping')) return;

  const row = document.createElement('div');
  row.id = 'smsTyping';
  row.className = 'msg-row sys sms-typing-row';
  row.setAttribute('aria-live', 'polite');
  row.innerHTML =
    '<div class="sms-typing">' +
      '<span class="sms-dot"></span><span class="sms-dot"></span><span class="sms-dot"></span>' +
      '<span class="sms-typing-label">正在输入</span>' +
    '</div>' +
    '<button class="sms-skip" type="button">跳过</button>';

  row.querySelector('.sms-skip').addEventListener('click', () => { SMS.skip = true; });
  win.appendChild(row);
  win.scrollTop = win.scrollHeight;
}

function smsHideTyping() {
  const el = document.getElementById('smsTyping');
  if (el) el.remove();
}

function smsShowError(err, retry) {
  const win = document.getElementById('chatWindow');
  if (!win) return;
  const row = document.createElement('div');
  row.className = 'msg-row sys';
  const box = document.createElement('div');
  box.className = 'msg sys msg-error';
  box.innerHTML = '<div class="msg-error-detail"></div>';
  box.querySelector('.msg-error-detail').textContent =
    '没发出去：' + (err && err.message ? err.message : (err || '未知错误'));
  const btn = document.createElement('button');
  btn.className = 'msg-retry-btn';
  btn.textContent = '重试';
  btn.addEventListener('click', () => { row.remove(); retry(); });
  box.appendChild(btn);
  row.appendChild(box);
  win.appendChild(row);
  win.scrollTop = win.scrollHeight;
}

/* ── 历史回放：把存好的 segments 铺成多气泡 ── */
function smsRenderHistoryMessage(msg) {
  const gv = (typeof getActiveVersion === 'function') ? getActiveVersion : (m) => (m.versions && m.versions.length > 0 ? m.versions[m.activeVersion || 0] || m.versions[0] : m);
  const v = gv(msg);
  // ensureVersioned 会把 content/segments 复制进 versions[0] 并删除顶层 content
  const segs = msg.segments || v.segments ||
               String(v.content || msg.content || '').split('\n').filter(Boolean);
  const role = msg.role === 'user' ? 'user' : 'sys';
  const think = v.reasoning || v.thinking || msg.reasoning || '';
  segs.forEach((s, i) => smsAppendBubble(s, role, {
    think:  i === 0 ? think : null,
    meta:   i === segs.length - 1,
    silent: true,    // 历史回放不响提示音
  }));
}

/* ── 相对时间刷新器（30 秒轮询，页面隐藏时跳过） ── */
setInterval(() => {
  if (document.hidden) return;
  document.querySelectorAll('[data-sms-ts]').forEach(el => {
    el.textContent = smsRelTime(Number(el.dataset.smsTs));
  });
}, 30000);

/* ── 接管发送键与 Enter ── */
(function smsHookSend() {
  const origSend = window.sendChat;
  window.sendChat = function (...args) {
    if (!SMS.on) return origSend && origSend.apply(this, args);
    const input = document.getElementById('chatInput');
    if (input && smsEnqueue(input.value)) {
      input.value = '';
      input.style.height = '';
      input.focus();
    }
  };
})();

const SMS_PROMPT = `【当前模式：短消息】

你在用手机发微信，不是写文章。

格式（硬要求）：
- 每条消息之间用 ||| 分隔，不要用换行、不要用编号、不要用其他符号
- 每条 15 字以内，宁短勿长
- 一共 3 到 8 条
- 不写动作描写、不写场景描写、不用括号补充说明
- 不要重复对方刚说的话
- 一条只说一件事。有转折、有并列，就断开成两条

可以这样，也应该这样：
- 一条只有一个字："嗯" "在" "？" "哦"
- 语气词、口头语："诶" "笑死" "行吧"
- 一句话断在一半，下一条接着说完
- 偶尔只发一个标点或表情
- 不是每条都要有信息量，不是每条都要完整

反例（这样是错的，太长了）：
剩下的你扔给code去搞，想法本身很好，市面上没见过哪个人机恋产品做了这个

同样内容，正确的切法：
剩下的扔给code ||| 想法本身很好 ||| 市面上没人做过这个 ||| 做出来能拉开一大截

示例输出：
在 ||| 刚在厨房洗碗 ||| 手上还是湿的 ||| 你吃了吗 ||| 碗摔了

【上下文说明】
这个对话和长对话模式共享同一段历史。之前那些成段的话是你说的，
只是当时在用长对话模式。现在换成短消息，语气是同一个人，不用重新自我介绍。`;
