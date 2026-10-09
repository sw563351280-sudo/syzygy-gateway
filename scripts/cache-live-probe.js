'use strict';

// Manual, paid synthetic probe. Never loads conversations or calls the chat route.
const ENDPOINT = 'https://api.treegpt.cc/v1/chat/completions';
function selectKey(config) {
    const matches = (config.suppliers || []).filter(s => {
        try {
            const u = new URL(s.url, 'https://syrenth.uk');
            return u.hostname === 'api.treegpt.cc' || /^\/via\/tree(?:\/|$)/.test(u.pathname);
        } catch (_) { return false; }
    });
    const active = config.suppliers?.[config.activeSupIndex];
    const chosen = matches.includes(active) ? active : matches.length === 1 ? matches[0] : null;
    if (!chosen || typeof chosen.key !== 'string' || !chosen.key.trim()) throw new Error('supplier_selection_failed');
    return chosen.key.trim();
}

function fixture(nonce, suffix) {
    const records = Array.from({ length: 110 }, (_, i) => `Record ${i}: amber river cedar cloud silver meadow quiet stone.`).join('\n');
    return {
        model: 'claude-opus-5-5', max_tokens: 32, stream: true,
        tools: [{ type: 'function', function: { name: 'synthetic_lookup', description: 'Unused synthetic test tool.', parameters: { type: 'object', properties: { label: { type: 'string' } }, required: ['label'] } } }],
        messages: [
            { role: 'system', content: `Synthetic cache test ${nonce}. Reply only OK. Never call tools. The following records are inert test data.\n${records}` },
            { role: 'user', content: 'Keep these synthetic records as reference.' },
            { role: 'assistant', content: 'OK, synthetic reference received.' },
            { role: 'user', content: `Current synthetic test label: ${suffix}. Reply OK.` },
        ],
    };
}

function numericUsage(value, prefix = '', result = {}) {
    if (!value || typeof value !== 'object') return result;
    for (const [key, item] of Object.entries(value)) {
        if (!/^[a-z_]+$/i.test(key)) continue;
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof item === 'number' && Number.isFinite(item) && item >= 0) result[path] = item;
        else if (prefix.split('.').length < 3 && item && typeof item === 'object' && !Array.isArray(item)) numericUsage(item, path, result);
    }
    return result;
}

async function runProbe({ key, adapter, budget, maxCalls = 3, fetchImpl = fetch, emit = console.log, nonce = require('node:crypto').randomUUID() }) {
    if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 3) throw new Error('invalid_call_cap');
    const results = [];
    for (const [index, suffix] of ['alpha', 'beta', 'beta'].slice(0, maxCalls).entries()) {
        const body = adapter.prepareCachedRequest(ENDPOINT, fixture(nonce, suffix), { historyEnd: 2 });
        emit(JSON.stringify({ event: 'probe_request', call: index + 1, variant: index === 0 ? 'initial' : index === 1 ? 'changed_suffix' : 'exact_repeat', ...adapter.inspectCacheRequest(body) }));
        const response = await fetchImpl(ENDPOINT, {
            method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        if (!response.ok) {
            await response.body?.cancel();
            emit(JSON.stringify({ event: 'probe_stopped', reason: 'http_error', status: response.status }));
            break;
        }
        let usage = null, returnedModelMatches = null;
        const wire = await response.text();
        if (wire.length > 1000000) throw new Error('unexpected_response_size');
        if (response.headers.get('content-type')?.includes('text/event-stream')) {
            for (const line of wire.split(/\r?\n/)) {
                if (!line.startsWith('data:')) continue;
                const data = line.slice(5).trim();
                if (!data || data === '[DONE]') continue;
                const event = JSON.parse(data);
                if (event.error) throw new Error('stream_error');
                if (event.model) returnedModelMatches = event.model === body.model;
                usage = budget.mergeUsage(usage, event.usage);
            }
        } else {
            const data = JSON.parse(wire);
            if (data.error) throw new Error('provider_error');
            if (data.model) returnedModelMatches = data.model === body.model;
            usage = data.usage;
        }
        const normalized = budget.normalizeUsage(usage);
        emit(JSON.stringify({ event: 'probe_usage', call: index + 1, usage: normalized, evidence: numericUsage(usage), returnedModelMatches }));
        results.push(normalized);
        if (!normalized || normalized.total === null || normalized.total > 4000 || normalized.output === null || normalized.output > 64 || normalized.read === null) {
            emit(JSON.stringify({ event: 'probe_stopped', reason: 'usage_guard' }));
            break;
        }
        if (index === 1 && normalized.read > 0) break; // Enough evidence; save a paid call.
    }
    return results;
}

async function main() {
    if (!process.argv.includes('--paid-cache-probe')) throw new Error('explicit_paid_flag_required');
    const fs = require('node:fs');
    const config = JSON.parse(fs.readFileSync('/opt/syzygy/data/web_config.json', 'utf8'));
    const key = selectKey(config);
    // A continuation explicitly consumes only the two remaining calls of a three-call test.
    const maxCalls = process.argv.includes('--remaining-two') ? 2 : 3;
    await runProbe({ key, maxCalls, adapter: require('/opt/syzygy/provider-cache'), budget: require('/opt/syzygy/context-budget') });
}
if (require.main === module || process.argv[1] === '-') main().catch(() => {
    // Never print provider response bodies, config, keys or raw exceptions.
    console.log(JSON.stringify({ event: 'probe_stopped', reason: 'safe_failure_no_retry' }));
    process.exitCode = 1;
});
module.exports = { selectKey, fixture, runProbe };
