'use strict';

function normalizeProviderSettings(input) {
    if (!Array.isArray(input?.suppliers) || input.suppliers.length < 1 || input.suppliers.length > 20) {
        throw new Error('接口列表需要保留 1 至 20 项');
    }
    const suppliers = input.suppliers.map((supplier, index) => {
        const name = String(supplier?.name || '').trim();
        const url = String(supplier?.url || '').trim();
        const key = String(supplier?.key || '').trim();
        if (!name || name.length > 120) throw new Error(`第 ${index + 1} 个接口名称无效`);
        if (!url || url.length > 2048) throw new Error(`第 ${index + 1} 个接口地址无效`);
        if (key.length > 20000) throw new Error(`第 ${index + 1} 个 API Key 过长`);
        return { name, url, key };
    });
    const activeSupIndex = Number(input.activeSupIndex);
    if (!Number.isInteger(activeSupIndex) || activeSupIndex < 0 || activeSupIndex >= suppliers.length) {
        throw new Error('正在使用的接口序号无效');
    }
    return { suppliers, activeSupIndex };
}

function applyProviderSettings(existingData, input) {
    const config = existingData || { chatSessions: [], activeChatId: 'main' };
    const normalized = normalizeProviderSettings(input);
    const newVersion = (config._version || 0) + 1;
    return { data: { ...config, ...normalized, _version: newVersion }, newVersion, normalized };
}

function applyReactionPreference(existingData, enabled) {
    if (typeof enabled !== 'boolean') throw new Error('表情回应开关值无效');
    const config = existingData || { suppliers: [], chatSessions: [], activeSupIndex: 0, activeChatId: 'main' };
    const newVersion = (config._version || 0) + 1;
    const preferences = { ...(config.preferences || {}), shenReactionEnabled: enabled };
    return { data: { ...config, preferences, _version: newVersion }, newVersion, preferences };
}

module.exports = { normalizeProviderSettings, applyProviderSettings, applyReactionPreference };
