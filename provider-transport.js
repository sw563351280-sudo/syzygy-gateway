'use strict';
const { fetchCachedProvider: fetchExisting, buildNativeRequest, convertMessage, convertStream } = require('./anthropic-cache');
const { supportsBlockCache } = require('./provider-cache');

// Negotiation lives for one user request (including its tool rounds), never across
// credentials or users. A new user request starts with OpenAI again.
const negotiated = new WeakMap();
const EMPTY = '中转站没有返回可用的回复或工具调用；已停止，未自动重发，请检查接口适配。';
function canFallback(endpoint, model) {
    try {
        const url = new URL(endpoint);
        return url.protocol === 'https:' && /^claude-/i.test(model || '')
            && /\/chat\/completions\/?$/.test(url.pathname) && !supportsBlockCache(endpoint, model);
    } catch { return false; }
}
function isProtocolRejection(status, text) {
    if (![200, 400, 404, 405, 415, 422].includes(status)) return false;
    // A missing model, invalid key, exhausted balance, or oversized context is
    // not evidence that changing the endpoint will help.
    if (/model.{0,40}(not found|not exist|unsupported|unavailable)|(?:unknown|invalid|unsupported) model|模型.{0,20}(不存在|不可用)|api.?key|quota|balance|rate.limit|context.length|token.limit|余额|限流/i.test(text)) return false;
    return /(?:only|must|use|require|please|仅|只支持|请使用).{0,90}(?:anthropic|\/v1\/messages)|(?:openai|chat[ _/]completions).{0,90}(?:not supported|unsupported|not compatible|not found|not allowed|不支持|不兼容|不适配)|(?:unsupported|not supported|does not support|cannot post|not found|不支持|不兼容|不适配).{0,60}(?:openai|chat[ _/]completions)/i.test(text)
        || (status === 404 && /^(?:404\s*)?(?:page )?not found\.?\s*$/i.test(text.trim()));
}
function selectionKey(endpoint, body) { return endpoint + '\n' + body.model; }
function remember(state, key) {
    if (!state) return;
    if (!negotiated.has(state)) negotiated.set(state, new Set());
    negotiated.get(state).add(key);
}
function jsonResponse(response, data, stream) {
    const message = data.choices?.[0]?.message;
    if (!message || (!(typeof message.content === 'string' && message.content.trim()) && !message.tool_calls?.length)) throw new Error(EMPTY);
    if (!stream) return { ok: true, status: response.status, headers: response.headers,
        json: async () => data, text: async () => JSON.stringify(data) };
    const delta = { ...message };
    if (delta.tool_calls) delta.tool_calls = delta.tool_calls.map((call, index) => ({ ...call, index }));
    const body = new Response('data: ' + JSON.stringify({ ...data, choices: [{ index: 0, delta, finish_reason: data.choices[0].finish_reason }] }) + '\n\ndata: [DONE]\n\n').body;
    body.anthropicContent = message._anthropic_content;
    return { ok: true, status: response.status, headers: response.headers, body };
}

