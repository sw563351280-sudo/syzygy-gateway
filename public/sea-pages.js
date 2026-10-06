/* Small shared primitives for ocean pages; no page data or navigation state. */
(() => {
  'use strict';
  const paths = {
    back: '<path d="m14 5-7 7 7 7"/>',
    lock: '<rect x="6" y="10" width="12" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
    open: '<rect x="6" y="10" width="12" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7-2m-3 10v2"/>',
    star: '<path d="M12 2c1 7 3 9 10 10-7 1-9 3-10 10C11 15 9 13 2 12c7-1 9-3 10-10Z"/>',
  };
  function icon(name) {
    return '<svg class="sea-page-icon" viewBox="0 0 24 24" aria-hidden="true">' + (paths[name] || '') + '</svg>';
  }
  function reader(id, label, returnLabel) {
    const dialog = document.createElement('dialog');
    dialog.id = id;
    dialog.className = 'sea-page-reader';
    dialog.setAttribute('aria-label', label);
    const inner = document.createElement('div');
    inner.className = 'sea-page-reader-inner';
    const nav = document.createElement('nav');
    nav.className = 'sea-page-reader-nav';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'sea-page-button';
    back.innerHTML = icon('back');
    back.append(document.createTextNode(returnLabel));
    back.addEventListener('click', () => dialog.close());
    nav.append(back);
    const content = document.createElement('div');
    content.className = 'sea-page-reader-content';
    inner.append(nav,content);
    dialog.append(inner);
    document.body.append(dialog);
    return { dialog, content, back };
  }
  window.SeaPages = Object.freeze({ icon, reader });
})();
