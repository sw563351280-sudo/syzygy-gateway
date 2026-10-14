'use strict';
(function (root) {
    function createRequest({ streaming = true, onState = () => {}, timeoutMs } = {}) {
        const controller = new AbortController();
        let timer, reason = null, stage = '准备请求';
        const id = root.crypto?.randomUUID?.() || ('chat-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));
        const request = {
            id,
            signal: controller.signal,
            get reason() { return reason; },
            get stage() { return stage; },
            mark(next) { if (next) stage = next; },
            touch() {
                clearTimeout(timer);
                if (!controller.signal.aborted) timer = setTimeout(() => {
                    reason = 'timeout';
                    controller.abort();
                }, timeoutMs ?? (streaming ? 90000 : 960000));
            },
            stop() {
                if (controller.signal.aborted) return;
                reason = 'user';
                clearTimeout(timer);
                controller.abort();
                onState('stopping');
            },
            finish() { clearTimeout(timer); onState('idle'); },
        };
        onState('generating');
        request.touch();
        return request;
    }

    async function readStream(response, onEvent, touch = () => {}) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '', completed = false;
        function line(raw) {
            if (!raw.startsWith('data:')) return false;
            const payload = raw.slice(5).trim();
            if (!payload) return false;
            if (payload === '[DONE]') { completed = true; return true; }
            if (payload.startsWith('[ERROR]')) throw new Error(payload.slice(7).trim() || '服务器生成失败');
            let event;
            try { event = JSON.parse(payload); } catch (_) { throw new Error('回复数据格式异常，已保留收到的内容'); }
            if (event.error) throw new Error(event.error.message || String(event.error));
            if (event.choices?.[0]?.finish_reason) completed = true;
            onEvent(event);
            return false;
        }
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (!done) touch(); // SSE comments count as activity, even without visible text.
                buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();
                for (const raw of lines) if (line(raw)) return;
                if (done) { if (buffer.trim()) line(buffer); break; }
            }
            if (!completed) throw new Error('回复连接提前断开，已保留收到的内容');
        } finally { reader.releaseLock(); }
    }
    function errorMessage(error, request) {
        if (request?.reason === 'timeout') return '连接长时间没有响应，已停止等待';
        if (error?.name === 'AbortError') return '回复连接被中断';
        const message = String(error?.message || '');
        if (/^(load failed|failed to fetch|networkerror when attempting to fetch resource\.?)$/i.test(message.trim())) {
            return '连接意外中断，请重试';
        }
        return message || '连接失败，请重试';
    }
    function diagnostics(request) {
        return request ? { requestId: request.id, stage: request.stage, reason: request.reason || null } : null;
    }
    const api = { createRequest, readStream, errorMessage, diagnostics };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ChatTransport = api;
})(typeof window !== 'undefined' ? window : globalThis);
