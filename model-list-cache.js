'use strict';

function createModelListCache(options = {}) {
    const freshMs = Math.max(0, Number(options.freshMs) || 5 * 60 * 1000);
    const maxAgeMs = Math.max(freshMs, Number(options.maxAgeMs) || 24 * 60 * 60 * 1000);
    const maxEntries = Math.max(1, Number(options.maxEntries) || 40);
    const now = typeof options.now === 'function' ? options.now : Date.now;
    const onRefreshError = typeof options.onRefreshError === 'function' ? options.onRefreshError : () => {};
    const entries = new Map();
    const inFlight = new Map();

    function prune() {
        while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
    }

    function refresh(key, loader) {
        if (inFlight.has(key)) return inFlight.get(key);
        const pending = Promise.resolve()
            .then(loader)
            .then(data => {
                entries.delete(key);
                entries.set(key, { data, updatedAt: now() });
                prune();
                return data;
            })
            .finally(() => inFlight.delete(key));
        inFlight.set(key, pending);
        return pending;
    }

    async function get(key, loader) {
        const cached = entries.get(key);
        const ageMs = cached ? Math.max(0, now() - cached.updatedAt) : Infinity;
        if (cached && ageMs <= freshMs) {
            return { data: cached.data, cache: 'fresh', ageMs };
        }
        if (cached && ageMs <= maxAgeMs) {
            refresh(key, loader).catch(error => onRefreshError(error, key));
            return { data: cached.data, cache: 'stale', ageMs };
        }
        if (cached) entries.delete(key);
        const data = await refresh(key, loader);
        return { data, cache: 'miss', ageMs: 0 };
    }

    return {
        get,
        diagnostics() {
            return { entries: entries.size, inFlight: inFlight.size };
        },
    };
}

async function fetchModelList(fetchImpl, options) {
    const response = await fetchImpl(options.targetUrl, {
        headers: { 'Authorization': `Bearer ${options.apiKey}` },
        signal: AbortSignal.timeout(options.timeoutMs),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
        const detail = data?.error?.message || data?.error || `HTTP ${response.status}`;
        throw new Error(`供应商返回错误: ${detail}`);
    }
    if (!Array.isArray(data?.data) || !data.data.length) throw new Error('供应商未返回模型列表');
    return data;
}

module.exports = { createModelListCache, fetchModelList };
