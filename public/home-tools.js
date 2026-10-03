'use strict';

// ═══ 共同账本 ═══
let ledgerYear = new Date().getFullYear();
let ledgerMonth = new Date().getMonth() + 1;
let ledgerSelectedDate = null;
let ledgerKind = 'expense';
let ledgerCategory = '餐饮';
let ledgerOverviewData = null;
const LEDGER_CATEGORIES = {
    expense: [['餐饮','🍜'], ['交通','🚇'], ['购物','🛍️'], ['娱乐','🎬'], ['居住','🏠'], ['学习','📚'], ['医疗','💊'], ['其他','✨']],
    income: [['工资','💼'], ['兼职','🧩'], ['礼物','🎁'], ['退款','↩️'], ['理财','🌱'], ['其他','✨']],
};
const LEDGER_CATEGORY_COLORS = ['#D4A856','#A8C8DA','#B9DEC7','#DAB9C8','#C9C1E3','#F3C884','#9AB9A8','#B7C2D0'];

function ledgerMonthKey() { return ledgerYear + '-' + String(ledgerMonth).padStart(2, '0'); }
function ledgerDateKey(date = new Date()) { return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0'); }
function ledgerMoney(cents, compact = false) {
    const amount = Number(cents || 0) / 100;
    return '¥' + amount.toLocaleString('zh-CN', { minimumFractionDigits: compact ? 0 : 2, maximumFractionDigits: compact ? 0 : 2 });
}
function ledgerPrevMonth() { ledgerMonth--; if (ledgerMonth < 1) { ledgerMonth = 12; ledgerYear--; } ledgerSelectedDate = null; ledgerRender(); }
function ledgerNextMonth() { ledgerMonth++; if (ledgerMonth > 12) { ledgerMonth = 1; ledgerYear++; } ledgerSelectedDate = null; ledgerRender(); }

async function ledgerRender() {
    try {
        const response = await fetch('/api/ledger/overview?month=' + encodeURIComponent(ledgerMonthKey()), { cache: 'no-store' });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || '账本加载失败');
        ledgerOverviewData = result.data;
        const d = result.data;
        document.getElementById('ledgerMonthTitle').textContent = ledgerYear + '年' + ledgerMonth + '月';
        document.getElementById('ledgerBalance').textContent = ledgerMoney(d.balance_cents);
        document.getElementById('ledgerIncome').textContent = '+' + ledgerMoney(d.income_cents);
        document.getElementById('ledgerExpense').textContent = '-' + ledgerMoney(d.expense_cents);
        document.getElementById('ledgerSavingsRate').textContent = d.savings_rate === null ? '开始记账吧' : '结余率 ' + d.savings_rate + '%';
        ledgerRenderCalendar(d.daily || {});
        ledgerRenderCategories(d);
        ledgerRenderSummary(d);
        ledgerRenderRecent(d.recent || []);
        if (ledgerSelectedDate) ledgerLoadDay(ledgerSelectedDate, true);
    } catch (error) {
        console.error('账本加载失败', error);
        const box = document.getElementById('ledgerRecentList');
        if (box) box.innerHTML = '<span class="ledger-empty">账本加载失败，请稍后再试。</span>';
    }
}

function ledgerRenderCalendar(daily) {
    const grid = document.getElementById('ledgerCalendar');
    if (!grid) return;
    const first = new Date(ledgerYear, ledgerMonth - 1, 1);
    const days = new Date(ledgerYear, ledgerMonth, 0).getDate();
    const leading = (first.getDay() + 6) % 7;
    const today = ledgerDateKey();
    let html = '';
    for (let i = 0; i < leading; i++) html += '<span class="ledger-cal-empty"></span>';
    for (let day = 1; day <= days; day++) {
        const key = ledgerMonthKey() + '-' + String(day).padStart(2, '0');
        const item = daily[key] || { income: 0, expense: 0 };
        const selected = key === ledgerSelectedDate ? ' selected' : '';
        const current = key === today ? ' today' : '';
        const hasData = item.income || item.expense ? ' has-data' : '';
        html += '<button type="button" class="ledger-cal-day' + selected + current + hasData + '" onclick="ledgerLoadDay(\'' + key + '\')"><b>' + day + '</b>';
        if (item.income) html += '<small class="in">+' + ledgerMoney(item.income, true).replace('¥','') + '</small>';
        if (item.expense) html += '<small class="out">-' + ledgerMoney(item.expense, true).replace('¥','') + '</small>';
        html += '</button>';
    }
    grid.innerHTML = html;
}

