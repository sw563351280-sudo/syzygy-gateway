'use strict';

const { randomUUID } = require('node:crypto');
const { inspectCacheRequest, inspectWireRequest, supportsBlockCache } = require('./provider-cache');
const { createToolSchemaTracker } = require('./tool-schema-cache');
const toolSchemaTracker = createToolSchemaTracker();

// Input projection only. Never edits persisted messages or summary cursors.
function composeContext({ systemMessage, summaryMessages = [], historyMessages = [], currentMessage }) {
    return [systemMessage, ...summaryMessages, ...historyMessages, currentMessage].filter(Boolean);
}

function estimateText(text) {
    const value = String(text || '');
    const cjk = (value.match(/[\u4e00-\u9fff]/g) || []).length;
    return cjk + Math.ceil((value.length - cjk) / 4);
}

function measureMessages(messages = []) {
    let textTokens = 0, mediaBlocks = 0;
    for (const message of messages) {
        if (typeof message.content === 'string') textTokens += estimateText(message.content);
        else for (const block of message.content || []) {
            if (typeof block.text === 'string') textTokens += estimateText(block.text);
            else mediaBlocks++;
        }
        if (message.tool_calls) textTokens += estimateText(JSON.stringify(message.tool_calls));
    }
    return { textTokens, mediaBlocks };
}

const count = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

function mergeUsage(previous, incoming) {
    if (!incoming || typeof incoming !== 'object') return previous || null;
    const merged = { ...previous };
    for (const [key, value] of Object.entries(incoming)) {
        if (value == null) continue;
        merged[key] = value && typeof value === 'object' && !Array.isArray(value)
            ? mergeUsage(previous?.[key], value) : value;
    }
    return merged;
}

function cacheState(usage) {
    if (usage?.read > 0) return 'hit';
    if (usage?.write > 0) return 'written';
    if (usage?.read === 0 && usage?.write === 0) return 'no_cache';
    return 'unknown';
}

// Numeric usage evidence only. Missing fields are left absent, not invented as zero.
function usageEvidence(usage = {}) {
    const result = {};
    for (const key of ['input_tokens', 'prompt_tokens', 'output_tokens', 'completion_tokens',
        'cache_read_input_tokens', 'cache_creation_input_tokens', 'prompt_cache_hit_tokens', 'prompt_cache_miss_tokens']) {
        if (count(usage?.[key]) !== null) result[key] = usage[key];
    }
    for (const parent of ['prompt_tokens_details', 'cache_creation']) {
        for (const key of ['cached_tokens', 'cache_read_input_tokens', 'cache_write_tokens', 'cache_creation_tokens',
            'cache_creation_input_tokens', 'ephemeral_5m_input_tokens', 'ephemeral_1h_input_tokens']) {
            if (count(usage?.[parent]?.[key]) !== null) result[`${parent}.${key}`] = usage[parent][key];
        }
    }
    return result;
}

// Missing fields remain unknown. Anthropic input_tokens excludes cached tokens;
// Chat Completions prompt_tokens includes them. Never add reasoning to output twice.
function normalizeUsage(usage) {
    if (!usage || typeof usage !== 'object') return null;
    const native = count(usage.input_tokens) !== null && count(usage.prompt_tokens) === null;
    const read = count(usage.cache_read_input_tokens ?? usage.prompt_tokens_details?.cached_tokens
        ?? usage.prompt_tokens_details?.cache_read_input_tokens ?? usage.prompt_cache_hit_tokens);
    const details = usage.prompt_tokens_details;
    const cache5m = count(usage.cache_creation?.ephemeral_5m_input_tokens);
    const cache1h = count(usage.cache_creation?.ephemeral_1h_input_tokens);
    const write = count(usage.cache_creation_input_tokens ?? details?.cache_write_tokens
        ?? details?.cache_creation_tokens ?? details?.cache_creation_input_tokens
        ?? (cache5m !== null && cache1h !== null ? cache5m + cache1h : null));
    const input = count(native ? usage.input_tokens : usage.prompt_tokens);
    const output = count(native ? usage.output_tokens : usage.completion_tokens);
    const uncached = native ? input : input !== null && read !== null && write !== null ? count(input - read - write) : null;
    const total = native ? (input !== null && read !== null && write !== null ? input + read + write : null) : input;
    return { total, uncached, read, write, output };
}

function estimateCost(usage, rates) {
    if (!usage || !rates) return null;
    // Opt in ONLY when this exact channel bills all input at one flat rate.
    if (rates.billing === 'flat') {
        if ([usage.total, usage.output, rates.input, rates.output].some(v => count(v) === null)) return null;
        const usd = (usage.total * rates.input + usage.output * rates.output) / 1e6;
        return { usd, cny: count(rates.usdToCny) === null ? null : usd * rates.usdToCny };
    }
    const fields = { uncached: 'input', read: 'read', write: 'write', output: 'output' };
    let usd = 0;
    for (const [field, rate] of Object.entries(fields)) {
        if (count(usage[field]) === null || count(rates[rate]) === null) return null;
        usd += usage[field] * rates[rate] / 1e6;
    }
    return { usd, cny: count(rates.usdToCny) === null ? null : usd * rates.usdToCny };
}

