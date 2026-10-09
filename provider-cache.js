'use strict';
const crypto = require('node:crypto');
const { stableToolSchema } = require('./tool-schema-cache');
const { usesNativeCache, buildNativeRequest } = require('./anthropic-cache');
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

// TreeGPT's OpenAI-compatible Claude translation caches the full prefix ending at
// the last explicit breakpoint. Put that breakpoint after stable history so the
// large reusable span includes tools, system, and history—not only system text.
// SYZYGY_TREE_CACHE=system-only rolls back to the v1 system-only breakpoint.
function cacheStrategy(endpoint, model, { treeSystemOnly = false } = {}) {
    if (!supportsBlockCache(endpoint, model)) return 'none';
    const systemOnly = treeSystemOnly || process.env.SYZYGY_TREE_CACHE === 'system-only';
    if (cacheHost(endpoint) === TREEGPT_HOST) return systemOnly ? 'tree-system-tools-v1' : 'tree-history-prefix-v2';
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
function prepareCachedRequest(endpoint, body, { historyEnd = -1, enabled = true, treeSystemOnly = false } = {}) {
    if (!enabled || !supportsBlockCache(endpoint, body.model)) return body;
    const result = JSON.parse(JSON.stringify(body));
    const strategy = cacheStrategy(endpoint, result.model, { treeSystemOnly });
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
    const tree = cacheHost(endpoint) === TREEGPT_HOST;
    let markedHistory = false;
    if (systemIndex >= 0 && (!tree || treeSystemOnly)) mark(systemIndex);
    if ((!tree && strategy === 'content-history-v1') || (tree && !treeSystemOnly)) {
        // Caller gives the original current-message boundary, not the last user in a tool round.
        if (Number.isInteger(historyEnd) && historyEnd >= 0 && historyEnd < result.messages.length - 1) {
            // TreeGPT uses this single history breakpoint; AIHubMix adds it after system.
            for (let i = historyEnd; i > systemIndex; i--) {
                if (mark(i)) { markedHistory = true; break; }
            }
        }
    }
    // Short/new TreeGPT conversations have no historical text to mark yet.
    // Fall back to the stable system/tools prefix rather than disabling caching.
    if (tree && !treeSystemOnly && !markedHistory && systemIndex >= 0) mark(systemIndex);
    if (result.stream === true) result.stream_options = { ...result.stream_options, include_usage: true };
    return result;
}

function inspectCacheRequest(body, endpoint = null, { treeSystemOnly = false } = {}) {
    const breakpoints = [];
    if (Array.isArray(body.system)) body.system.forEach((block, blockIndex) => {
        if (block.cache_control) breakpoints.push({ message: -1, block: blockIndex, role: 'system', placement: 'system', ttl: block.cache_control.ttl || '5m' });
    });
    (body.messages || []).forEach((message, messageIndex) => {
        if (message.cache_control) breakpoints.push({ message: messageIndex, role: message.role, placement: 'message', ttl: message.cache_control.ttl || '5m' });
        if (Array.isArray(message.content)) message.content.forEach((block, blockIndex) => {
            if (block.cache_control) breakpoints.push({ message: messageIndex, block: blockIndex,
                role: message.role, placement: 'content', ttl: block.cache_control.ttl || '5m' });
        });
    });
    const result = { breakpoints, includeUsage: body.system !== undefined ? body.stream === true : body.stream_options?.include_usage === true };
    if (endpoint) result.strategy = body.system !== undefined && usesNativeCache(endpoint, body.model) ? 'anthropic-frozen-v1' : cacheStrategy(endpoint, body.model, { treeSystemOnly });
    return result;
}

function cacheComparable(value) {
    if (Array.isArray(value)) return value.map(cacheComparable);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value)
        .filter(([key]) => key !== 'cache_control')
        .map(([key, item]) => [key, cacheComparable(item)]));
}

