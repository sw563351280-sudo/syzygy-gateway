'use strict';
const crypto = require('node:crypto');
const { stableToolSchema } = require('./tool-schema-cache');
const CACHE_TTL = '1h';

// AIHubMix documents content-block cache_control on Chat Completions:
// https://docs.aihubmix.com/en/practices/prompt-caching
const AIHUBMIX_HOSTS = new Set(['aihubmix.com', 'api.aihubmix.com', 'api.inferera.com']);
// TreeGPT uses the New API Chat Completions -> Claude content-block conversion.
const TREEGPT_HOST = 'api.treegpt.cc';
const BLOCK_CACHE_HOSTS = new Set([...AIHUBMIX_HOSTS, TREEGPT_HOST]);

function cacheHost(endpoint) {
    try { return new URL(endpoint).hostname; } catch (_) { return null; }
}

function supportsBlockCache(endpoint, model) {
    const host = cacheHost(endpoint);
    return host !== null && new URL(endpoint).protocol === 'https:' && BLOCK_CACHE_HOSTS.has(host)
        && /^claude-/i.test(model || '');
}

// TreeGPT's OpenAI-compatible Claude translation has demonstrated a stable
// system/tools prefix hit. Do not ask it to translate a second historical
// breakpoint until that behavior is explicitly validated upstream.
function cacheStrategy(endpoint, model, { historyBreakpoint = false } = {}) {
    if (!supportsBlockCache(endpoint, model)) return 'none';
    if (cacheHost(endpoint) === TREEGPT_HOST) return historyBreakpoint ? 'tree-history-experiment-v1' : 'tree-system-tools-v1';
    return 'content-history-v1';
}

