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

// Provider credentials have their own atomic endpoint. A general chat/config
// sync may come from an older or half-loaded tab, so it must not replace an
// already configured provider list. We only accept legacy bootstrap data when
// the server does not have any providers yet.
function providerSettingsForFullSync(existingData, input) {
    const existingSuppliers = Array.isArray(existingData?.suppliers) ? existingData.suppliers : [];
    if (existingSuppliers.length) {
        const activeSupIndex = Number.isInteger(existingData.activeSupIndex)
            && existingData.activeSupIndex >= 0
            && existingData.activeSupIndex < existingSuppliers.length
            ? existingData.activeSupIndex : 0;
        return { suppliers: existingSuppliers, activeSupIndex };
    }
    try {
        return normalizeProviderSettings(input);
    } catch (_) {
        return { suppliers: existingSuppliers, activeSupIndex: 0 };
    }
}

function applyChatPreferences(existingData, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('聊天偏好无效');
    const allowed = ['shenReactionEnabled', 'modelSwitchNoticeEnabled'];
    const patch = {};
    for (const key of allowed) {
        if (Object.hasOwn(input, key)) {
            if (typeof input[key] !== 'boolean') throw new Error('聊天偏好开关值无效');
            patch[key] = input[key];
        }
    }
    if (!Object.keys(patch).length) throw new Error('没有可保存的聊天偏好');
    const config = existingData || { suppliers: [], chatSessions: [], activeSupIndex: 0, activeChatId: 'main' };
    const newVersion = (config._version || 0) + 1;
    const preferences = { ...(config.preferences || {}), ...patch };
    return { data: { ...config, preferences, _version: newVersion }, newVersion, preferences };
}

function applyReactionPreference(existingData, enabled) {
    return applyChatPreferences(existingData, { shenReactionEnabled: enabled });
}

module.exports = { normalizeProviderSettings, applyProviderSettings, providerSettingsForFullSync, applyChatPreferences, applyReactionPreference };
