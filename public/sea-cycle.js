/* Every page's sea follows Shanghai time, including while a page stays open. */
(function (root) {
    'use strict';
    const offset = 8 * 60 * 60 * 1000;
    function phaseAt(now = Date.now()) {
        const hour = new Date(Number(now) + offset).getUTCHours();
        return hour >= 7 && hour < 18 ? 'day' : 'night';
    }
    function nextBoundary(now = Date.now()) {
        const local = new Date(Number(now) + offset);
        const hour = local.getUTCHours();
        return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + (hour >= 18 ? 1 : 0), hour < 7 || hour >= 18 ? 7 : 18) - offset;
    }
    if (typeof module === 'object' && module.exports) module.exports = { phaseAt, nextBoundary };
    if (!root?.document) return;
    let timer;
    function update() {
        const now = Date.now(), phase = phaseAt(now), html = root.document.documentElement;
        if (html.dataset.seaCycle !== phase) {
            html.dataset.seaCycle = phase;
            root.dispatchEvent(new Event('sea-cycle-change'));
        }
        clearTimeout(timer);
        timer = setTimeout(update, Math.max(100, nextBoundary(now) - now + 50));
        return phase;
    }
    root.SeaCycle = Object.freeze({ phaseAt, nextBoundary, update });
    update();
    root.addEventListener('focus', update);
    root.document.addEventListener('visibilitychange', () => { if (!root.document.hidden) update(); });
})(typeof window === 'undefined' ? null : window);
