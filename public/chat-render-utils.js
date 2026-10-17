(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ChatRenderUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    'use strict';

    function resolveMessageRenderState(message, version, extractThinking) {
        const msg = message || {};
        const current = version || msg;
        const hasRawContent = typeof current.rawContent === 'string' && current.rawContent.trim();
        const extracted = extractThinking(hasRawContent ? current.rawContent : (current.content || ''));
        const reasoning = current.reasoning || msg.reasoning || '';
        const savedThinking = current.thinking || msg.thinking || '';
        return {
            visibleContent: extracted.visibleContent,
            thinking: reasoning || extracted.thinking || savedThinking || ''
        };
    }

    function createFrameScheduler(callback, options = {}) {
        const requestFrame = options.requestFrame || root?.requestAnimationFrame?.bind(root) || (fn => setTimeout(fn, 16));
        const cancelFrame = options.cancelFrame || root?.cancelAnimationFrame?.bind(root) || clearTimeout;
        let frameId = 0;
        let pending = false;

        function run() {
            frameId = 0;
            if (!pending) return;
            pending = false;
            callback();
        }

        return Object.freeze({
            schedule() {
                pending = true;
                if (!frameId) frameId = requestFrame(run);
            },
            flush() {
                if (frameId) cancelFrame(frameId);
                frameId = 0;
                if (!pending) return;
                pending = false;
                return callback();
            },
            cancel() {
                if (frameId) cancelFrame(frameId);
                frameId = 0;
                pending = false;
            }
        });
    }

    return { resolveMessageRenderState, createFrameScheduler };
});
