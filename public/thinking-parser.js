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

    const THINKING_LANGS = ['thinking', 'think', 'reasoning', 'chain_of_thought'];
    const THINKING_LANG_RE = new RegExp('^(' + THINKING_LANGS.join('|') + ')$', 'i');

    // 提取 ```thinking / ```think / ```reasoning / ```chain_of_thought 围栏（含流式未闭合）。
    // 必须在 protectMarkdownCode 之前执行，否则围栏会被当作普通代码块原样保留。
    function extractFencedThinking(content) {
        const thinkingParts = [];
        let remaining = '';
        let index = 0;
        const len = content.length;
        while (index < len) {
            if (content[index] !== '`') {
                remaining += content[index++];
                continue;
            }
            let tickCount = 1;
            while (index + tickCount < len && content[index + tickCount] === '`') tickCount++;
            const delimiter = '`'.repeat(tickCount);
            const afterDelim = index + tickCount;
            const lineEnd = content.indexOf('\n', afterDelim);
            const eol = lineEnd === -1 ? len : lineEnd;
            const langLine = content.slice(afterDelim, eol).trim();
            const atEnd = eol === len;
            const exactThinkingLang = tickCount >= 3 && THINKING_LANG_RE.test(langLine);
            // 流式推送中，围栏已出现但语言标签还没写全（如 "```thi"）且这行就是当前末尾：
            // 立即按思考处理，避免先闪现再消失。
            const partialThinkingLang = tickCount >= 3 && atEnd && langLine.length > 0
                && THINKING_LANGS.some(lang => lang.toLowerCase().startsWith(langLine.toLowerCase()));
            if (exactThinkingLang || partialThinkingLang) {
                const contentStart = eol < len ? eol + 1 : len;
                const closeIndex = content.indexOf(delimiter, contentStart);
                const inner = closeIndex === -1 ? content.slice(contentStart) : content.slice(contentStart, closeIndex);
                const trimmed = inner.trim();
                if (trimmed) thinkingParts.push(trimmed);
                index = closeIndex === -1 ? len : closeIndex + tickCount;
                continue;
            }
            remaining += content[index++];
        }
        return { thinking: thinkingParts.join('\n\n'), remaining };
    }

    function extractThinkingFromContent(content) {
        if (!content) return { thinking: '', visibleContent: '' };

        const thinkingParts = [];
        // 1. 先拆 thinking 围栏，剩下的正文再交给 protectMarkdownCode 保护
        const fenced = extractFencedThinking(String(content));
        if (fenced.thinking) thinkingParts.push(fenced.thinking);
        const protectedCode = protectMarkdownCode(fenced.remaining);

        const tagRe = /<(think|thinking|chain_of_thought|reasoning)>([\s\S]*?)<\/\1>/gi;
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
