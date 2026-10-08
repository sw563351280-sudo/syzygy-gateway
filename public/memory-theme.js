/* Shared theme choice for the standalone memory pages. */
(() => {
    'use strict';
    try {
        const saved=localStorage.getItem('syzygy_visual_theme'),legacy=localStorage.getItem('syzygy_home_layout');
        document.documentElement.dataset.visualTheme=saved==='new'||saved==='classic'?saved:legacy==='new'?'new':'classic';
    } catch (_) { document.documentElement.dataset.visualTheme='classic'; }
    window.addEventListener('storage',event=>{
        if(event.key==='syzygy_visual_theme'||event.key==='syzygy_home_layout')location.reload();
    });
})();
