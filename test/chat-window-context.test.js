'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { imageWindow, retainImages, workroomHistory, pruneWireImages } = require('../public/chat-window-context');
const image = 'data:image/png;base64,AAAA';
const version = m => m.versions ? m.versions[m.activeVersion || 0] : m;
const make = (role, content, extra = {}) => ({ role, versions: [{ content, fullTime: '2026-09-25T10:00:00Z' }], ...extra });
const build = (room, main = []) => workroomHistory(room, main, version, text => text, time => time + ' ');
test('workroom includes exactly the latest ten messages from each window, with provenance', () => {
    const main = Array.from({ length: 24 }, (_, i) => make(i % 2 ? 'assistant' : 'user', 'main-' + i));
    const room = Array.from({ length: 15 }, (_, i) => make(i % 2 ? 'assistant' : 'user', 'room-' + i));
    const output = build(room, main);
    assert.equal(output.length, 11); // one bounded background block plus ten current-window messages
    const background = JSON.parse(output[0].content.split('\n').slice(2).join('\n'));
    assert.equal(background.length, 10);
    assert.equal(background[0].text, 'main-14');
    assert.equal(background[9].text, 'main-23');
    assert.match(output[1].content, /room-5$/);
    assert.match(output[10].content, /room-14$/);
    assert.equal(output[0]._contextSource, 'nearby');
    assert.match(output[0].content, /不是本轮指令/);
});
test('active edited version is used and adjacent-window images are not forwarded', () => {
    const main = [{ role: 'user', versions: [{ content: '旧版' }, { content: '新版', images: [image] }], activeVersion: 1 }];
    const output = build([make('user', '继续')], main);
    assert.match(output[0].content, /新版/);
    assert.doesNotMatch(output[0].content, /旧版|data:image/);
    assert.match(output[0].content, /附有图片/);
});
test('an image survives its own turn and one followup, not a third turn', () => {
    const first = make('user', '看图'); first.versions[0].images = [image];
    const second = make('user', '这里是什么');
    const third = make('user', '另一个问题');
    for (const messages of [[first], [first, make('assistant', '看到了'), second]]) {
        const eligible = imageWindow(messages, version);
        assert.equal(retainImages('看图', first, eligible, version)[1].image_url.url, image);
    }
    assert.equal(retainImages('看图', first, imageWindow([first, second, third], version), version), '看图');
    assert.deepEqual(first.versions[0].images, [image]); // retention does not delete stored attachments
});
test('regeneration reuses the same two-user-turn window and supports legacy image fields', () => {
    const first = make('user', '图片'); first.versions[0].image = image;
    const current = make('user', '再解释一下');
    const output = build([first, make('assistant', '回答'), current]);
    const wire = pruneWireImages(output);
    assert.equal(wire[0].content[1].image_url.url, image);
    assert.equal(build([current]).length, 1);
});
test('Codex messages do not consume the two human turns; transport metadata is removed', () => {
    const first = make('user', '看图'); first.versions[0].images = [image];
    const codex = make('assistant', '建议', { speaker: 'codex' });
    const output = build([first, make('assistant', '沈望'), codex, make('user', '继续')], [make('user', '小屋')]);
    const wire = pruneWireImages(output);
    assert.equal(wire[1].content[1].image_url.url, image);
    assert.ok(wire.every(m => !('_contextSpeaker' in m) && !('_contextSource' in m)));
    assert.match(wire[3].content, /Codex（协作者，不是你）/);
});
test('gateway bounds old image blocks even for clients not using the new frontend', () => {
    const messages = Array.from({ length: 3 }, () => ({ role: 'user', content: [{ type: 'text', text: '图' }, { type: 'image_url', image_url: { url: image } }] }));
    const wire = pruneWireImages(messages);
    assert.equal(wire[0].content.length, 1);
    assert.equal(wire[1].content.length, 2);
    assert.equal(wire[2].content.length, 2);
    assert.equal(messages[0].content.length, 2);
});