function ledgerRenderCategories(data) {
    const categories = data.category_breakdown || [];
    const list = document.getElementById('ledgerCategoryList');
    const donut = document.getElementById('ledgerDonut');
    document.getElementById('ledgerDonutTotal').textContent = ledgerMoney(data.expense_cents, true);
    document.getElementById('ledgerCategoryNote').textContent = categories.length ? data.count + ' 笔记录' : '本月';
    if (!categories.length) {
        donut.style.background = 'conic-gradient(#D5DFE9 0deg 360deg)';
        list.innerHTML = '<span class="ledger-empty">还没有支出记录</span>';
        return;
    }
    let offset = 0;
    const segments = categories.map((category, index) => {
        const start = offset; offset += category.percent;
        return LEDGER_CATEGORY_COLORS[index % LEDGER_CATEGORY_COLORS.length] + ' ' + start + '% ' + offset + '%';
    });
    donut.style.background = 'conic-gradient(' + segments.join(',') + ')';
    list.innerHTML = categories.slice(0, 6).map((category, index) => '<div><i style="background:' + LEDGER_CATEGORY_COLORS[index % LEDGER_CATEGORY_COLORS.length] + '"></i><span>' + escapeHtml(category.name) + '</span><em>' + category.percent + '%</em></div>').join('');
}

function ledgerRenderSummary(data) {
    const box = document.getElementById('ledgerMonthlySummary');
    if (!box) return;
    if (!data.count) { box.textContent = '从第一笔开始，我会陪你把每一笔都放在恰当的位置。'; return; }
    const category = data.category_breakdown && data.category_breakdown[0];
    const change = data.expense_change_cents || 0;
    const changeText = change === 0 ? '和上个月一样安静' : (change > 0 ? '比上个月多了 ' : '比上个月少了 ') + ledgerMoney(Math.abs(change));
    box.textContent = '这个月记下了 ' + data.count + ' 笔。' + (category ? category.name + '最多，占支出 ' + category.percent + '%；' : '') + changeText + '。';
}

function ledgerRenderRecent(rows) {
    const list = document.getElementById('ledgerRecentList');
    if (!list) return;
    if (!rows.length) { list.innerHTML = '<span class="ledger-empty">还没有记录，先记一笔吧。</span>'; return; }
    const iconFor = (category) => {
        const found = Object.values(LEDGER_CATEGORIES).flat().find(row => row[0] === category);
        return found ? found[1] : '✨';
    };
    list.innerHTML = rows.map(row => '<div class="ledger-record"><span class="ledger-record-icon">' + iconFor(row.category) + '</span><div><strong>' + escapeHtml(row.name) + '</strong><small>' + row.date.slice(5).replace('-', '月') + '日 · ' + escapeHtml(row.category) + (row.visibility === 'private' ? ' · 仅自己' : '') + '</small></div><em class="' + row.kind + '">' + (row.kind === 'income' ? '+' : '-') + ledgerMoney(row.amount_cents) + '</em></div>').join('');
}

async function ledgerLoadDay(date, quiet) {
    ledgerSelectedDate = date;
    if (!quiet && ledgerOverviewData) ledgerRenderCalendar(ledgerOverviewData.daily || {});
    const detail = document.getElementById('ledgerDayDetail');
    detail.textContent = '正在读取 ' + date.slice(5).replace('-', '月') + '日…';
    try {
        const response = await fetch('/api/ledger/transactions?date=' + encodeURIComponent(date), { cache: 'no-store' });
        const result = await response.json();
        const rows = result.data || [];
        if (!rows.length) { detail.innerHTML = '<span>' + date.slice(5).replace('-', '月') + '日还没有账目。</span>'; return; }
        const income = rows.filter(r => r.kind === 'income').reduce((sum, r) => sum + r.amount_cents, 0);
        const expense = rows.filter(r => r.kind === 'expense').reduce((sum, r) => sum + r.amount_cents, 0);
        detail.innerHTML = '<div class="ledger-day-head"><strong>' + date.slice(5).replace('-', '月') + '日</strong><span>收入 +' + ledgerMoney(income) + ' · 支出 -' + ledgerMoney(expense) + '</span></div>' + rows.map(row => '<div class="ledger-day-row"><span>' + escapeHtml(row.category) + ' · ' + escapeHtml(row.name) + '</span><em class="' + row.kind + '">' + (row.kind === 'income' ? '+' : '-') + ledgerMoney(row.amount_cents) + '</em></div>').join('');
    } catch (_) { detail.textContent = '这一天暂时无法读取。'; }
}

