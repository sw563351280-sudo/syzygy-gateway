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

async function runProbe({ key, adapter, budget, fetchImpl = fetch, emit = console.log, nonce = require('node:crypto').randomUUID() }) {
    const results = [];
    for (const [index, suffix] of ['alpha', 'beta', 'beta'].entries()) {
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
        let usage = null;
        const wire = await response.text();
        if (wire.length > 1000000) throw new Error('unexpected_response_size');
        if (response.headers.get('content-type')?.includes('text/event-stream')) {
            for (const line of wire.split(/\r?\n/)) {
                if (!line.startsWith('data:')) continue;
                const data = line.slice(5).trim();
                if (!data || data === '[DONE]') continue;
                const event = JSON.parse(data);
                if (event.error) throw new Error('stream_error');
                usage = budget.mergeUsage(usage, event.usage);
            }
        } else {
            const data = JSON.parse(wire);
            if (data.error) throw new Error('provider_error');
            usage = data.usage;
        }
        const normalized = budget.normalizeUsage(usage);
        emit(JSON.stringify({ event: 'probe_usage', call: index + 1, usage: normalized, evidence: budget.usageEvidence(usage) }));
        results.push(normalized);
        if (!normalized || normalized.total === null || normalized.total > 3000 || normalized.output === null || normalized.output > 64 || normalized.read === null || normalized.write === null) {
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
    await runProbe({ key, adapter: require('/opt/syzygy/provider-cache'), budget: require('/opt/syzygy/context-budget') });
}
if (require.main === module || process.argv[1] === '-') main().catch(() => {
    // Never print provider response bodies, config, keys or raw exceptions.
    console.log(JSON.stringify({ event: 'probe_stopped', reason: 'safe_failure_no_retry' }));
    process.exitCode = 1;
});
module.exports = { selectKey, fixture, runProbe };
