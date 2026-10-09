'use strict';
(function (root) {
    // Default to the user's original 30-message window, without extra history.
    function selectCacheHistory(messages, anchorId, minimum = 30, allowance = 0) {
        const found = anchorId ? messages.findIndex(m => m._id === anchorId) : -1;
        const remaining = found < 0 ? 0 : messages.length - found;
        const reuse = remaining >= minimum && remaining <= minimum + allowance;
        const start = reuse ? found : Math.max(0, messages.length - minimum);
        const selected = messages.slice(start);
        return { messages: selected, anchorId: selected[0]?._id || null };
    }
    function isCacheHistoryRoute(url, model) {
        if (!/^claude-/i.test(model || '')) return false;
        try { return /^\/via\/(aihubmix|tree)\//.test(new URL(url, 'https://local.invalid').pathname); }
        catch (_) { return false; }
    }
    function cachedChatHistory(messages, sessionId, url, model, storage) {
        if (!isCacheHistoryRoute(url, model)) return messages.slice(-30);
        const key = 'syzygy-cache-history-v1:' + JSON.stringify([sessionId, url, model]);
        let anchor = null;
        try { anchor = storage.getItem(key); } catch (_) {}
        // Keep the same starting message for several turns instead of evicting
        // the first pair on every send. Bound the fallback window to 38 messages.
        const result = selectCacheHistory(messages, anchor, 30, 8);
        try {
            if (result.anchorId) storage.setItem(key, result.anchorId);
            else storage.removeItem(key);
        } catch (_) {}
        return result.messages;
    }
    async function canUseRollingContext(url, model, fetchImpl) {
        if (!isCacheHistoryRoute(url, model)) return false;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        try {
            const response = await fetchImpl('/api/context-budget/capabilities', { cache: 'no-store', signal: controller.signal });
            if (!response.ok) return false;
            const status = await response.json();
            const route = new URL(url, 'https://local.invalid').pathname.split('/')[2];
            if (route === 'tree' && !status.cacheRoutes?.includes('tree')) return false;
            return status.version === 1 && status.rollingSummary === true;
        } catch (_) { return false; } finally { clearTimeout(timeout); }
    }
    const api = { selectCacheHistory, isCacheHistoryRoute, cachedChatHistory, canUseRollingContext };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
