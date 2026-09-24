'use strict';
(function (root) {
    // Keep the existing minimum context. Move the start only once the bounded
    // allowance is exhausted. Store an ID, never a second copy of conversation.
    function selectCacheHistory(messages, anchorId, minimum = 30, allowance = 8) {
        const found = anchorId ? messages.findIndex(m => m._id === anchorId) : -1;
        const remaining = found < 0 ? 0 : messages.length - found;
        const reuse = remaining >= minimum && remaining <= minimum + allowance;
        const start = reuse ? found : Math.max(0, messages.length - minimum);
        const selected = messages.slice(start);
        return { messages: selected, anchorId: selected[0]?._id || null };
    }
    function isCacheHistoryRoute(url, model) {
        if (!/^claude-/i.test(model || '')) return false;
        try { return new URL(url, 'https://local.invalid').pathname.startsWith('/via/aihubmix/'); }
        catch (_) { return false; }
    }
    function cachedChatHistory(messages, sessionId, url, model, storage) {
        if (!isCacheHistoryRoute(url, model)) return messages.slice(-30);
        const key = 'syzygy-cache-history-v1:' + JSON.stringify([sessionId, url, model]);
        let anchor = null;
        try { anchor = storage.getItem(key); } catch (_) {}
        const result = selectCacheHistory(messages, anchor);
        try {
            if (result.anchorId) storage.setItem(key, result.anchorId);
            else storage.removeItem(key);
        } catch (_) {}
        return result.messages;
    }
    const api = { selectCacheHistory, isCacheHistoryRoute, cachedChatHistory };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