// Hashes are deliberately over full wire values but only the fixed-size digest,
// sizes, roles, and option presence escape to logs. No prompt or schema text is emitted.
function inspectWireRequest(endpoint, body) {
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const inspection = inspectCacheRequest(body, endpoint);
    const stableEnd = inspection.breakpoints.length
        ? Math.max(...inspection.breakpoints.map(point => point.message)) + 1
        : 0;
    function prefixAt(point) {
        const prefix = cacheComparable(messages.slice(0, point.message + 1));
        if (point.placement === 'content') prefix.at(-1).content = prefix.at(-1).content.slice(0, point.block + 1);
        const system = cacheComparable(point.placement === 'system' ? body.system.slice(0, point.block + 1) : body.system);
        return { model: body.model, tools: cacheComparable(body.tools || []), system, messages: prefix };
    }
    const lastPoint = inspection.breakpoints.at(-1);
    const lastPrefix = lastPoint ? prefixAt(lastPoint) : { messages: [], system: undefined };
    const stableMessages = lastPrefix.messages;
    const suffixMessages = messages.slice(stableEnd);
    if (lastPoint?.placement === 'content') {
        const tail = messages[lastPoint.message].content.slice(lastPoint.block + 1);
        if (tail.length) suffixMessages.unshift({ ...messages[lastPoint.message], content: tail });
    }
    const tools = Array.isArray(body.tools) ? body.tools : [];
    const comparableTools = cacheComparable(tools);
    const options = selectedRequestOptions(body);
    return {
        host: cacheHost(endpoint),
        model: body.model || null,
        strategy: inspection.strategy,
        breakpoints: inspection.breakpoints,
        messageCount: messages.length,
        roles: messages.map(message => message?.role || 'unknown'),
        toolCount: tools.length,
        toolSchemaFingerprint: digest(comparableTools),
        breakpointFingerprints: inspection.breakpoints.map(point => ({ ...point, fingerprint: digest(prefixAt(point)) })),
        stablePrefix: { messages: stableMessages.length, bytes: contentSize(stableMessages) + (lastPrefix.system ? contentSize(lastPrefix.system) : 0), fingerprint: digest(lastPoint ? lastPrefix : { model: body.model, tools: comparableTools, messages: [] }) },
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
    const treeBody = { ...body, model: 'claude-opus-5-5' };
    const treePrepared = prepareCachedRequest('https://api.treegpt.cc/v1/chat/completions', treeBody, { historyEnd: 2 });
    const treeInspection = inspectCacheRequest(treePrepared, 'https://api.treegpt.cc/v1/chat/completions');
    const native = prepareProviderRequest('https://api.treegpt.cc/v1/chat/completions', treeBody, { historyEnd: 2 });
    const nativeInspection = inspectCacheRequest(native, 'https://api.treegpt.cc/v1/chat/completions');
    return { version: 4, provider: 'aihubmix', providers: ['aihubmix', 'tree'], protocol: 'chat-content-blocks', ttl: CACHE_TTL,
        treeProtocol: usesNativeCache('https://api.treegpt.cc/v1', treeBody.model) ? 'anthropic-messages' : 'chat-content-blocks',
        treeNativeCheckPassed: nativeInspection.strategy === 'anthropic-frozen-v1' && nativeInspection.breakpoints.some(p => p.placement === 'system') && nativeInspection.breakpoints.every(p => p.ttl === '1h'),
        strategies: { aihubmix: 'content-history-v1', tree: nativeInspection.strategy },
        localCheckPassed: inspection.breakpoints.length === 2
            && inspection.breakpoints.every(b => b.placement === 'content' && b.message < 3 && b.ttl === CACHE_TTL)
            && inspection.includeUsage,
        treeLocalCheckPassed: nativeInspection.strategy === 'anthropic-frozen-v1'
            ? nativeInspection.breakpoints.some(p => p.placement === 'system') && nativeInspection.breakpoints.every(p => p.ttl === '1h')
            : treeInspection.strategy === 'tree-history-prefix-v2' && treeInspection.breakpoints.length === 1
            && treeInspection.breakpoints[0].placement === 'content' && treeInspection.breakpoints[0].message === 2
            && treeInspection.breakpoints[0].ttl === CACHE_TTL && treeInspection.includeUsage,
        upstreamVerified: false };
}

function prepareProviderRequest(endpoint, body, options = {}) {
    return usesNativeCache(endpoint, body.model) ? buildNativeRequest(body, options) : prepareCachedRequest(endpoint, body, options);
}
module.exports = { supportsBlockCache, cacheStrategy, prepareCachedRequest, prepareProviderRequest, inspectCacheRequest, inspectWireRequest, cacheAdapterStatus };
