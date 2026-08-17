(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.extractThinkingFromContent = api.extractThinkingFromContent;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    function protectMarkdownCode(content) {
        const segments = [];
        let protectedText = '';
        let index = 0;
        while (index < content.length) {
            if (content[index] !== '`') {
                protectedText += content[index++];
                continue;
            }
            let tickCount = 1;
            while (content[index + tickCount] === '`') tickCount++;
            const delimiter = '`'.repeat(tickCount);
            const closeIndex = content.indexOf(delimiter, index + tickCount);
            const endIndex = closeIndex === -1 ? content.length : closeIndex + tickCount;
            const token = `\uE000CODE${segments.length}\uE001`;
            segments.push(content.slice(index, endIndex));
            protectedText += token;
            index = endIndex;
        }
        return {
            text: protectedText,
            restore(value) {
                return String(value || '').replace(/\uE000CODE(\d+)\uE001/g, (_, rawIndex) => segments[Number(rawIndex)] || '');
            },
        };
    }

    function extractThinkingFromContent(content) {
        if (!content) return { thinking: '', visibleContent: '' };

        const protectedCode = protectMarkdownCode(String(content));
        const tagRe = /<(think|thinking|chain_of_thought|reasoning)>([\s\S]*?)<\/\1>/gi;
        const thinkingParts = [];
        let visibleContent = protectedCode.text.replace(tagRe, function (_, tag, inner) {
            const trimmed = protectedCode.restore(inner).trim();
            if (trimmed) thinkingParts.push(trimmed);
            return '';
        });

        const openTagRe = /<(think|thinking|chain_of_thought|reasoning)>/gi;
        let openMatch;
        let lastOpenMatch = null;
        while ((openMatch = openTagRe.exec(visibleContent)) !== null) lastOpenMatch = openMatch;

        if (lastOpenMatch) {
            const openTagStart = lastOpenMatch.index;
            const openTagEnd = openTagStart + lastOpenMatch[0].length;
            const tagName = lastOpenMatch[1];
            const afterOpenTag = visibleContent.slice(openTagEnd);
            const closeTag = new RegExp('</' + tagName + '>', 'i');
            if (!closeTag.test(afterOpenTag)) {
                const partialThinking = protectedCode.restore(afterOpenTag).trim();
                if (partialThinking) thinkingParts.push(partialThinking);
                visibleContent = visibleContent.slice(0, openTagStart);
            }
        }

        const tagNames = ['think', 'thinking', 'chain_of_thought', 'reasoning'];
        const lastLt = visibleContent.lastIndexOf('<');
        if (lastLt !== -1) {
            const suffix = visibleContent.slice(lastLt + 1);
            const isPartial = suffix === '' || tagNames.some(tagName => tagName.startsWith(suffix));
            if (isPartial) visibleContent = visibleContent.slice(0, lastLt);
        }

        return {
            thinking: thinkingParts.join('\n\n'),
            visibleContent: protectedCode.restore(visibleContent).trim(),
        };
    }

    return { extractThinkingFromContent, protectMarkdownCode };
});
