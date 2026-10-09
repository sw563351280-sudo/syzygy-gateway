/* Layout-bound memory pages use the same shared theme choice as every other page. */
(() => {
    'use strict';
    window.SeaTheme?.sync();
    const renderedTheme = document.documentElement.dataset.visualTheme;
    window.addEventListener('storage', event => {
        if (event.key === null || event.key === 'syzygy_visual_theme' || event.key === 'syzygy_home_layout') {
            // Only layout changes need a reload. The day/night background switches in place.
            if (window.SeaTheme?.selected() !== renderedTheme) location.reload();
        }
    });
})();