async function ledgerShowAll() {
    try {
        const response = await fetch('/api/ledger/transactions?month=' + encodeURIComponent(ledgerMonthKey()), { cache: 'no-store' });
        const result = await response.json();
        ledgerRenderRecent(result.data || []);
    } catch (_) { toast('暂时无法读取全部记录'); }
}

function ledgerOpenComposer() {
    const overlay = document.getElementById('ledgerComposer');
    document.getElementById('ledgerAmountInput').value = '';
    document.getElementById('ledgerNameInput').value = '';
    document.getElementById('ledgerNoteInput').value = '';
    document.getElementById('ledgerPrivateInput').checked = false;
    document.getElementById('ledgerDateInput').value = ledgerSelectedDate || ledgerDateKey();
    ledgerSetKind('expense');
    overlay.hidden = false;
    setTimeout(() => document.getElementById('ledgerAmountInput').focus(), 30);
}
function ledgerCloseComposer() { document.getElementById('ledgerComposer').hidden = true; }
function ledgerSetKind(kind) {
    ledgerKind = kind;
    ledgerCategory = LEDGER_CATEGORIES[kind][0][0];
    document.querySelectorAll('.ledger-kind-toggle button').forEach(button => button.classList.toggle('active', button.dataset.kind === kind));
    const picker = document.getElementById('ledgerCategoryPicker');
    picker.innerHTML = LEDGER_CATEGORIES[kind].map(row => '<button type="button" class="' + (row[0] === ledgerCategory ? 'active' : '') + '" onclick="ledgerChooseCategory(\'' + row[0] + '\')"><span>' + row[1] + '</span>' + row[0] + '</button>').join('');
    document.querySelector('.ledger-save-button').textContent = kind === 'income' ? '确认入账' : '确认记账';
}
function ledgerChooseCategory(category) {
    ledgerCategory = category;
    document.querySelectorAll('.ledger-category-picker button').forEach(button => button.classList.toggle('active', button.textContent.trim().endsWith(category)));
}
async function ledgerSave(event) {
    event.preventDefault();
    const amountCents = Math.round(Number(document.getElementById('ledgerAmountInput').value) * 100);
    const body = { kind: ledgerKind, amount_cents: amountCents, category: ledgerCategory, name: document.getElementById('ledgerNameInput').value, date: document.getElementById('ledgerDateInput').value, note: document.getElementById('ledgerNoteInput').value, visibility: document.getElementById('ledgerPrivateInput').checked ? 'private' : 'shared' };
    try {
        const response = await fetch('/api/ledger/transactions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || '保存失败');
        ledgerCloseComposer();
        ledgerSelectedDate = body.date;
        toast(body.kind === 'income' ? '已确认入账' : '已记进账本');
        await ledgerRender();
    } catch (error) { toast(error.message || '记账失败'); }
}

// ═══ 日历视图 ═══
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth() + 1;
let _calSelectedDate = null;
let _calSelectedPage = null;
let _calMoodSnapshotsByDate = {};
let _calFlowsByDate = {};

function calYearMonth() { return calYear + '-' + String(calMonth).padStart(2, '0'); }
function calPrevMonth() { calMonth--; if (calMonth < 1) { calMonth = 12; calYear--; } calRender(); }
function calNextMonth() { calMonth++; if (calMonth > 12) { calMonth = 1; calYear++; } calRender(); }
function calLooseDateKey(dateStr) { if (!dateStr) return ''; const parts = String(dateStr).split('-').map(x => parseInt(x,10)); if (parts.length<3||parts.some(isNaN)) return String(dateStr); return parts[0]+'-'+parts[1]+'-'+parts[2]; }
function calFormatDisplayDate(dateStr) { const p = calLooseDateKey(dateStr).split('-'); if (p.length<3) return dateStr; return p[1]+'月'+p[2]+'日'; }
function calFormatTimeFromISO(iso) { if (!iso) return ''; try { return new Date(iso).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false}); } catch(e) { return ''; } }

