'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once, EventEmitter } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { createChatRequestLifecycle } = require('../chat-request-lifecycle');
const { createRequest, readStream, errorMessage } = require('../public/chat-transport');
const { createSummarizer } = require('../rolling-context');

test('SSE handles fragmented UTF8, comments, data without spaces and terminal event without EOF', async () => {
    const bytes = new TextEncoder().encode(': heartbeat\n\ndata:' + JSON.stringify({ choices: [{ delta: { content: '你好' } }] }) + '\r\n\ndata: [DONE]\n\n');
    let touches = 0;
    const events = [];
    const body = new ReadableStream({ start(c) { for (const b of bytes) c.enqueue(Uint8Array.of(b)); } });
    await readStream({ body }, e => events.push(e), () => touches++);
    assert.equal(events[0].choices[0].delta.content, '你好');
    assert.ok(touches > 10);
    await body.cancel();
});

test('SSE does not swallow errors or silently accept a truncated reply', async () => {
    for (const tail of ['data: [ERROR]供应商异常\n\n', 'data: {"error":{"message":"供应商异常"}}\n\n', '']) {
        const events = [];
        const response = new Response('data: {"choices":[{"delta":{"content":"半段文字"}}]}\n\n' + tail);
        await assert.rejects(readStream(response, e => events.push(e)), /供应商异常|提前断开/);
        assert.equal(events[0].choices[0].delta.content, '半段文字');
    }
    await readStream(new Response('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}'), () => {});
});

test('user stop and transport timeout are distinct and timers are cleaned', async () => {
    const states = [];
    const stopped = createRequest({ timeoutMs: 20, onState: s => states.push(s) });
    stopped.stop(); stopped.stop(); stopped.finish();
    await delay(35);
    assert.equal(stopped.reason, 'user');
    assert.equal(stopped.signal.aborted, true);
    assert.deepEqual(states, ['generating', 'stopping', 'idle']);
    const timed = createRequest({ timeoutMs: 10 });
    await delay(25);
    assert.equal(timed.reason, 'timeout');
    assert.match(errorMessage(Error('Fetch is aborted'), timed), /长时间/);
    timed.finish();
    const completed = createRequest({ timeoutMs: 10 });
    completed.finish(); await delay(25);
    assert.equal(completed.signal.aborted, false);
});

test('quiet gateway heartbeats keep client alive, abort closes the real upstream HTTP request', async t => {
    let upstreamClosed;
    const closed = new Promise(resolve => { upstreamClosed = resolve; });
    const upstream = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(': waiting\n\n');
        res.on('close', upstreamClosed);
    });
    upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
    const gateway = http.createServer(async (req, res) => {
        const lifecycle = createChatRequestLifecycle(req, res, { heartbeatMs: 15 });
        lifecycle.startStream();
        try {
            const response = await fetch(`http://127.0.0.1:${upstream.address().port}`, { signal: lifecycle.signal });
            for await (const chunk of response.body) res.write(chunk);
            res.end();
        } catch (_) { if (!res.destroyed) res.end(); }
        finally { lifecycle.cleanup(); }
    });
    gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening');
    t.after(() => { gateway.closeAllConnections(); gateway.close(); upstream.closeAllConnections(); upstream.close(); });
    const request = createRequest({ timeoutMs: 1000 });
    const response = await fetch(`http://127.0.0.1:${gateway.address().port}`, { signal: request.signal });
    assert.equal(response.headers.get('x-accel-buffering'), 'no');
    const reading = readStream(response, () => {}, () => request.touch());
    const rejected = assert.rejects(reading, { name: 'AbortError' });
    await delay(1600);
    assert.equal(request.signal.aborted, false, 'heartbeat prevents false timeout while no text is generated');
    request.stop();
    await rejected;
    await Promise.race([closed, delay(1500).then(() => { throw Error('upstream was not cancelled'); })]);
    request.finish();
});

test('normal response finish is not a cancellation and removes listeners', () => {
    const req = new EventEmitter(), res = new EventEmitter();
    const lifecycle = createChatRequestLifecycle(req, res);
    res.writableEnded = true; res.emit('finish'); res.emit('close');
    assert.equal(lifecycle.signal.aborted, false);
    assert.equal(req.listenerCount('aborted'), 0);
    assert.equal(res.listenerCount('close'), 0);
});

test('stopping during paid summary aborts its upstream request', async () => {
    const controller = new AbortController();
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    const summarize = createSummarizer({ endpoint: 'http://fixture.invalid', model: 'fixture', apiKey: 'fixture',
        fetchImpl: async (_url, { signal }) => {
            started();
            return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
        } });
    const pending = summarize({ previousSummary: '', messages: [], signal: controller.signal });
    await ready; controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
});