// Peek only until the first meaningful SSE event, then replay every byte. Native
// responses to the OpenAI endpoint are converted in place, without a second bill.
async function peekStream(body) {
    if (!body?.getReader) throw new Error(EMPTY);
    const reader = body.getReader(), decoder = new TextDecoder(), chunks = [];
    let buffer = '', size = 0, ended = false;
    try {
        let first;
        while (!first && !ended) {
            const { value, done } = await reader.read(); ended = done;
            if (value) { chunks.push(value); size += value.length; }
            buffer += done ? decoder.decode() + '\n' : decoder.decode(value, { stream: true });
            let newline;
            while ((newline = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
                if (!line.startsWith('data:')) continue;
                const text = line.slice(5).trim();
                if (text === '[DONE]') throw new Error(EMPTY);
                if (!text) continue;
                try { first = JSON.parse(text); } catch { throw new Error('中转站返回了无法识别的流式数据；未自动重发。'); }
                if (first.type === 'ping') { first = null; continue; }
                break;
            }
            if (size > 65536 && !first) throw new Error('中转站没有返回可识别的流式事件；未自动重发。');
        }
        if (!first) throw new Error(EMPTY);
        let index = 0;
        const stream = new ReadableStream({
            async pull(controller) {
                if (index < chunks.length) { controller.enqueue(chunks[index++]); return; }
                try {
                    const chunk = ended ? { done: true } : await reader.read();
                    if (chunk.done) { controller.close(); reader.releaseLock(); }
                    else controller.enqueue(chunk.value);
                } catch (error) { controller.error(error); }
            },
            cancel(reason) { return reader.cancel(reason); },
        });
        return { first, stream };
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
}

// Validate before forwarding terminal events, so an empty success cannot be
// saved by the browser. Once any event has been accepted there is no retry.
function checkedStream(upstream) {
    const reader = upstream.getReader(), decoder = new TextDecoder(), encoder = new TextEncoder();
    let buffer = '', visible = false, tools = false, completed = false;
    const output = new ReadableStream({
        async pull(controller) {
            try {
                while (true) {
                    let emitted = false;
                    const { done, value } = await reader.read();
                    buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
                    if (done && buffer) buffer += '\n';
                    let newline;
                    while ((newline = buffer.indexOf('\n')) >= 0) {
                        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
                        if (line.startsWith('data:')) {
                            const text = line.slice(5).trim();
                            if (text && text !== '[DONE]') {
                                const event = JSON.parse(text);
                                if (event.error || event.type === 'error') throw new Error('中转站流式请求报错；未自动重发。');
                                if (event.type === 'message_start') throw new Error('中转站在响应途中切换了协议；未自动重发。');
                                const choice = event.choices?.[0], delta = choice?.delta;
                                visible ||= typeof delta?.content === 'string' && Boolean(delta.content.trim());
                                tools ||= Boolean(delta?.tool_calls?.length);
                                if (choice?.finish_reason) {
                                    if (!visible && !tools) throw new Error(EMPTY);
                                    completed = true;
                                }
                            } else if (text === '[DONE]') {
                                if (!visible && !tools) throw new Error(EMPTY);
                                completed = true;
                            }
                        }
                        controller.enqueue(encoder.encode(line + '\n'));
                        emitted = true;
                    }
                    if (done) {
                        if (!visible && !tools) throw new Error(EMPTY);
                        if (!completed) throw new Error('中转站流式响应提前中断；未自动重发。');
                        output.anthropicContent = upstream.anthropicContent;
                        controller.close(); reader.releaseLock(); return;
                    } else if (upstream.anthropicContent) output.anthropicContent = upstream.anthropicContent;
                    if (emitted) return;
                }
            } catch (error) { await reader.cancel().catch(() => {}); controller.error(error); }
        },
        cancel(reason) { return reader.cancel(reason); },
    });
    return output;
}

async function fetchCachedProvider(endpoint, body, { headers = {}, signal, fetchImpl = fetch, protocolState } = {}) {
    // Existing cache routes (especially TreeGPT) never enter negotiation.
    if (!canFallback(endpoint, body.model)) return fetchExisting(endpoint, body, { headers, signal, fetchImpl });
    const key = selectionKey(endpoint, body);
    async function native() {
        signal?.throwIfAborted();
        const url = new URL(endpoint); url.pathname = url.pathname.replace(/\/chat\/completions\/?$/, '/messages');
        const nativeHeaders = new Headers(headers);
        // https://platform.claude.com/docs/en/api/messages/create
        nativeHeaders.set('anthropic-version', '2023-06-01');
        const bearer = /^Bearer\s+(.+)$/i.exec(nativeHeaders.get('authorization') || '');
        if (bearer && !nativeHeaders.has('x-api-key')) nativeHeaders.set('x-api-key', bearer[1]);
        // This is a protocol conversion only: no frozen history or cache markers.
        const nativeBody = buildNativeRequest(body, { cache: false });
        const response = await fetchImpl(url.toString(), { method: 'POST', redirect: 'error', headers: nativeHeaders, signal, body: JSON.stringify(nativeBody) });
        if (!response.ok) {
            await response.body?.cancel().catch(() => {});
            throw new Error(`Anthropic 接口返回 HTTP ${response.status}；协议回退已停止，未继续重试。`);
        }
        const adapted = await adapt(response, false);
        remember(protocolState, key);
        return adapted;
    }
    async function adapt(response, allowRetry) {
        if ((response.headers.get('content-type') || '').includes('text/event-stream')) {
            const { first, stream } = await peekStream(response.body);
            if (first.error || first.type === 'error') {
                await stream.cancel();
                if (allowRetry && !first.usage && isProtocolRejection(200, JSON.stringify(first.error || first))) return native();
                throw new Error('中转站返回接口错误；未继续自动重试。');
            }
            const nativeFormat = first.type === 'message_start';
            if (!nativeFormat && !Array.isArray(first.choices) && !first.usage) {
                await stream.cancel(); throw new Error('中转站返回了无法识别的响应格式；未自动重发。');
            }
            return { ok: true, status: response.status, headers: response.headers,
                body: checkedStream(nativeFormat ? convertStream(stream) : stream) };
        }
        let data;
        try { data = await response.json(); } catch { throw new Error('中转站没有返回有效的 JSON 响应；未自动重发。'); }
        if (data.error || data.type === 'error') {
            if (allowRetry && !data.usage && isProtocolRejection(200, JSON.stringify(data.error || data))) return native();
            throw new Error('中转站返回接口错误；未继续自动重试。');
        }
        if (data.type === 'message' && Array.isArray(data.content)) data = convertMessage(data);
        return jsonResponse(response, data, body.stream === true);
    }
    if (protocolState && negotiated.get(protocolState)?.has(key)) return native();
    const response = await fetchImpl(endpoint, { method: 'POST', headers, signal, body: JSON.stringify(body) });
    if (!response.ok) {
        // Read only a bounded error body, preserving the original for callers.
        if (![400, 404, 405, 415, 422].includes(response.status)) return response;
        const copy = response.clone(), reader = copy.body?.getReader();
        let text = '';
        if (reader) {
            const decoder = new TextDecoder();
            try {
                while (text.length <= 16384) {
                    const chunk = await reader.read();
                    if (chunk.done) break;
                    text += decoder.decode(chunk.value, { stream: true });
                }
            } finally { void reader.cancel().catch(() => {}); }
        }
        if (text.length <= 16384 && isProtocolRejection(response.status, text)) {
            await response.body?.cancel().catch(() => {});
            return native();
        }
        return response;
    }
    return adapt(response, true);
}
module.exports = { fetchCachedProvider, isProtocolRejection };
