'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const AssistantArtifacts = require('../public/assistant-artifacts');
const { extractReactionTag } = AssistantArtifacts;

test('client display guard hides legacy leading and trailing reaction lines', () => {
    for (const source of [
        '<REACT:🥣>\n正文保留',
        'REACT: 👥\n正文保留',
        '\nreact：🐾\r\n正文保留',
        '正文保留\n<REACT:🫂>',
        '正文保留\nREACT: 👥',
    ]) {
        const parsed = extractReactionTag(source);
        assert.equal(parsed.cleanText, '正文保留');
        assert.equal(parsed.hadTag, true);
        assert.ok(parsed.reaction);
    }
});

test('client display guard holds incomplete stream prefixes without hiding prose examples', () => {
    for (const partial of ['R', 'REACT:', 'REACT: 🥣', '<REA', '<REACT:🥣>']) {
        assert.equal(extractReactionTag(partial, { partial: true }).cleanText, '');
    }
    assert.equal(extractReactionTag('正文已经显示\n<REA', { partial: true }).cleanText, '正文已经显示');

    for (const source of [
        '正文里提到 REACT: 👥，这是示例。',
        'REACT: reaction means response.\nThe explanation continues.',
        '示例：\n    REACT: 👥',
        '示例：\n```text\nREACT: 👥\n```',
        '前文\nREACT: 👥\n后文',
    ]) {
        assert.equal(extractReactionTag(source, { partial: true }).cleanText, source);
        assert.equal(extractReactionTag(source, { partial: true }).hadTag, false);
    }
});

test('assistant rendering enables the reaction display guard and cache-busts its assets', () => {
    const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'script.js'), 'utf8');
    const index = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const begin = script.indexOf('function stripInternalTags');
    const end = script.indexOf('// ==================== 版本化消息辅助函数', begin);
    const context = { window: { AssistantArtifacts }, marked: { parse: text => text } };
    vm.runInNewContext(script.slice(begin, end), context);
    assert.equal(context.renderMarkdown('<REACT:🥣>\n正文保留', true), '正文保留');
    assert.equal(context.renderMarkdown('REACT: 👥\n正文保留', true), '正文保留');
    assert.equal(context.renderMarkdown('<REA', true), '');
    assert.equal(context.renderMarkdown('前文\nREACT: 👥\n后文', true), '前文\nREACT: 👥\n后文');
    assert.equal(context.renderMarkdown('<REACT:🥣>\n用户原文', false), '<REACT:🥣>\n用户原文');
    assert.match(index, /assistant-artifacts\.js\?v=2/);
    assert.match(index, /script\.js\?v=20261031-tools-state/);
});