function readConfig(env = process.env) {
    // Published AIHubMix Opus 4.6 prices, checked 2026-09-24; CNY is an estimate.
    // Exact host + exact model only. Never apply these to subscription/relay routes.
    const defaults = {};
    for (const model of ['claude-opus-4-6', 'claude-opus-4-6-think']) {
        defaults[`aihubmix.com|${model}`] = { input: 5, read: 0.5, write: 10, output: 25, usdToCny: 7 };
    }
    let rates = {};
    try { rates = JSON.parse(env.CONTEXT_BUDGET_RATES_JSON || '{}'); } catch (_) { /* Unknown pricing, never guess. */ }
    return {
        // Passive numeric logging is safe to keep on. It can be disabled explicitly.
        enabled: String(env.CONTEXT_BUDGET_MODE || 'observe').toLowerCase() !== 'off',
        targetCny: Number(env.CONTEXT_BUDGET_TARGET_CNY) > 0 ? Number(env.CONTEXT_BUDGET_TARGET_CNY) : 0.08,
        historyTokens: Number(env.CONTEXT_BUDGET_HISTORY_TOKENS) > 0 ? Number(env.CONTEXT_BUDGET_HISTORY_TOKENS) : 12000,
        rates: { ...defaults, ...(rates && typeof rates === 'object' && !Array.isArray(rates) ? rates : {}) },
    };
}

function createBudgetObserver({ endpoint, model, conversationId = null, clientCacheVersion = null, config = readConfig(), log = value => console.log('[ContextBudget]', JSON.stringify(value)) }) {
    const noop = { context() {}, request() { return null; }, response() {}, finish() {} };
    if (!config.enabled) return noop;
    let host;
    try { host = new URL(endpoint).host; } catch (_) { return noop; }
    const turnId = randomUUID();
    const calls = new Map();
    let sequence = 0;
    let finished = false, outcome = null;
    const group = values => {
        const priced = values.filter(v => v.cost);
        const cny = priced.filter(v => v.cost.cny !== null);
        return { calls: values.length, pricedCalls: priced.length, unknownCalls: values.length - priced.length,
            complete: values.every(v => v.cost !== null), completeCny: values.every(v => v.cost?.cny != null),
            knownUsd: priced.reduce((s, v) => s + v.cost.usd, 0),
            knownCny: cny.length ? cny.reduce((s, v) => s + v.cost.cny, 0) : null };
    };
    const totals = () => {
        const values = [...calls.values()], all = group(values);
        return { ...all, finished, outcome, targetCny: config.targetCny,
            overTarget: all.knownCny === null ? null : all.knownCny > config.targetCny,
            chat: group(values.filter(v => v.kind === 'chat')),
            summary: group(values.filter(v => v.kind === 'summary')) };
    };
    // Diagnostics must never interrupt a chat, including a failing log sink.
    const emit = event => { try { log({ turnId, host, model, clientCacheVersion, ...event }); } catch (_) {} };
    return {
        context({ systemMessage, summaryMessages = [], historyMessages = [], currentMessage, historySource }) {
            const history = measureMessages(historyMessages);
            const textLength = m => typeof m?.content === 'string' ? m.content.length
                : (m?.content || []).reduce((n, b) => n + (typeof b.text === 'string' ? b.text.length : 0), 0);
            emit({ event: 'context', estimatesOnly: true,
                historySource,
                historyDetail: { count: historyMessages.length, characters: historyMessages.reduce((n, m) => n + textLength(m), 0),
                    longest: historyMessages.map((m, index) => ({ index, role: m.role, characters: textLength(m),
                        textTokens: measureMessages([m]).textTokens })).sort((a, b) => b.characters - a.characters).slice(0, 3) },
                summaryCharacters: summaryMessages.reduce((n, m) => n + textLength(m), 0),
                stable: measureMessages([systemMessage].filter(Boolean)),
                summary: measureMessages(summaryMessages), history,
                currentWithDynamic: measureMessages([currentMessage].filter(Boolean)),
                compactSuggested: history.textTokens >= config.historyTokens,
            });
        },
        request(body, source = {}) {
            const id = ++sequence;
            let callHost = host;
            try { if (source.endpoint) callHost = new URL(source.endpoint).host; } catch (_) { callHost = 'unknown'; }
            const callModel = source.model || model;
            const kind = source.kind === 'summary' ? 'summary' : 'chat';
            calls.set(id, { cost: null, host: callHost, model: callModel, kind });
            const toolSchema = kind === 'chat' && supportsBlockCache(source.endpoint || endpoint, callModel)
                ? { ...toolSchemaTracker.compare([callHost, callModel, conversationId || turnId], body.tools || []),
                    scope: conversationId ? 'conversation' : 'turn' } : null;
            emit({ event: 'request', call: id, kind, callHost, callModel, turn: totals(), estimatesOnly: true,
                toolSchema,
                wire: inspectWireRequest(source.endpoint || endpoint, body),
                messages: measureMessages(body.messages),
                toolTokens: estimateText(JSON.stringify(body.tools || [])),
                toolCount: (body.tools || []).length,
                cacheRequest: inspectCacheRequest(body),
            });
            return id;
        },
        response(id, rawUsage) {
            if (!calls.has(id)) return;
            const entry = calls.get(id);
            const rates = config.rates[`${entry.host}|${entry.model}`];
            const usage = normalizeUsage(rawUsage);
            const cost = estimateCost(usage, rates);
            entry.cost = cost;
            emit({ event: 'usage', call: id, kind: entry.kind, callHost: entry.host, callModel: entry.model,
                usage, cacheState: cacheState(usage),
                usageEvidence: usageEvidence(rawUsage), estimatedCost: cost,
                unknownReason: cost ? null : !rates ? 'price_unconfigured' : 'usage_or_rates_incomplete',
                turn: totals(),
            });
        },
        finish(reason = 'completed') {
            if (finished) return;
            finished = true; outcome = reason;
            if (calls.size) emit({ event: 'turn_finished', turn: totals() });
        },
    };
}

module.exports = { composeContext, measureMessages, normalizeUsage, estimateCost, readConfig, createBudgetObserver,
    mergeUsage, cacheState, usageEvidence };
