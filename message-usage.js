'use strict';
// Per-call snapshots are replaced, never added twice when streaming usage updates.
function createMessageUsage(now = Date.now) {
    const started = now(), calls = new Map();
    return event => {
        if (!['request', 'usage'].includes(event.event)) return null;
        if (event.event === 'request') calls.set(event.call, null);
        else calls.set(event.call, event.usage || null);
        if (event.event !== 'usage') return null;
        const values = [...calls.values()];
        const sum = key => values.every(v => Number.isFinite(v?.[key]))
            ? values.reduce((n, v) => n + v[key], 0) : null;
        return { total: sum('total'), read: sum('read'), write: sum('write'), output: sum('output'),
            calls: calls.size, elapsedMs: Math.max(0, now() - started) };
    };
}
module.exports = { createMessageUsage };
