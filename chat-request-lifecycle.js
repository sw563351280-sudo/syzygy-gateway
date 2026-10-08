'use strict';

// Keep a quiet SSE request alive, and stop paid upstream work when its client leaves.
function createChatRequestLifecycle(req, res, { heartbeatMs = 15000, timeoutMs = 900000 } = {}) {
    const controller = new AbortController();
    let heartbeat;
    const abort = () => {
        if (!res.writableEnded) controller.abort(new DOMException('Client disconnected', 'AbortError'));
        cleanup();
    };
    const deadline = setTimeout(() => controller.abort(new DOMException('Generation timed out', 'TimeoutError')), timeoutMs);
    deadline.unref?.();
    function cleanup() {
        clearInterval(heartbeat);
        clearTimeout(deadline);
        req.off('aborted', abort);
        res.off('close', abort);
        res.off('finish', cleanup);
    }
    req.once('aborted', abort);
    res.once('close', abort);
    res.once('finish', cleanup);
    if (req.aborted || res.destroyed) abort();
    return {
        signal: controller.signal,
        startStream() {
            if (heartbeat || controller.signal.aborted) return;
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache, no-transform');
            res.setHeader('X-Accel-Buffering', 'no');
            res.setHeader('Connection', 'keep-alive');
            res.flushHeaders();
            res.write(': connected\n\n');
            heartbeat = setInterval(() => {
                if (!res.destroyed && !res.writableEnded) res.write(': heartbeat\n\n');
            }, heartbeatMs);
            heartbeat.unref?.();
        },
        cleanup,
    };
}

module.exports = { createChatRequestLifecycle };
