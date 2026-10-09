'use strict';
const { stableToolSchema } = require('./tool-schema-cache');
const CACHE_TTL = '1h';

// AIHubMix documents content-block cache_control on Chat Completions:
// https://docs.aihubmix.com/en/practices/prompt-caching
const AIHUBMIX_HOSTS = new Set(['aihubmix.com', 'api.aihubmix.com', 'api.inferera.com']);
// TreeGPT uses the New API Chat Completions -> Claude content-block conversion.
const BLOCK_CACHE_HOSTS = new Set([...AIHUBMIX_HOSTS, 'api.treegpt.cc']);
function supportsBlockCache(endpoint, model) {
    try {
        const url = new URL(endpoint);
        return url.protocol === 'https:' && BLOCK_CACHE_HOSTS.has(url.hostname)
            && /^claude-/i.test(model || '');
    } catch (_) { return false; }
}

// Returns a wire copy; never saves cache metadata in the user's conversation.
// historyEnd is fixed BEFORE tool rounds append dynamic user / tool messages.
function prepareCachedRequest(endpoint, body, { historyEnd = -1, enabled = true } = {}) {
    if (!enabled || !supportsBlockCache(endpoint, body.model)) return body;
    const result = JSON.parse(JSON.stringify(body));
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
    // Caller gives the original current-message boundary, not the last user in a tool round.
    if (Number.isInteger(historyEnd) && historyEnd >= 0 && historyEnd < result.messages.length - 1) {
        for (let i = historyEnd; i > systemIndex; i--) if (mark(i)) break;
    }
    if (result.stream === true) result.stream_options = { ...result.stream_options, include_usage: true };
    return result;
}

function inspectCacheRequest(body) {
    const breakpoints = [];
    (body.messages || []).forEach((message, messageIndex) => {
        if (message.cache_control) breakpoints.push({ message: messageIndex, role: message.role, placement: 'message', ttl: message.cache_control.ttl || '5m' });
        if (Array.isArray(message.content)) message.content.forEach((block, blockIndex) => {
            if (block.cache_control) breakpoints.push({ message: messageIndex, block: blockIndex,
                role: message.role, placement: 'content', ttl: block.cache_control.ttl || '5m' });
        });
    });
    return { breakpoints, includeUsage: body.stream_options?.include_usage === true };
}

// Free local self-check, not a provider capability probe or proof of a cache hit.
function cacheAdapterStatus() {
    const body = { model: 'claude-opus-4-6-think', stream: true, messages: [
        { role: 'system', content: 'rules', cache_control: { type: 'ephemeral' } },
        { role: 'user', content: 'history' }, { role: 'assistant', content: 'reply' },
        { role: 'user', content: 'runtime and current question' },
    ] };
    const prepared = prepareCachedRequest('https://aihubmix.com/v1/chat/completions', body, { historyEnd: 2 });
    const inspection = inspectCacheRequest(prepared);
    const treeInspection = inspectCacheRequest(prepareCachedRequest('https://api.treegpt.cc/v1/chat/completions',
        { ...body, model: 'claude-opus-5-5' }, { historyEnd: 2 }));
    return { version: 1, provider: 'aihubmix', providers: ['aihubmix', 'tree'], protocol: 'chat-content-blocks', ttl: CACHE_TTL,
        localCheckPassed: inspection.breakpoints.length === 2
            && inspection.breakpoints.every(b => b.placement === 'content' && b.message < 3 && b.ttl === CACHE_TTL)
            && inspection.includeUsage,
        treeLocalCheckPassed: treeInspection.breakpoints.length === 2
            && treeInspection.breakpoints.every(b => b.placement === 'content' && b.ttl === CACHE_TTL)
            && treeInspection.includeUsage,
        upstreamVerified: false };
}

module.exports = { supportsBlockCache, prepareCachedRequest, inspectCacheRequest, cacheAdapterStatus };
