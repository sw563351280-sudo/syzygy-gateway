'use strict';

const { splitAssistantTerminalTags } = require('./assistant-internal-tags');

function oneEmoji(value) {
    const emoji = String(value || '').trim();
    if (!emoji || emoji.length > 40) return null;
    const segments = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(emoji)];
    if (segments.length !== 1 || segments[0].segment !== emoji) return null;
    const pictograph = /\p{Extended_Pictographic}/u.test(emoji);
    const flag = /^(?:\p{Regional_Indicator}){2}$/u.test(emoji);
    const keycap = /^[0-9#*]\uFE0F?\u20E3$/u.test(emoji);
    return pictograph || flag || keycap ? emoji : null;
}

function extractAssistantReaction(content, { enabled = true } = {}) {
    const text = String(content || '');
    const terminal = splitAssistantTerminalTags(text);
    const reactionTags = terminal.tags.filter(tag => tag.name === 'REACT');
    const parsed = [...reactionTags].reverse().map(tag => oneEmoji(tag.value)).find(Boolean) || null;
    let cleanContent = text;
    for (const tag of [...reactionTags].reverse()) {
        let start = tag.start;
        let end = tag.end;
        if (text[end] === '\r') end++;
        if (text[end] === '\n') end++;
        else if (start > 0 && text[start - 1] === '\n') start--;
        cleanContent = cleanContent.slice(0, start) + cleanContent.slice(end);
    }
    return {
        cleanContent: cleanContent.trimEnd(),
        reaction: enabled ? parsed : null,
        hadTag: reactionTags.length > 0,
    };
}

module.exports = { extractAssistantReaction, oneEmoji };
