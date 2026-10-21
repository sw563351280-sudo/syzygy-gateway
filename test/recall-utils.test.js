'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatRecallDate, relativeTimeLabel, selectTranscriptPreview } = require('../recall-utils');

test('relative recall dates are calculated at injection time in China days', () => {
    const now = new Date('2026-10-21T02:00:00Z');
    assert.equal(relativeTimeLabel('2026-10-20T15:00:00Z', now), '昨天');
    assert.equal(relativeTimeLabel('2026-09-29T05:00:00Z', now), '约3周前');
    assert.equal(formatRecallDate('2026-09-29T05:00:00Z', now), '2026-09-29（约3周前）');
});

test('transcript preview is centered on the matched lines rather than the chunk opening', () => {
    const messages = [
        { role: 'user', content: '这是开头的寒暄。' },
        { role: 'assistant', content: '早上好。' },
        { role: 'user', content: '后来我们聊到茉莉香水，我很喜欢那个味道。' },
        { role: 'assistant', content: '我记得你说它像雨后的花。' },
        { role: 'user', content: '然后换了别的话题。' },
        { role: 'assistant', content: '好。' }
    ];
    const selected = selectTranscriptPreview(messages, '以前聊过的茉莉香水', { maxMessages: 4 });
    assert.equal(selected.anchor, 2);
    assert.equal(selected.start, 1);
    assert.match(selected.messages.map(item => item.content).join('\n'), /茉莉香水/);
    assert.doesNotMatch(selected.messages.map(item => item.content).join('\n'), /开头的寒暄/);
});
