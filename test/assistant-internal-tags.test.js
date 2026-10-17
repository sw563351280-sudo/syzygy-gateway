'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
    createAssistantStreamFilter,
    splitAssistantTerminalTags,
} = require('../assistant-internal-tags');

const crumb = '<CRUMB>{"fact":"她买了草莓","source_quote":"买了草莓"}</CRUMB>';
const mood = '<MOOD_SNAPSHOT>{"mood":"开心"}</MOOD_SNAPSHOT>';

test('finds a continuous terminal protocol zone regardless of tag order', () => {
    for (const suffix of [
        `<REACT:🐶>\n${crumb}\n${mood}`,
        `${crumb}\n<REACT:🐶>\n${mood}`,
        `${mood}\n${crumb}\n<REACT:🐶>`,
    ]) {
        const result = splitAssistantTerminalTags(`正文\n\n${suffix}\n`);
        assert.equal(result.visibleContent, '正文');
        assert.deepEqual(result.tags.map(tag => tag.name).sort(), ['CRUMB', 'MOOD_SNAPSHOT', 'REACT']);
    }
});

test('does not treat inline code, fenced code or non-terminal tags as protocol', () => {
    const inline = '解释一下：`<CRUMB>` 只是标签名，后文必须保留。';
    const fenced = `示例：\n\`\`\`text\n${crumb}\n<REACT:🐶>\n\`\`\``;
    const indented = `示例：\n    ${crumb}\n    <REACT:🐶>`;
    const nonTerminal = `前文\n${crumb}\n后文`;
    for (const source of [inline, fenced, indented, nonTerminal]) {
        const result = splitAssistantTerminalTags(source);
        assert.equal(result.visibleContent, source);
        assert.equal(result.protocolContent, '');
    }
});

test('stream filter preserves unmatched tag examples instead of truncating the reply', () => {
    const sources = [
        '说到这里：`<CRUMB>` 后面还有完整的解释。',
        '第一行\n<CRUMB>\n这只是未闭合示例，后文不能消失。',
        '第一行\n<PRIVATE_JOURNAL>\n这只是讨论，不是隐藏日记。',
    ];
    for (const source of sources) {
        let visible = '';
        const filter = createAssistantStreamFilter(piece => { visible += piece; });
        for (const char of source) filter.push(char);
        filter.finish();
        assert.equal(visible, source);
    }
});

test('stream filter hides terminal tags for one-character and irregular chunks', () => {
    const source = `正文保留\n<REACT:🐶>\n${crumb}\n${mood}`;
    const pseudoRandomSizes = [];
    let seed = 0x5eed;
    for (let index = 0; index < 24; index++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        pseudoRandomSizes.push((seed % 19) + 1);
    }
    for (const sizes of [[1], [2, 7, 1, 13, 3], [17, 4, 29], pseudoRandomSizes]) {
        let visible = '';
        const filter = createAssistantStreamFilter(piece => { visible += piece; });
        let offset = 0; let index = 0;
        while (offset < source.length) {
            const size = sizes[index++ % sizes.length];
            filter.push(source.slice(offset, offset + size));
            offset += size;
        }
        const result = filter.finish();
        assert.equal(visible, '正文保留');
        assert.equal(result.tags.length, 3);
    }
});

test('stream output matches persisted visible content with CRLF and trailing whitespace', () => {
    for (const source of [
        `正文保留\r\n<REACT:🐶>\r\n${crumb}\r\n`,
        `正文末尾有空格   \n<REACT:🐶>`,
        '普通正文末尾的空格   ',
    ]) {
        let visible = '';
        const filter = createAssistantStreamFilter(piece => { visible += piece; });
        for (const char of source) filter.push(char);
        const result = filter.finish();
        assert.equal(visible, result.visibleContent);
    }
});

test('a real terminal tag after a fenced example is still hidden', () => {
    const source = `示例：\n\`\`\`text\n${crumb}\n<REACT:🐶>\n\`\`\`\n<REACT:🐟>`;
    let visible = '';
    const filter = createAssistantStreamFilter(piece => { visible += piece; });
    for (let offset = 0; offset < source.length; offset += 5) filter.push(source.slice(offset, offset + 5));
    const result = filter.finish();
    assert.equal(visible, `示例：\n\`\`\`text\n${crumb}\n<REACT:🐶>\n\`\`\``);
    assert.deepEqual(result.tags.map(tag => tag.name), ['REACT']);
});

test('a completed tag followed by visible prose is released as ordinary text', () => {
    const source = `正文\n${crumb}\n接着讨论这个标签。`;
    let visible = '';
    const filter = createAssistantStreamFilter(piece => { visible += piece; });
    for (let offset = 0; offset < source.length; offset += 3) filter.push(source.slice(offset, offset + 3));
    filter.finish();
    assert.equal(visible, source);
});

test('final reply processing sends only the terminal protocol zone to artifact handlers', () => {
    const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const start = serverSource.indexOf('function processAssistantReplyArtifacts');
    const end = serverSource.indexOf('function queueDailyStateCuration', start);
    const queued = []; const cleaned = [];
    const context = {
        splitAssistantTerminalTags,
        extractSaveMemoryTag: require('../memory-write-utils').extractSaveMemoryTag,
        processAssistantActionTags: text => text,
        extractAssistantReaction: require('../assistant-reaction').extractAssistantReaction,
        consumeAssistantWakePlan: text => text,
        cleanAssistantInternalArtifacts(text) { cleaned.push(text); return ''; },
        queueSmartMemoryWrite(...args) { queued.push(args); },
    };
    vm.runInNewContext(serverSource.slice(start, end), context);

    const example = '正文讨论 `<CRUMB>`，后半句仍然存在。';
    const untouched = context.processAssistantReplyArtifacts(example, { reactionEnabled: true });
    assert.equal(untouched.visibleContent, example);
    assert.equal(cleaned.pop(), '');

    const tagged = context.processAssistantReplyArtifacts([
        '正文保留',
        '<SAVE_MEMORY tags="决定">她作出了一个重要决定。</SAVE_MEMORY>',
        '<REACT:🐶>',
        crumb,
    ].join('\n'), { reactionEnabled: true, currentUserText: '买了草莓' });
    assert.equal(tagged.visibleContent, '正文保留');
    assert.equal(tagged.reaction, '🐶');
    assert.equal(queued.length, 1);
    assert.equal(cleaned.pop(), crumb);
});

test('tool and ordinary streams share the terminal-zone filter and final artifact processor', () => {
    const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.equal((serverSource.match(/createAssistantStreamFilter\(text =>/g) || []).length, 2);
    assert.equal((serverSource.match(/processAssistantReplyArtifacts\(/g) || []).length, 4);
    assert.doesNotMatch(serverSource, /toolStreamContentBuffer|toolStreamBufferingInternalTag/);
    assert.doesNotMatch(serverSource, /let sseBuffer = ''; let contentBuffer =/);
});
