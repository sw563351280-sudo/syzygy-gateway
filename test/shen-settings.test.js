'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createShenSettings, MAX_PROMPT_LENGTH } = require('../shen-settings');

function fixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shen-settings-'));
    const legacyPromptFile = path.join(directory, 'system_prompt.txt');
    fs.writeFileSync(legacyPromptFile, '原始沈望 prompt');
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    return { directory, legacyPromptFile, store: createShenSettings({ directory, legacyPromptFile }) };
}

test('first load seeds both variants from the existing system prompt', t => {
    const { store } = fixture(t);
    assert.deepEqual(store.settings(), {
        active: 'A',
        prompts: { A: '原始沈望 prompt', B: '原始沈望 prompt' },
        updatedAt: null
    });
    assert.equal(store.activePrompt(), '原始沈望 prompt');
});

test('A/B prompts and active selection persist across restart', t => {
    const { directory, legacyPromptFile, store } = fixture(t);
    const saved = store.saveSettings({ active: 'B', prompts: { A: 'A 的人格', B: 'B 的人格' }, expectedUpdatedAt: null });
    const restored = createShenSettings({ directory, legacyPromptFile });
    assert.equal(restored.settings().active, 'B');
    assert.equal(restored.activePrompt(), 'B 的人格');
    assert.equal(restored.settings().updatedAt, saved.updatedAt);
});

test('stale pages and empty or oversized prompts cannot overwrite settings', t => {
    const { store } = fixture(t);
    store.saveSettings({ active: 'A', prompts: { A: '新版 A', B: '新版 B' }, expectedUpdatedAt: null });
    assert.throws(() => store.saveSettings({ active: 'B', prompts: { A: '旧版 A', B: '旧版 B' }, expectedUpdatedAt: null }), /其他页面更新/);
    assert.throws(() => store.saveSettings({ active: 'A', prompts: { A: '', B: 'B' } }), /不能为空/);
    assert.throws(() => store.saveSettings({ active: 'A', prompts: { A: 'A', B: 'x'.repeat(MAX_PROMPT_LENGTH + 1) } }), /最多/);
    assert.equal(store.activePrompt(), '新版 A');
});

test('backup restores settings when the primary file is missing', t => {
    const { directory, legacyPromptFile, store } = fixture(t);
    store.saveSettings({ active: 'B', prompts: { A: 'A', B: '保留下来' }, expectedUpdatedAt: null });
    fs.unlinkSync(path.join(directory, 'shen-settings.json'));
    assert.equal(createShenSettings({ directory, legacyPromptFile }).activePrompt(), '保留下来');
});
