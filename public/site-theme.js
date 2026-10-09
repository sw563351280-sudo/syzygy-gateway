/* One visual choice and one clock for every document in the house. */
(() => {
    'use strict';
    if (window.SeaTheme) return;
    const html = document.documentElement;
    let originalChrome;
    function selected() {
        try {
            const saved = localStorage.getItem('syzygy_visual_theme');
            return saved === 'new' || saved === 'classic' ? saved : localStorage.getItem('syzygy_home_layout') === 'new' ? 'new' : 'classic';
        } catch (_) { return html.dataset.visualTheme || 'classic'; }
    }
    function updateChrome() {
        let meta = document.querySelector('meta[name="theme-color"]');
        if (originalChrome === undefined && meta) originalChrome = meta.content;
        if (html.dataset.visualTheme !== 'new') {
            if (meta && originalChrome !== undefined && typeof window.applyVisualTheme !== 'function') meta.content = originalChrome;
            return;
        }
        if (!meta) { originalChrome = '#E8EFF7'; meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.append(meta); }
        meta.content = html.dataset.seaCycle === 'night' ? '#081A2D' : '#A9C3D8';
    }
    function sync() {
        const theme = selected();
        if (typeof window.applyVisualTheme === 'function' && document.body) window.applyVisualTheme(theme, false);
        else { html.dataset.visualTheme = theme; if (document.body) document.body.dataset.visualTheme = theme; }
        window.SeaCycle?.update();
        updateChrome();
    }
    window.SeaTheme = Object.freeze({ selected, sync, updateChrome });
    html.dataset.visualTheme = selected();
    // Storage events update already-open windows; focus also catches suspended PWA views.
    window.addEventListener('storage', e => { if (e.key === null || e.key === 'syzygy_visual_theme' || e.key === 'syzygy_home_layout') sync(); });
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
    window.addEventListener('sea-cycle-change', updateChrome);
    new MutationObserver(updateChrome).observe(html, { attributes: true, attributeFilter: ['data-visual-theme', 'data-sea-cycle'] });
    document.addEventListener('DOMContentLoaded', sync, { once: true });
    // Do not insert a duplicate meta before the document's own head has finished parsing.
    if (document.readyState !== 'loading') updateChrome();
})();
