'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { applyProviderSettings, applyReactionPreference, normalizeProviderSettings } = require('../chat-settings');

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

test('provider settings reject invalid or empty collections', () => {
    assert.throws(() => normalizeProviderSettings({ suppliers: [], activeSupIndex: 0 }), /1 至 20/);
    assert.throws(() => normalizeProviderSettings({ suppliers: [{ name: '', url: 'x', key: '' }], activeSupIndex: 0 }), /名称无效/);
    assert.throws(() => normalizeProviderSettings({ suppliers: [{ name: 'x', url: 'x', key: '' }], activeSupIndex: 2 }), /序号无效/);
});
