'use strict';
// Read-only; export only approved numeric cache metadata, never raw log lines.
const { execFileSync } = require('node:child_process');
const numbers = (value, keys) => Object.fromEntries(keys.filter(k => typeof value?.[k] === 'number').map(k => [k, value[k]]));
function safeEvent(line) {
    const at = new Date(Number(line.__REALTIME_TIMESTAMP) / 1000).toISOString();
    const message = String(line.MESSAGE || '');
    const marker = '[ContextBudget] ';
    const start = message.indexOf(marker);
    if (start >= 0) {
        let e;
        try { e = JSON.parse(message.slice(start + marker.length)); } catch { return null; }
        const result = { at, event: e.event, turnId: e.turnId, call: e.call,
            kind: e.kind, host: e.callHost || e.host, model: e.callModel || e.model, clientCacheVersion: e.clientCacheVersion };
        if (e.event === 'request') Object.assign(result, {
            breakpoints: (e.cacheRequest?.breakpoints || []).map(p => ({ ...numbers(p, ['message', 'block']), role: p.role, placement: p.placement, ttl: p.ttl })),
            includeUsage: e.cacheRequest?.includeUsage === true,
            toolSchema: e.toolSchema ? { state: e.toolSchema.state, scope: e.toolSchema.scope, ...numbers(e.toolSchema, ['count', 'added', 'removed', 'definitionsChanged']) } : null,
            wire: e.wire ? {
                strategy: e.wire.strategy,
                messageCount: e.wire.messageCount,
                roles: Array.isArray(e.wire.roles) ? e.wire.roles.filter(role => ['system', 'user', 'assistant', 'tool'].includes(role)) : [],
                toolCount: e.wire.toolCount,
                breakpoints: (e.wire.breakpoints || []).map(p => ({ ...numbers(p, ['message', 'block']), role: p.role, placement: p.placement, ttl: p.ttl })),
                cachedSpanState: ['first', 'stable', 'changed'].includes(e.wire.cachedSpanState) ? e.wire.cachedSpanState : null,
                cachedSpan: e.wire.stablePrefix ? {
                    ...numbers(e.wire.stablePrefix, ['messages', 'bytes']),
                    fingerprint: typeof e.wire.stablePrefix.fingerprint === 'string' && /^[a-f0-9]{16}$/.test(e.wire.stablePrefix.fingerprint)
                        ? e.wire.stablePrefix.fingerprint : null,
                } : null,
                stablePrefix: e.wire.stablePrefix ? numbers(e.wire.stablePrefix, ['messages', 'bytes']) : null,
                suffix: e.wire.suffix ? numbers(e.wire.suffix, ['messages', 'bytes']) : null,
                requestOptions: e.wire.requestOptions ? { keys: Array.isArray(e.wire.requestOptions.keys) ? e.wire.requestOptions.keys.filter(k => /^[a-z_]+$/.test(k)) : [] } : null,
            } : null,
            messages: numbers(e.messages, ['textTokens', 'mediaBlocks']), ...numbers(e, ['toolCount', 'toolTokens']) });
        else if (e.event === 'context') {
            for (const key of ['stable', 'history', 'summary', 'currentWithDynamic']) result[key] = numbers(e[key], ['textTokens', 'mediaBlocks']);
            result.historySource = numbers(e.historySource, ['receivedMessages', 'mergedHistoryMessages', 'projectedMessages']);
        } else if (e.event === 'usage') Object.assign(result, { usage: numbers(e.usage, ['total', 'uncached', 'read', 'write', 'output']),
            usageEvidence: Object.fromEntries(Object.entries(e.usageEvidence || {}).filter(([k, v]) => /tokens/.test(k) && typeof v === 'number')), cacheState: e.cacheState });
        else if (e.event === 'summary') Object.assign(result, { state: e.state, ...numbers(e, ['rawTokens', 'batchCount', 'coveredCount', 'tailCount']) });
        else return null;
        return result;
    }
    if (message.includes('[CacheOpt]') || message.includes('[CacheOpt-web]')) return {
        at, event: 'prefix', stableHash: message.match(/stableHash=([a-f0-9]+)/)?.[1],
        historyTokens: Number(message.match(/historyTokens≈(\d+)/)?.[1]) || null };
    if (message.includes('已注入实时数据，跳过账本 function calling')) return { at, event: 'ledger_tools_removed' };
    const historyMarker = '[CacheHistoryWindow] ';
    if (message.includes(historyMarker)) {
        try {
            const value = JSON.parse(message.slice(message.indexOf(historyMarker) + historyMarker.length));
            return { at, event: 'history_window', state: ['anchored', 'reused', 'rotated', 'reset', 'unverified'].includes(value.state) ? value.state : 'unknown', ...numbers(value, ['retained', 'messages']) };
        } catch { return null; }
    }
    return null;
}
if (require.main === module || process.argv[1] === '-') {
    try {
        const revision = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: '/opt/syzygy', encoding: 'utf8' }).trim();
        console.log(JSON.stringify({ event: 'runtime', revision, adapter: require('/opt/syzygy/provider-cache').cacheAdapterStatus() }));
        // Verify deployed public code without exporting source or private configuration.
        const fs = require('node:fs');
        const assets = {};
        for (const name of ['index.html', 'script.js', 'cache-history.js']) {
            const relative = `public/${name}`;
            const actual = fs.readFileSync(`/opt/syzygy/${relative}`, 'utf8');
            const committed = execFileSync('git', ['show', `HEAD:${relative}`], { cwd: '/opt/syzygy', encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
            assets[name] = { matchesDeployedCommit: actual === committed };
            if (name === 'index.html') assets[name].loadsCacheV2 = actual.includes('script.js?v=20261009-cache-v2');
            if (name === 'script.js') assets[name].sendsCacheV2 = actual.includes('cacheClientVersion: 2') && actual.includes('cacheClientVersion:2');
        }
        console.log(JSON.stringify({ event: 'frontend_assets', assets }));
        const raw = execFileSync('journalctl', ['-u', 'syzygy.service', '--since', '2 hours ago', '-n', '20000', '--no-pager', '-o', 'json'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
        const events = [];
        for (const row of raw.split('\n')) {
            if (!row.trim()) continue;
            try { const event = safeEvent(JSON.parse(row)); if (event) events.push(event); } catch { /* Ignore malformed records. */ }
        }
        for (const event of events.slice(-160)) console.log(JSON.stringify(event));
    } catch { console.error('Cache diagnostics failed; raw command output suppressed.'); process.exitCode = 1; }
}
module.exports = { safeEvent };
