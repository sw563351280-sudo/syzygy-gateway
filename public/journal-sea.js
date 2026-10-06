(() => {
  'use strict';
  const root = document.getElementById('privateJournalSea');
  if (!root || !window.SeaPages) return;
  const { icon } = window.SeaPages;
  const ns = 'http://www.w3.org/2000/svg';
  let entries = new Map(), selected = null, reader = null;
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  const decor = (className, viewBox, paths) => '<svg class="journal-sea-deco ' + className + '" viewBox="' + viewBox + '" aria-hidden="true">' + paths + '</svg>';
  root.innerHTML = '<nav class="sea-page-nav"><button type="button" class="sea-page-button" id="journalSeaBack">' + icon('back') + '锁页日记</button></nav>' +
    decor('journal-sea-bookmark','0 0 18 76','<path d="M1 0v74l8-9 8 9V0"/>') +
    '<main class="journal-sea-main"><header class="journal-sea-heading"><h1>他没有说出口的页角</h1>' +
    decor('journal-sea-wave','0 0 64 15','<path d="M1 8c18-14 34 14 62-4M1 12c18-10 30 7 45 1"/>') +
    decor('journal-sea-stamp','0 0 84 58','<path d="M48 13a25 25 0 1 0-8 39M45 16a21 21 0 1 0-7 32M31 28c17 6 28-10 49-4M31 34c17 6 28-10 49-4M31 40c17 6 28-10 49-4"/>') +
    '</header><div class="journal-sea-count"><span id="journalSeaCount" class="journal-sea-count-number">—</span>' + icon('star') +
    decor('journal-sea-quill','0 0 42 48','<path d="M3 45 38 2C24 4 7 14 9 34c14 0 22-9 29-32M9 34l15-6M17 24l14-5M23 16l-2-5"/>') +
    '</div><div id="journalSeaList" class="journal-sea-list" aria-live="polite"></div><div id="journalSeaStatus" role="status"></div>' +
    '<button type="button" id="journalSeaMore" class="sea-page-button journal-sea-more" hidden>更早的页</button></main>';
  document.getElementById('journalSeaBack').addEventListener('click', () => goView('home'));
  document.getElementById('journalSeaMore').addEventListener('click', () => privateJournalLoadMore());
  const list = document.getElementById('journalSeaList');
  const more = document.getElementById('journalSeaMore');
  const status = document.getElementById('journalSeaStatus');
  function enabled() { return document.documentElement.dataset.visualTheme === 'new'; }
  function sync() {
    root.inert = !enabled();
    root.setAttribute('aria-hidden', String(!enabled()));
    const active = enabled() && document.body.dataset.view === 'private-journal';
    document.body.dataset.seaPage = String(active);
    if (!active && reader?.dialog.open) reader.dialog.close();
  }
  function dateParts(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return { day: '很久以前', time: '' };
    const options = { timeZone: 'Asia/Shanghai' };
    return {
      day: new Intl.DateTimeFormat('zh-CN',{ ...options,month:'long',day:'numeric' }).format(date),
      time: new Intl.DateTimeFormat('zh-CN',{ ...options,hour:'2-digit',minute:'2-digit',hourCycle:'h23' }).format(date),
    };
  }
  function message(text, retry) {
    const node = element('div','sea-page-message',text);
    if (retry) {
      const button = element('button','sea-page-button','重试');
      button.type = 'button';
      button.addEventListener('click',retry);
      node.append(element('br'),button);
    }
    return node;
  }
  function loading(reset) {
    sync();
    status.replaceChildren();
    more.disabled = true;
    if (reset) {
      list.setAttribute('aria-busy','true');
      list.replaceChildren(message('正在翻页…'));
      more.hidden = true;
    } else status.append(message('正在翻页…'));
  }
  function error(text, reset) {
    list.removeAttribute('aria-busy');
    more.disabled = false;
    const target = reset ? list : status;
    target.replaceChildren(message(text || '暂时打不开',() => reset ? privateJournalLoad(true) : privateJournalLoadMore()));
  }
  function render(values, total) {
    entries = new Map(values.map(entry => [entry.id,entry]));
    sync();
    const count = document.getElementById('journalSeaCount');
    count.textContent = String(total || 0);
    count.setAttribute('aria-label',(total || 0) + '篇日记');
    list.removeAttribute('aria-busy');
    status.replaceChildren();
    const fragment = document.createDocumentFragment();
    for (const entry of values) {
      const revealed = entry.visibility === 'revealed';
      const date = dateParts(entry.created_at);
      const row = element('button','journal-sea-row');
      row.type = 'button';
      row.dataset.entryId = entry.id;
      row.setAttribute('aria-label',date.day + ' ' + date.time + '，' + (entry.title || '未启封的一页') + '，' + (revealed ? '已打开' : '锁定'));
      row.setAttribute('aria-haspopup','dialog');
      const time = element('time','journal-sea-date');
      if (!Number.isNaN(new Date(entry.created_at).getTime())) time.dateTime = entry.created_at;
      time.append(element('span','',date.day),element('small','',date.time));
      const title = element('span','journal-sea-title',entry.title || '未启封的一页');
      title.title = entry.title || '未启封的一页';
      const marks = element('span','journal-sea-marks');
      marks.setAttribute('aria-hidden','true');
      marks.innerHTML = icon(revealed ? 'open' : 'lock') + icon('star');
      row.append(time,title,marks);
      row.addEventListener('click',() => open(entry.id));
      fragment.append(row);
    }
    if (!values.length) fragment.append(message('还没有留下书页。'));
    list.replaceChildren(fragment);
    more.hidden = values.length >= total;
    more.disabled = false;
    if (selected && reader?.dialog.open) renderReader();
  }
  function ensureReader() {
    if (reader) return;
    reader = window.SeaPages.reader('journalSeaReader','日记阅读','锁页日记');
    reader.dialog.addEventListener('close',() => {
      const id = selected;
      selected = null;
      reader.content.replaceChildren();
      if (enabled() && document.body.dataset.view === 'private-journal') {
        [...list.querySelectorAll('[data-entry-id]')].find(row => row.dataset.entryId === id)?.focus({ preventScroll:true });
      }
    });
  }
  // Entirely invented marks: their shape and length never depend on diary text.
  function fakeInk() {
    const svg = document.createElementNS(ns,'svg');
    svg.setAttribute('viewBox','0 0 520 150');
    svg.setAttribute('class','journal-sea-fake-ink');
    svg.setAttribute('aria-hidden','true');
    const group = document.createElementNS(ns,'g');
    group.setAttribute('fill','none');
    group.setAttribute('stroke','currentColor');
    group.setAttribute('stroke-width','1.7');
    group.setAttribute('stroke-linecap','round');
    [29,32,20,25].forEach((length,row) => {
      for (let i = 0; i < length; i++) {
        const x = 7 + i * 15, y = 16 + row * 33 + (i % 3);
        const path = document.createElementNS(ns,'path');
        path.setAttribute('d', i % 2
          ? `M${x} ${y}l9-2m-5-4-1 15m-5-3 11-3m-8-7 8 12`
          : `M${x} ${y}l10 1m-4-5-2 15m-5-4 10-5m-8 2 9 9`);
        group.append(path);
      }
    });
    svg.append(group);
    return svg;
  }
  function renderReader() {
    const entry = entries.get(selected);
    reader.content.replaceChildren();
    if (!entry) { reader.content.append(message('这一页暂时不在目录里。')); return; }
    reader.dialog.setAttribute('aria-label',entry.title || '日记阅读');
    reader.dialog.setAttribute('aria-labelledby','journalSeaReaderTitle');
    const date = dateParts(entry.created_at);
    const heading = element('h1','journal-sea-reader-title',entry.title || '未启封的一页');
    heading.id = 'journalSeaReaderTitle';
    reader.content.append(element('p','journal-sea-reader-date',date.day + ' ' + date.time),heading);
    if (entry.visibility === 'revealed') {
      reader.content.append(element('div','journal-sea-reader-body',entry.content || ''));
      return;
    }
    const seal = element('div');
    seal.setAttribute('role','img');
    seal.setAttribute('aria-label','封存的笔迹');
    seal.append(fakeInk());
    reader.content.append(seal);
    if (entry.request_status === 'kept_sealed') reader.content.append(element('p','journal-sea-reader-status','仍然封存'));
    const pending = entry.request_status === 'requested';
    const action = element('button','sea-page-button journal-sea-reader-request');
    action.type = 'button';
    action.innerHTML = icon('lock');
    action.append(document.createTextNode(pending ? '去聊天里问他' : entry.request_status === 'kept_sealed' ? '再问一次' : '请求查看'));
    action.addEventListener('click',async () => {
      action.disabled = true;
      try { await privateJournalRequest(entry.id,{ confirm:false }); }
      finally { action.disabled = false; }
    });
    reader.content.append(action);
  }
  function open(id) {
    if (!enabled() || document.body.dataset.view !== 'private-journal' || !entries.has(id)) return;
    ensureReader();
    selected = id;
    renderReader();
    reader.dialog.showModal();
  }
  window.SeaJournal = Object.freeze({ render,loading,error,sync });
})();
