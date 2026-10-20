'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { applyProviderSettings, providerSettingsForFullSync, applyChatPreferences, applyReactionPreference, normalizeProviderSettings } = require('../chat-settings');

const existing = {
    _version: 8,
    suppliers: [{ name: 'old', url: 'https://old.example/v1', key: 'old-key' }],
    activeSupIndex: 0,
    activeChatId: 'main',
    chatSessions: [{ id: 'main', messages: [{ _id: 'u1', role: 'user', shenReaction: '🐶' }] }],
    preferences: { shenReactionEnabled: true, anotherPreference: 'keep-me' }
};

test('provider settings update atomically without replacing chats or preferences', () => {
    const result = applyProviderSettings(existing, {
        suppliers: [{ name: 'new', url: 'https://new.example/v1', key: 'new-key' }], activeSupIndex: 0
    });
    assert.equal(result.newVersion, 9);
    assert.equal(result.data.suppliers[0].key, 'new-key');
    assert.strictEqual(result.data.chatSessions, existing.chatSessions);
    assert.strictEqual(result.data.preferences, existing.preferences);
});

test('reaction preference preserves provider keys, chats and unrelated preferences', () => {
    const result = applyReactionPreference(existing, false);
    assert.equal(result.data.preferences.shenReactionEnabled, false);
    assert.equal(result.data.preferences.anotherPreference, 'keep-me');
    assert.strictEqual(result.data.suppliers, existing.suppliers);
    assert.strictEqual(result.data.chatSessions, existing.chatSessions);
});

test('model switch notice preference is boolean and preserves unrelated state', () => {
    const result = applyChatPreferences(existing, { modelSwitchNoticeEnabled: false });
    assert.equal(result.data.preferences.modelSwitchNoticeEnabled, false);
    assert.equal(result.data.preferences.shenReactionEnabled, true);
    assert.equal(result.data.preferences.anotherPreference, 'keep-me');
    assert.strictEqual(result.data.suppliers, existing.suppliers);
    assert.strictEqual(result.data.chatSessions, existing.chatSessions);
    assert.throws(() => applyChatPreferences(existing, { modelSwitchNoticeEnabled: 'false' }), /开关值无效/);
    assert.throws(() => applyChatPreferences(existing, {}), /没有可保存/);
});

test('a saved disabled model notice stays disabled when another preference changes', () => {
    const disabled = applyChatPreferences(existing, { modelSwitchNoticeEnabled: false }).data;
    const updated = applyReactionPreference(disabled, false);
    assert.equal(updated.data.preferences.modelSwitchNoticeEnabled, false);
    assert.equal(updated.data.preferences.shenReactionEnabled, false);
});

test('provider settings reject invalid or empty collections', () => {
    assert.throws(() => normalizeProviderSettings({ suppliers: [], activeSupIndex: 0 }), /1 至 20/);
    assert.throws(() => normalizeProviderSettings({ suppliers: [{ name: '', url: 'x', key: '' }], activeSupIndex: 0 }), /名称无效/);
    assert.throws(() => normalizeProviderSettings({ suppliers: [{ name: 'x', url: 'x', key: '' }], activeSupIndex: 2 }), /序号无效/);
});

test('full config sync cannot erase or replace configured providers', () => {
    const emptyTab = providerSettingsForFullSync(existing, { suppliers: [], activeSupIndex: 0 });
    assert.strictEqual(emptyTab.suppliers, existing.suppliers);
    assert.equal(emptyTab.activeSupIndex, existing.activeSupIndex);

    const staleTab = providerSettingsForFullSync(existing, {
        suppliers: [{ name: 'stale', url: 'https://stale.example/v1', key: '' }],
        activeSupIndex: 0
    });
    assert.strictEqual(staleTab.suppliers, existing.suppliers);
    assert.equal(staleTab.suppliers[0].key, 'old-key');
});

test('full config sync can bootstrap providers when none exist yet', () => {
    const result = providerSettingsForFullSync({ _version: 1, suppliers: [] }, {
        suppliers: [{ name: 'first', url: 'https://first.example/v1', key: 'first-key' }],
        activeSupIndex: 0
    });
    assert.equal(result.suppliers[0].key, 'first-key');
    assert.equal(result.activeSupIndex, 0);
});
