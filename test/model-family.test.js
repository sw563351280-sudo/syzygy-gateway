'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ModelFamily = require('../public/model-family');

test('model family exposes only Gemini and Claude without version or channel detail', () => {
    assert.equal(ModelFamily.label('[channel-a] gemini-4.0-preview'), 'Gemini');
    assert.equal(ModelFamily.label('claude-opus-5-5-thinking'), 'Claude');
    assert.equal(ModelFamily.label('gpt-5.6'), '');
    assert.equal(ModelFamily.label(''), '');
});

test('switch detection ignores versions within a family', () => {
    assert.equal(ModelFamily.switched('gemini-3.8', 'gemini-4.0'), false);
    assert.equal(ModelFamily.switched('claude-opus-4-6', 'claude-sonnet-5-5'), false);
    assert.equal(ModelFamily.switched('gemini-4.0', 'claude-opus-5-5'), true);
    assert.equal(ModelFamily.switched('claude-opus-5-5', 'gemini-4.0'), true);
    assert.equal(ModelFamily.switched('gemini-4.0', 'gpt-5.6'), false);
});

test('notice derives the family from the actual model and never exposes routing details', () => {
    const gemini = ModelFamily.notice('[relay-secret] gemini-4.0-preview', true);
    const claude = ModelFamily.notice('channel-x/claude-opus-5-5', true);
    assert.match(gemini, /已切换为 Gemini/);
    assert.match(claude, /已切换为 Claude/);
    assert.doesNotMatch(gemini, /relay-secret|4\.0|preview/);
    assert.doesNotMatch(claude, /channel-x|opus|5-5/);
    assert.equal(gemini, '【模型切换提醒】当前对话模型已切换为 Gemini。');
    assert.equal(claude, '【模型切换提醒】当前对话模型已切换为 Claude。');
    assert.equal(ModelFamily.notice('gemini-4.0', false), '');
    assert.equal(ModelFamily.notice('gpt-5.6', true), '');
});