function digest(value) {
    return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

function contentSize(value) {
    try { return Buffer.byteLength(JSON.stringify(value), 'utf8'); } catch (_) { return 0; }
}

function selectedRequestOptions(body) {
    const options = {};
    for (const key of ['max_tokens', 'max_completion_tokens', 'stream', 'temperature', 'top_p', 'top_k',
        'thinking', 'tool_choice', 'parallel_tool_calls', 'response_format', 'stream_options']) {
        if (body[key] !== undefined) options[key] = body[key];
    }
    return options;
}

// Returns a wire copy; never saves cache metadata in the user's conversation.
// historyEnd is fixed BEFORE tool rounds append dynamic user / tool messages.
function prepareCachedRequest(endpoint, body, { historyEnd = -1, enabled = true, historyBreakpoint = false } = {}) {
    if (!enabled || !supportsBlockCache(endpoint, body.model)) return body;
    const result = JSON.parse(JSON.stringify(body));
    const strategy = cacheStrategy(endpoint, result.model, { historyBreakpoint });
    delete result.cache_control; // Do not also auto-cache the volatile suffix.
    for (const message of result.messages || []) {
        delete message.cache_control;
        if (Array.isArray(message.content)) for (const block of message.content) delete block.cache_control;
    }
    for (const tool of result.tools || []) {
        delete tool.cache_control;
        if (tool.function) delete tool.function.cache_control;
    }
    if (Array.isArray(result.tools)) result.tools = stableToolSchema(result.tools);
    function mark(index) {
        const message = result.messages?.[index];
        if (!message || !['system', 'user', 'assistant'].includes(message.role)) return false;
        if (typeof message.content === 'string') {
            if (!message.content.trim()) return false;
            message.content = [{ type: 'text', text: message.content }];
        }
        if (!Array.isArray(message.content)) return false;
        // Mark only text. Preserve image/tool/thinking blocks and their order.
        const block = [...message.content].reverse().find(b => b.type === 'text' && typeof b.text === 'string' && b.text.trim());
        if (!block) return false;
        block.cache_control = { type: 'ephemeral', ttl: CACHE_TTL };
        return true;
    }
    const systemIndex = (result.messages || []).findIndex(m => m.role === 'system');
    if (systemIndex >= 0) mark(systemIndex);
    if (strategy === 'content-history-v1' || strategy === 'tree-history-experiment-v1') {
        // Caller gives the original current-message boundary, not the last user in a tool round.
        if (Number.isInteger(historyEnd) && historyEnd >= 0 && historyEnd < result.messages.length - 1) {
            for (let i = historyEnd; i > systemIndex; i--) if (mark(i)) break;
        }
    }
    if (result.stream === true) result.stream_options = { ...result.stream_options, include_usage: true };
    return result;
}

function inspectCacheRequest(body, endpoint = null, { historyBreakpoint = false } = {}) {
    const breakpoints = [];
    (body.messages || []).forEach((message, messageIndex) => {
        if (message.cache_control) breakpoints.push({ message: messageIndex, role: message.role, placement: 'message', ttl: message.cache_control.ttl || '5m' });
        if (Array.isArray(message.content)) message.content.forEach((block, blockIndex) => {
            if (block.cache_control) breakpoints.push({ message: messageIndex, block: blockIndex,
                role: message.role, placement: 'content', ttl: block.cache_control.ttl || '5m' });
        });
    });
    const result = { breakpoints, includeUsage: body.stream_options?.include_usage === true };
    if (endpoint) result.strategy = cacheStrategy(endpoint, body.model, { historyBreakpoint });
    return result;
}

// Hashes are deliberately over full wire values but only the fixed-size digest,
// sizes, roles, and option presence escape to logs. No prompt or schema text is emitted.
function inspectWireRequest(endpoint, body) {
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const inspection = inspectCacheRequest(body, endpoint);
    const stableEnd = inspection.breakpoints.length
        ? Math.max(...inspection.breakpoints.map(point => point.message)) + 1
        : 0;
    const stableMessages = messages.slice(0, stableEnd);
    const suffixMessages = messages.slice(stableEnd);
    const tools = Array.isArray(body.tools) ? body.tools : [];
    const options = selectedRequestOptions(body);
    return {
        host: cacheHost(endpoint),
        model: body.model || null,
        strategy: inspection.strategy,
        breakpoints: inspection.breakpoints,
        messageCount: messages.length,
        roles: messages.map(message => message?.role || 'unknown'),
        toolCount: tools.length,
        toolSchemaFingerprint: digest(tools),
        stablePrefix: { messages: stableMessages.length, bytes: contentSize(stableMessages), fingerprint: digest({ model: body.model, tools, messages: stableMessages }) },
        suffix: { messages: suffixMessages.length, bytes: contentSize(suffixMessages), fingerprint: digest(suffixMessages) },
        requestOptions: { keys: Object.keys(options).sort(), fingerprint: digest(options) },
    };
}

// Free local self-check, not a provider capability probe or proof of a cache hit.
function cacheAdapterStatus() {
    const body = { model: 'claude-opus-4-6-think', stream: true, messages: [
        { role: 'system', content: 'rules', cache_control: { type: 'ephemeral' } },
        { role: 'user', content: 'history' }, { role: 'assistant', content: 'reply' },
        { role: 'user', content: 'runtime and current question' },
    ] };
    const prepared = prepareCachedRequest('https://aihubmix.com/v1/chat/completions', body, { historyEnd: 2 });
    const inspection = inspectCacheRequest(prepared, 'https://aihubmix.com/v1/chat/completions');
    const treeInspection = inspectCacheRequest(prepareCachedRequest('https://api.treegpt.cc/v1/chat/completions',
        { ...body, model: 'claude-opus-5-5' }, { historyEnd: 2 }), 'https://api.treegpt.cc/v1/chat/completions');
    return { version: 2, provider: 'aihubmix', providers: ['aihubmix', 'tree'], protocol: 'chat-content-blocks', ttl: CACHE_TTL,
        strategies: { aihubmix: 'content-history-v1', tree: 'tree-system-tools-v1' },
        localCheckPassed: inspection.breakpoints.length === 2
            && inspection.breakpoints.every(b => b.placement === 'content' && b.message < 3 && b.ttl === CACHE_TTL)
            && inspection.includeUsage,
        treeLocalCheckPassed: treeInspection.strategy === 'tree-system-tools-v1' && treeInspection.breakpoints.length === 1
            && treeInspection.breakpoints[0].placement === 'content' && treeInspection.breakpoints[0].message === 0
            && treeInspection.breakpoints[0].ttl === CACHE_TTL && treeInspection.includeUsage,
        upstreamVerified: false };
}

module.exports = { supportsBlockCache, cacheStrategy, prepareCachedRequest, inspectCacheRequest, inspectWireRequest, cacheAdapterStatus };