async function calLoadMoodSnapshots() {
    _calMoodSnapshotsByDate = {};
    _calFlowsByDate = {};
    try {
        const r = await fetch('/diary-logs');
        const raw = await r.json();
        const entries = Array.isArray(raw) ? raw : (raw.entries || raw.data || raw.logs || []);
        if (!Array.isArray(entries)) { console.log('日历心情快照格式不兼容', raw); return; }
        for (const e of entries) {
            const type = e.type || '';
            const text = e.text || '';
            const isMoodSnapshot = type === 'mood_snapshot' || text.includes('【心情快照');
            const isDailyFlow = type === 'daily_flow' || text.includes('【今日流水】');
            const rawDate = e.date || e.day || e.dateStr || (e.datetime ? e.datetime.slice(0,10) : '');
            const key = calLooseDateKey(rawDate);
            if (!key) continue;
            if (isMoodSnapshot) {
                if (!_calMoodSnapshotsByDate[key]) _calMoodSnapshotsByDate[key] = [];
                _calMoodSnapshotsByDate[key].push(e);
            }
            if (isDailyFlow) {
                if (!_calFlowsByDate[key]) _calFlowsByDate[key] = [];
                _calFlowsByDate[key].push(e);
            }
        }
        for (const key of Object.keys(_calMoodSnapshotsByDate)) { _calMoodSnapshotsByDate[key].sort((a,b) => new Date(a.datetime||a.time||0) - new Date(b.datetime||b.time||0)); }
        for (const key of Object.keys(_calFlowsByDate)) { _calFlowsByDate[key].sort((a,b) => new Date(a.datetime||a.time||0) - new Date(b.datetime||b.time||0)); }
        console.log('日历心情快照加载完成', _calMoodSnapshotsByDate);
        console.log('日历今日流水加载完成', _calFlowsByDate);
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
        const hasFlow = !!(_calFlowsByDate[mKey] && _calFlowsByDate[mKey].length);
        const selected = _calSelectedDate && calLooseDateKey(dateStr) === calLooseDateKey(_calSelectedDate);
        let cls = 'cal-cell';
        if (isToday) cls += ' today';
        if (selected) cls += ' selected';
        if (page && page.shenwang_note) cls += ' has-note';
        if (hasMood) cls += ' has-mood-snapshot';
        if (hasFlow) cls += ' has-flow';
        html += '<div class="' + cls + '" data-date="' + dateStr + '" onclick="calOpenDay(\'' + dateStr + '\')">';
        html += '<span class="cal-cell-num">' + d + '</span>';
        if (page && page.shenwang_note) html += '<span class="cal-cell-dot"></span>';
        if (page && page.period_flag) html += '<span class="cal-cell-period"></span>';
        if (hasMood && !(page && page.shenwang_note)) html += '<span class="cal-mood-dot"></span>';
        if (hasFlow && !(page && page.shenwang_note) && !hasMood) html += '<span class="cal-flow-dot"></span>';
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
    const flows = _calFlowsByDate[key] || [];
    let html = '<div class="cal-inline-card">';
    html += '<div class="cal-inline-header"><div><div class="cal-inline-date">' + escapeHtml(calFormatDisplayDate(dateStr)) + '</div><div class="cal-inline-subtitle">这一天留下的痕迹</div></div>';
    html += '<div class="cal-inline-header-actions"><button class="cal-inline-state-btn" onclick="goView(\'state\')">状态</button><button class="cal-inline-add-btn" onclick="calQuickMoodSnapshot()">＋快照</button></div></div>';
    if (snapshots.length) {
        html += '<div class="cal-inline-section-title">心情快照</div>';
        for (const s of snapshots) { const time = calFormatTimeFromISO(s.datetime); html += '<div class="cal-snapshot-item collapsed" onclick="this.classList.toggle(\'collapsed\')"><div class="cal-snapshot-time">' + escapeHtml(time||'') + '</div><div class="cal-snapshot-text">' + escapeHtml(s.text||'').replace(/\n/g,'<br>') + '</div></div>'; }
    }
    if (flows.length) {
        html += '<div class="cal-inline-section-title">今日流水</div>';
        for (const f of flows) { const time = calFormatTimeFromISO(f.datetime); const flowText = (f.text||'').replace(/^【今日流水】\n?/,''); html += '<div class="cal-snapshot-item collapsed" onclick="this.classList.toggle(\'collapsed\')"><div class="cal-snapshot-time">' + escapeHtml(time||'') + '</div><div class="cal-snapshot-text">' + escapeHtml(flowText).replace(/\n/g,'<br>') + '</div></div>'; }
    }
    if (page && (page.mood || page.shenwang_note || page.shenwang_comment || page.period_flag)) {
        html += '<div class="cal-inline-section-title">日历记录</div>';
        if (page.mood) html += '<div class="cal-page-line"><span>心情</span><p>' + (page.mood||'').replace(/</g,'&lt;') + '</p></div>';
        if (page.period_flag) html += '<div class="cal-page-line"><span>生理期</span><p>是</p></div>';
        if (page.shenwang_note) html += '<div class="cal-page-line"><span>沈望手记</span><p>' + (page.shenwang_note||'').replace(/</g,'&lt;').replace(/\n/g,'<br>') + '</p></div>';
        if (page.shenwang_comment) html += '<div class="cal-page-line"><span>沈望点评</span><p>' + (page.shenwang_comment||'').replace(/</g,'&lt;').replace(/\n/g,'<br>') + '</p></div>';
    }
    if (!snapshots.length && !flows.length && !(page && (page.mood || page.shenwang_note || page.shenwang_comment || page.period_flag))) { html += '<div class="cal-inline-empty">这一天还没有记录。</div>'; }
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

        const slots = us.slots || {};
        const todayStr = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric' }).split('/').map((x,i) => i===0 ? x : x.padStart(2,'0')).join('-');
        window._stateSlots = slots;
        const dailyLines = [], persistentLines = [];
        const renderSlot = (key, slot, suffix) => {
            const encodedKey = encodeURIComponent(key);
            return '<div style="display:flex;gap:8px;align-items:flex-start;margin:4px 0;">'
                + '<div style="flex:1;min-width:0;">' + escapeHtml(key) + '：' + escapeHtml(slot.value) + suffix + '</div>'
                + '<button type="button" onclick="stateEditSlot(\'' + encodedKey + '\')" aria-label="修改' + escapeHtml(key) + '" title="修改" style="flex:0 0 auto;border:0;background:transparent;color:#7A9AC5;cursor:pointer;padding:0 2px;font-size:13px;">改</button>'
                + '</div>';
        };
        for (const key of Object.keys(slots)) {
            const slot = slots[key];
            if (!slot || !slot.value) continue;
            if (slot.mode === 'persistent') {
                const ageDays = Math.floor((Date.now() - new Date(slot.updated_at).getTime()) / 86400000);
                const stale = ageDays >= (Number(slot.life_days) || 3);
                persistentLines.push(renderSlot(key, slot, stale ? ' <span style="color:#B7791F">⚠️ 已' + ageDays + '天未更新，建议确认</span>' : ''));
            } else {
                const slotDate = new Date(slot.updated_at).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric' }).split('/').map((x,i) => i===0 ? x : x.padStart(2,'0')).join('-');
                if (slotDate === todayStr) dailyLines.push(renderSlot(key, slot, ''));
            }
        }
        if (dailyLines.length) parts.push('<div style="margin-bottom:10px;"><div style="font-weight:600;margin-bottom:4px;">📌 今日</div>' + dailyLines.join('') + '</div>');
        if (persistentLines.length) parts.push('<div><div style="font-weight:600;margin-bottom:4px;">📎 近期</div>' + persistentLines.join('') + '</div>');

        view.innerHTML = parts.join('') || '还没有记录过状态';
    } catch(e) { view.innerText = '加载失败'; }
}

async function stateEditSlot(encodedKey) {
    const key = decodeURIComponent(encodedKey || '');
    const current = (window._stateSlots || {})[key];
    if (!key || !current) return;
    const value = window.prompt(`修改「${key}」\n留空会删除这一项。`, current.value || '');
    if (value === null) return;
    const slots = { ...(window._stateSlots || {}) };
    const nextValue = value.trim();
    if (!nextValue) delete slots[key];
    else slots[key] = { ...current, value: nextValue, updated_at: new Date().toISOString() };
    try {
        const r = await fetch('/api/user-state', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slots })
        });
        const d = await r.json();
        if (!r.ok || !d.success) throw new Error(d.error || '保存失败');
        toast(nextValue ? '当前状态已改' : '当前状态已删');
        stateRender();
    } catch (e) { toast('保存失败：' + (e.message || '网络错误')); }
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
            toast('已记录到日历 📅');
            document.getElementById('stateMood').value = '';
            document.getElementById('stateBody').value = '';
            document.getElementById('stateFocus').value = '';
            stateRender();
        } else toast('失败: ' + (d.error || ''));
    } catch(e) { toast('网络错误'); }
}
