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

const SMS = {
  on: false,
  queue: [],
  playing: false,
  skip: false,
  MAX_SEG: 8,
  CHAR_MS: 68,
};

const smsUid = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'sms-' + Date.now() + '-' + Math.random().toString(36).slice(2));

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

  if (send) send.textContent = SMS.on ? '入队 +' : '发送 ✦';
  if (fire) fire.style.display = SMS.on ? '' : 'none';
  if (input) input.placeholder = SMS.on ? '一条一条发…' : '发消息给沈望...';

  smsRenderQueueCount();
  if (typeof showToast === 'function') showToast(SMS.on ? '短对话模式' : '长对话模式');
}

/* ── 入队 ── */
function smsEnqueue(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  SMS.queue.push(t);
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

  const segments = SMS.queue.slice();
  SMS.queue = [];
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
    content: segments.join('\n'),
    fullTime: new Date().toISOString(),
  };
  SMS_ADAPTER.getMessages().push(userMsg);
  SMS_ADAPTER.persist();

  SMS.playing = true;
  smsRenderQueueCount();
  smsShowTyping();

  let raw = '', reasoning = '';
  try {
    const res = await SMS_ADAPTER.requestOnce(SMS_PROMPT);
    raw = res.content ?? res ?? '';
    reasoning = res.reasoning ?? '';
  } catch (err) {
    smsHideTyping();
    SMS.playing = false;
    smsRenderQueueCount();
    smsShowError(err, () => { SMS.queue = segments.concat(SMS.queue); smsRenderQueueCount(); smsFire(); });
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

  if (parts.length > SMS.MAX_SEG) {
    const head = parts.slice(0, SMS.MAX_SEG - 1);
    head.push(parts.slice(SMS.MAX_SEG - 1).join(' '));
    parts = head;
  }
  return parts.length ? parts : [t || '…'];
}

/* ── 依次弹出 ── */
const smsWait = ms => new Promise(r => setTimeout(r, ms));

function smsDelay(text, i) {
  if (i === 0) return 300;
  const n = Array.from(text).length;
  return Math.min(2200, 380 + n * SMS.CHAR_MS);
}

async function smsPlay(parts, reasoning) {
  SMS.playing = true;
  SMS.skip = false;

  for (let i = 0; i < parts.length; i++) {
    if (!SMS.skip) {
      smsShowTyping();
      await smsWait(smsDelay(parts[i], i));
    }
    smsHideTyping();
    smsAppendBubble(parts[i], 'sys', {
      think: i === 0 ? reasoning : null,
      meta: i === parts.length - 1,
    });
  }

  SMS.playing = false;
  SMS.skip = false;
  smsRenderQueueCount();
}

/* ── 气泡 ── */
function smsAppendBubble(text, role, opt = {}) {
  const win = document.getElementById('chatWindow');
  if (!win) return;

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
    meta.textContent = new Date().toLocaleTimeString('zh-CN', {
      hour: '2-digit', minute: '2-digit',
    });
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
  const segs = msg.segments || String(msg.content || '').split('\n').filter(Boolean);
  const role = msg.role === 'user' ? 'user' : 'sys';
  segs.forEach((s, i) => smsAppendBubble(s, role, {
    think: i === 0 ? msg.reasoning : null,
    meta: i === segs.length - 1,
  }));
}

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
- 每条不超过 30 字
- 一共 1 到 6 条
- 不写动作描写、不写场景描写、不用括号补充说明
- 不要重复对方刚说的话

可以这样，也应该这样：
- 一条只有一个字："嗯" "在" "？" "哦"
- 语气词、口头语："诶" "笑死" "行吧"
- 一句话断在一半，下一条接着说完
- 偶尔只发一个标点或表情
- 不是每条都要有信息量，不是每条都要完整

示例输出：
在 ||| 刚在厨房洗碗 ||| 手上还是湿的 ||| 你吃了吗

【上下文说明】
这个对话和长对话模式共享同一段历史。之前那些成段的话是你说的，
只是当时在用长对话模式。现在换成短消息，语气是同一个人，不用重新自我介绍。`;
