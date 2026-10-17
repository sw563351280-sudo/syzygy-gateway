'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractThinkingFromContent } = require('../public/thinking-parser');
const { resolveMessageRenderState, createFrameScheduler } = require('../public/chat-render-utils');

test('saved thinking remains visible when raw content contains only the answer', () => {
    const version = { content: '回答', rawContent: '回答', thinking: '已经保存的思考', reasoning: '' };
    assert.deepEqual(resolveMessageRenderState({}, version, extractThinkingFromContent), {
        visibleContent: '回答',
        thinking: '已经保存的思考'
    });
});

test('reasoning and thinking embedded in raw content keep their precedence', () => {
    const embedded = { rawContent: '<thinking>原文思考</thinking>回答', thinking: '旧思考' };
    assert.deepEqual(resolveMessageRenderState({}, embedded, extractThinkingFromContent), {
        visibleContent: '回答',
        thinking: '原文思考'
    });
    const reasoning = { ...embedded, reasoning: '接口推理' };
    assert.equal(resolveMessageRenderState({}, reasoning, extractThinkingFromContent).thinking, '接口推理');
});

test('stream paints are coalesced to one callback per frame and can be flushed', () => {
    let queued;
    let paints = 0;
    const scheduler = createFrameScheduler(() => { paints += 1; }, {
        requestFrame(callback) { queued = callback; return 1; },
        cancelFrame() { queued = undefined; }
    });

    scheduler.schedule();
    scheduler.schedule();
    scheduler.schedule();
    assert.equal(paints, 0);
    queued();
    assert.equal(paints, 1);

    scheduler.schedule();
    scheduler.flush();
    assert.equal(paints, 2);
    assert.equal(queued, undefined);
});
