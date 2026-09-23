'use strict';

const { randomUUID } = require('node:crypto');

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

// Missing fields remain unknown. Anthropic input_tokens excludes cached tokens;
// Chat Completions prompt_tokens includes them. Never add reasoning to output twice.
function normalizeUsage(usage) {
    if (!usage || typeof usage !== 'object') return null;
    const native = count(usage.input_tokens) !== null && count(usage.prompt_tokens) === null;
    const read = count(usage.cache_read_input_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens);
    const write = count(usage.cache_creation_input_tokens ?? usage.prompt_tokens_details?.cache_write_tokens);
    const input = count(native ? usage.input_tokens : usage.prompt_tokens);
    const output = count(native ? usage.output_tokens : usage.completion_tokens);
    const uncached = native ? input : input !== null && read !== null && write !== null ? count(input - read - write) : null;
    const total = native ? (input !== null && read !== null && write !== null ? input + read + write : null) : input;
    return { total, uncached, read, write, output };
}

function estimateCost(usage, rates) {
    if (!usage || !rates) return null;
    const fields = { uncached: 'input', read: 'read', write: 'write', output: 'output' };
    let usd = 0;
    for (const [field, rate] of Object.entries(fields)) {
        if (count(usage[field]) === null || count(rates[rate]) === null) return null;
        usd += usage[field] * rates[rate] / 1e6;
    }
    return { usd, cny: count(rates.usdToCny) === null ? null : usd * rates.usdToCny };
}

function readConfig(env = process.env) {
    let rates = {};
    try { rates = JSON.parse(env.CONTEXT_BUDGET_RATES_JSON || '{}'); } catch (_) { /* Unknown pricing, never guess. */ }
    return {
        enabled: env.CONTEXT_BUDGET_MODE === 'observe',
        targetCny: Number(env.CONTEXT_BUDGET_TARGET_CNY) > 0 ? Number(env.CONTEXT_BUDGET_TARGET_CNY) : 0.08,
        historyTokens: Number(env.CONTEXT_BUDGET_HISTORY_TOKENS) > 0 ? Number(env.CONTEXT_BUDGET_HISTORY_TOKENS) : 12000,
        rates: rates && typeof rates === 'object' && !Array.isArray(rates) ? rates : {},
    };
}

function createBudgetObserver({ endpoint, model, config = readConfig(), log = value => console.log('[ContextBudget]', JSON.stringify(value)) }) {
    const noop = { context() {}, request() { return null; }, response() {} };
    if (!config.enabled) return noop;
    let host;
    try { host = new URL(endpoint).host; } catch (_) { return noop; }
    const turnId = randomUUID();
    const calls = new Map();
    let sequence = 0;
    const rates = config.rates[`${host}|${model}`];
    // Diagnostics must never interrupt a chat, including a failing log sink.
    const emit = event => { try { log({ turnId, host, model, ...event }); } catch (_) {} };
    return {
        context({ systemMessage, summaryMessages = [], historyMessages = [], currentMessage }) {
            const history = measureMessages(historyMessages);
            emit({ event: 'context', estimatesOnly: true,
                stable: measureMessages([systemMessage].filter(Boolean)),
                summary: measureMessages(summaryMessages), history,
                currentWithDynamic: measureMessages([currentMessage].filter(Boolean)),
                compactSuggested: history.textTokens >= config.historyTokens,
            });
        },
        request(body) {
            const id = ++sequence;
            calls.set(id, null);
            emit({ event: 'request', call: id, estimatesOnly: true,
                messages: measureMessages(body.messages),
                toolTokens: estimateText(JSON.stringify(body.tools || [])),
                toolCount: (body.tools || []).length,
            });
            return id;
        },
        response(id, rawUsage) {
            if (!calls.has(id)) return;
            const usage = normalizeUsage(rawUsage);
            const cost = estimateCost(usage, rates);
            calls.set(id, cost);
            const values = [...calls.values()];
            const complete = values.every(value => value !== null);
            const knownUsd = values.reduce((sum, value) => sum + (value?.usd || 0), 0);
            const knownCny = count(rates?.usdToCny) === null ? null : knownUsd * rates.usdToCny;
            emit({ event: 'usage', call: id, usage, estimatedCost: cost,
                turn: { calls: calls.size, pricedCalls: values.filter(Boolean).length, complete,
                    knownUsd, knownCny, targetCny: config.targetCny,
                    overTarget: knownCny === null ? null : knownCny > config.targetCny },
            });
        },
    };
}

module.exports = { composeContext, measureMessages, normalizeUsage, estimateCost, readConfig, createBudgetObserver };
