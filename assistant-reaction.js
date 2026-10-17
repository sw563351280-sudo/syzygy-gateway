'use strict';

const REACTION_TAG_AT_END = /(?:^|\n)[ \t]*<REACT:([^<>\r\n]+)>[ \t]*$/u;
const REACTION_TAG_LINE = /(?:^|\n)[ \t]*<REACT:[^<>\r\n]*>[ \t]*(?=\n|$)/giu;
const INCOMPLETE_REACTION_TAG_AT_END = /(?:^|\n)[ \t]*<REACT:[^<>\r\n]*$/giu;

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
    const match = text.match(REACTION_TAG_AT_END);
    const parsed = match ? oneEmoji(match[1]) : null;
    const cleanContent = text
        .replace(REACTION_TAG_LINE, '')
        .replace(INCOMPLETE_REACTION_TAG_AT_END, '')
        .trimEnd();
    return { cleanContent, reaction: enabled ? parsed : null, hadTag: /<REACT:/iu.test(text) };
}

module.exports = { extractAssistantReaction, oneEmoji };
