/* The only wallpaper controls live here; every other page simply follows them. */
(() => {
    'use strict';
    const root = document.getElementById('appearanceController');
    if (!root || !window.SeaTheme) return;
    let draftException = '';
    let initialized = false;
    let settingsActive = false;
    let internalAdjustment = false;
    let previewFrame = 0;
    let pendingAdjustments = {};
    let objectUrls = [];
    const staged = new Map();
    const fallback = { day: 'assets/ice-sea-home-v2.webp', night: 'assets/ice-sea-night-v1.webp' };
    const escapeHtml = value => String(value || '').replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character]));
    const slotKey = (scope, phase) => `${scope}:${phase}`;
    const status = (message, error = false) => {
        const element = document.getElementById('appearanceStatus');
        if (element) { element.textContent = message; element.classList.toggle('is-error', error); }
    };
    function releaseUrls() { objectUrls.forEach(url => URL.revokeObjectURL(url)); objectUrls = []; }
    function previewUrl(blob) { const url = URL.createObjectURL(blob); objectUrls.push(url); return url; }
    function slotMarkup(scope, phase, compact = false) {
        const id = slotKey(scope, phase).replace(/[^a-z0-9-]/gi, '-');
        const title = phase === 'day' ? '☀️ 白天壁纸' : '🌙 夜晚壁纸';
        return `<article class="wallpaper-slot${compact ? ' is-compact' : ''}" data-wallpaper-slot="${escapeHtml(slotKey(scope, phase))}">
            <div class="wallpaper-preview" id="preview-${id}" aria-hidden="true"></div>
            <div class="wallpaper-slot-copy"><strong>${title}</strong><small id="source-${id}">正在查看…</small></div>
            <div class="wallpaper-actions">
                <label class="appearance-button">选择图片<input type="file" accept="image/*" data-wallpaper-file="${escapeHtml(slotKey(scope, phase))}"></label>
                <button type="button" class="appearance-link" data-wallpaper-remove="${escapeHtml(slotKey(scope, phase))}">恢复</button>
            </div>
            <div class="wallpaper-confirm" data-wallpaper-confirm-row="${escapeHtml(slotKey(scope, phase))}" hidden><span>先看看这张，满意再使用</span><button type="button" data-wallpaper-confirm="${escapeHtml(slotKey(scope, phase))}">使用这张</button><button type="button" data-wallpaper-cancel="${escapeHtml(slotKey(scope, phase))}">取消</button></div>
        </article>`;
    }
    function renderStructure() {
        const settings = SeaTheme.settings();
        const exceptionScopes = [...new Set([...Object.keys(settings.exceptions), ...(draftException ? [draftException] : [])])];
        const available = Object.entries(SeaTheme.pages).filter(([key]) => key !== 'settings' && !exceptionScopes.includes(key));
        root.innerHTML = `
            <div class="appearance-wallpaper-grid">${slotMarkup('global', 'day')}${slotMarkup('global', 'night')}</div>
            <section class="appearance-adjustments" aria-labelledby="appearanceAdjustTitle">
                <h2 id="appearanceAdjustTitle">玻璃与光线</h2>
                ${rangeMarkup('cardTransparency', '卡片透明度', settings.cardTransparency, 0, 85, '%')}
                ${rangeMarkup('dayDim', '白天背景暗度', settings.dayDim, 0, 70, '%')}
                ${rangeMarkup('nightDim', '夜晚背景暗度', settings.nightDim, 0, 70, '%')}
                <p id="appearanceContrastHint" class="appearance-hint"${settings.cardTransparency < 72 ? ' hidden' : ''}>卡片已经很透明啦，花纹较多的壁纸可能会让文字不太好认。</p>
                <details class="appearance-more"><summary>更多调整</summary>${rangeMarkup('blur', '背景模糊', settings.blur, 0, 20, ' px')}</details>
            </section>
            <section class="appearance-exceptions" aria-labelledby="appearanceExceptionsTitle">
                <div class="appearance-section-head"><div><h2 id="appearanceExceptionsTitle">单页例外</h2><p>没有列出来的页面都会自动跟随整个小屋。</p></div></div>
                <div class="appearance-add-exception"><select id="appearancePageSelect" aria-label="选择单独设置的页面"><option value="">选择一个页面…</option>${available.map(([key, name]) => `<option value="${escapeHtml(key)}">${escapeHtml(name)}</option>`).join('')}</select><button type="button" id="appearanceAddPage">添加</button></div>
                <div class="appearance-exception-list">${exceptionScopes.map(scope => `<article class="appearance-exception" data-exception="${escapeHtml(scope)}"><div class="appearance-exception-head"><strong>${escapeHtml(SeaTheme.pages[scope] || scope)}</strong><button type="button" data-exception-reset="${escapeHtml(scope)}">恢复跟随整屋</button></div><div class="appearance-wallpaper-grid">${slotMarkup(scope, 'day', true)}${slotMarkup(scope, 'night', true)}</div></article>`).join('')}</div>
                <button type="button" id="appearanceResetPages" class="appearance-reset-all"${Object.keys(settings.exceptions).length ? '' : ' hidden'}>✦ 全部恢复为跟随整屋</button>
            </section>
            <p id="appearanceStatus" class="appearance-status" role="status"></p>`;
    }
    function rangeMarkup(name, label, value, min, max, suffix) {
        return `<label class="appearance-range"><span>${label}<output id="appearance-${name}-value">${value}${suffix}</output></span><input type="range" min="${min}" max="${max}" value="${value}" data-appearance-range="${name}" data-suffix="${escapeHtml(suffix)}"></label>`;
    }
    async function paintSlot(scope, phase, wallpapers) {
        const key = slotKey(scope, phase), id = key.replace(/[^a-z0-9-]/gi, '-');
        const preview = document.getElementById(`preview-${id}`), source = document.getElementById(`source-${id}`);
        const remove = root.querySelector(`[data-wallpaper-remove="${key}"]`);
        if (!preview || !source) return;
        const stagedFile = staged.get(key);
        if (stagedFile) {
            preview.style.backgroundImage = `url("${previewUrl(stagedFile)}")`;
            source.textContent = `待确认 · ${stagedFile.name || '新图片'}`;
            remove.hidden = true;
            return;
        }
        const direct = wallpapers.direct[phase], resolved = wallpapers.resolved[phase];
        if (!document.getElementById(`preview-${id}`)) return;
        if (resolved?.blob) preview.style.backgroundImage = `url("${SeaTheme.wallpaperUrl(resolved)}")`;
        else preview.style.backgroundImage = `url("${fallback[phase]}")`;
        remove.hidden = !(direct instanceof Blob);
        if (direct instanceof Blob) source.textContent = '使用自己的图片';
        else if (scope !== 'global') source.textContent = resolved ? `跟随${resolved.phase === 'day' && phase === 'night' ? '白天壁纸' : '整个小屋'}` : '跟随整个小屋';
        else if (phase === 'night' && resolved?.phase === 'day') source.textContent = '未设置 · 沿用白天壁纸';
        else source.textContent = '小屋默认背景';
    }
    async function paintAllSlots() {
        releaseUrls();
        const slots = [...root.querySelectorAll('[data-wallpaper-slot]')];
        const scopes = [...new Set(slots.map(element => element.dataset.wallpaperSlot.split(':')[0]))];
        const inspections = new Map(await Promise.all(scopes.map(async scope => [scope, await SeaTheme.inspectWallpapers(scope)])));
        SeaTheme.setPreviewWallpaperKeys(new Set([...inspections.values()].flatMap(wallpapers => Object.values(wallpapers.resolved).map(wallpaper => wallpaper?.key).filter(Boolean))));
        await Promise.all(slots.map(element => {
            const [scope, phase] = element.dataset.wallpaperSlot.split(':');
            return paintSlot(scope, phase, inspections.get(scope));
        }));
    }
    async function render() { renderStructure(); await paintAllSlots(); }
    root.addEventListener('change', async event => {
        const input = event.target.closest('[data-wallpaper-file]');
        if (input) {
            const file = input.files?.[0], key = input.dataset.wallpaperFile;
            if (!file) return;
            if (!file.type.startsWith('image/')) return status('这不是图片文件。', true);
            if (file.size > 24 * 1024 * 1024) return status('图片请不要超过 24 MB。', true);
            staged.set(key, file);
            const row = root.querySelector(`[data-wallpaper-confirm-row="${key}"]`); if (row) row.hidden = false;
            await paintAllSlots(); status('先在小卡片里看看，满意后点「使用这张」。'); return;
        }
        const range = event.target.closest('[data-appearance-range]');
        if (range) commitRange(range);
    });
    root.addEventListener('input', event => { const range = event.target.closest('[data-appearance-range]'); if (range) previewRange(range); });
    function showRangeValue(range) {
        const name = range.dataset.appearanceRange, value = Number(range.value), suffix = range.dataset.suffix || '';
        document.getElementById(`appearance-${name}-value`).textContent = value + suffix;
        if (name === 'cardTransparency') document.getElementById('appearanceContrastHint').hidden = value < 72;
        return { name, value };
    }
    function previewRange(range) {
        const { name, value } = showRangeValue(range);
        pendingAdjustments[name] = value;
        if (previewFrame) return;
        previewFrame = requestAnimationFrame(() => {
            previewFrame = 0;
            const values = pendingAdjustments;
            pendingAdjustments = {};
            SeaTheme.previewAdjustments(values);
        });
    }
    function commitRange(range) {
        const { name, value } = showRangeValue(range);
        pendingAdjustments[name] = value;
        if (previewFrame) { cancelAnimationFrame(previewFrame); previewFrame = 0; }
        const values = pendingAdjustments;
        pendingAdjustments = {};
        SeaTheme.previewAdjustments(values);
        internalAdjustment = true;
        try { SeaTheme.setAdjustments(values); }
        finally { internalAdjustment = false; }
    }
    function syncAdjustmentControls(settings) {
        for (const range of root.querySelectorAll('[data-appearance-range]')) {
            const name = range.dataset.appearanceRange;
            if (!Object.prototype.hasOwnProperty.call(settings, name)) continue;
            range.value = settings[name];
            showRangeValue(range);
        }
    }
    root.addEventListener('click', async event => {
        const add = event.target.closest('#appearanceAddPage');
        if (add) {
            const select = document.getElementById('appearancePageSelect');
            if (!select.value) return status('先选一个想单独布置的页面。', true);
            draftException = select.value; staged.clear(); await render(); status(`可以为「${SeaTheme.pages[draftException]}」挑选自己的壁纸了。`); return;
        }
        const confirm = event.target.closest('[data-wallpaper-confirm]');
        if (confirm) {
            const key = confirm.dataset.wallpaperConfirm, file = staged.get(key); if (!file) return;
            const [scope, phase] = key.split(':'); confirm.disabled = true;
            try { await SeaTheme.saveWallpaper(scope, phase, file); staged.delete(key); draftException = ''; await render(); status('壁纸已经铺好啦。'); }
            catch (error) { confirm.disabled = false; status(error.message, true); }
            return;
        }
        const cancel = event.target.closest('[data-wallpaper-cancel]');
        if (cancel) { staged.delete(cancel.dataset.wallpaperCancel); await render(); status('没有更换，原来的壁纸还在。'); return; }
        const remove = event.target.closest('[data-wallpaper-remove]');
        if (remove) {
            const [scope, phase] = remove.dataset.wallpaperRemove.split(':');
            try { await SeaTheme.removeWallpaper(scope, phase); await render(); status(phase === 'night' ? '夜晚壁纸已恢复继承。' : '已经恢复默认壁纸。'); }
            catch (error) { status(error.message, true); }
            return;
        }
        const reset = event.target.closest('[data-exception-reset]');
        if (reset) {
            const scope = reset.dataset.exceptionReset;
            try { await Promise.all(['day', 'night'].map(phase => SeaTheme.removeWallpaper(scope, phase))); draftException = ''; await render(); status(`「${SeaTheme.pages[scope]}」重新跟随整个小屋。`); }
            catch (error) { status(error.message, true); }
            return;
        }
        if (event.target.closest('#appearanceResetPages')) {
            try { await SeaTheme.clearExceptions(); draftException = ''; staged.clear(); await render(); status('所有页面都重新跟随整个小屋。'); }
            catch (error) { status(error.message, true); }
        }
    });
    window.addEventListener('sea-appearance-change', event => {
        if (initialized && event.detail && !internalAdjustment) syncAdjustmentControls(event.detail);
    });
    function initialize() {
        if (document.body.dataset.view !== 'settings') {
            if (settingsActive) SeaTheme.setPreviewWallpaperKeys([]);
            settingsActive = false;
            return;
        }
        if (settingsActive) return;
        settingsActive = true;
        initialized = true;
        render().catch(error => status(error.message, true));
    }
    new MutationObserver(initialize).observe(document.body, { attributes: true, attributeFilter: ['data-view'] });
    initialize();
})();
