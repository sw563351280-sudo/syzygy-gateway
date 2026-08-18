'use strict';

function messageTimestampMs(message) {
    const raw = message?.created_at || message?.createdAt || message?.timestamp
        || message?.updated_at || message?.updatedAt || message?.fullTime
        || message?.metadata?.created_at || message?.metadata?.timestamp || null;
    if (!raw) return null;
    const parsed = new Date(raw).getTime();
    return Number.isFinite(parsed) ? parsed : null;
}

function sortConversationMessages(messages = []) {
    return messages
        .filter(Boolean)
        .map((message, index) => ({ message, index, time: messageTimestampMs(message) }))
        .sort((a, b) => {
            if (a.time === null && b.time === null) return a.index - b.index;
            if (a.time === null) return -1;
            if (b.time === null) return 1;
            return a.time - b.time || a.index - b.index;
        })
        .map(item => item.message);
}

function normalizedMessageContent(message) {
    return String(message?.content || '').replace(/\s+/g, ' ').trim();
}

function dedupeChronologicalMessages(entries = []) {
    const kept = [];
    for (const entry of entries) {
        const content = normalizedMessageContent(entry.message);
        if (!content) continue;
        const role = entry.message.role === 'ai' ? 'assistant' : entry.message.role;
        const time = messageTimestampMs(entry.message);
        const duplicateIndex = kept.findIndex(previous => {
            const previousRole = previous.message.role === 'ai' ? 'assistant' : previous.message.role;
            if (previousRole !== role || normalizedMessageContent(previous.message) !== content) return false;
            const previousTime = messageTimestampMs(previous.message);
            if (time === null || previousTime === null) return time === previousTime;
            return Math.abs(time - previousTime) <= 2 * 60 * 1000;
        });
        if (duplicateIndex === -1) {
            kept.push(entry);
        } else if (entry.source === 'zep' && kept[duplicateIndex].source !== 'zep') {
            // Zep is the canonical conversation store, but it does not retain
            // the local `model: proactive` provenance. Preserve that marker so
            // later turns can still recognize their own proactive messages.
            const localModel = kept[duplicateIndex].message?.model;
            kept[duplicateIndex] = {
                ...entry,
                message: localModel && !entry.message?.model
                    ? { ...entry.message, model: localModel }
                    : entry.message,
            };
        }
    }
    return kept;
}

function selectRecentWakeHistory(zepMessages = [], fallbackMessages = [], limit = 6) {
    const safeLimit = Math.max(0, Number(limit) || 0);
    const combined = [
        ...fallbackMessages.map(message => ({ message, source: 'web_config' })),
        ...zepMessages.map(message => ({ message, source: 'zep' })),
    ].sort((a, b) => {
        const aTime = messageTimestampMs(a.message);
        const bTime = messageTimestampMs(b.message);
        if (aTime === null && bTime === null) return 0;
        if (aTime === null) return -1;
        if (bTime === null) return 1;
        return aTime - bTime;
    });
    const merged = dedupeChronologicalMessages(combined);
    const selected = merged.slice(-safeLimit);
    return {
        messages: selected.map(entry => entry.message),
        usedFallback: selected.some(entry => entry.source === 'web_config'),
    };
}

function formatProactiveMessagesForContext(messages = [], limit = 3) {
    const safeLimit = Math.max(0, Number(limit) || 0);
    const proactive = sortConversationMessages(messages).filter(message => {
        const role = message?.role === 'ai' ? 'assistant' : message?.role;
        return role === 'assistant'
            && message?.model === 'proactive'
            && normalizedMessageContent(message);
    }).slice(-safeLimit);
    if (!proactive.length) return '';
    const lines = proactive.map(message => {
        const timestamp = messageTimestampMs(message);
        const timeLabel = timestamp === null ? '时间未知' : new Date(timestamp).toLocaleString('zh-CN', {
            timeZone: 'Asia/Shanghai',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hour12: false,
        });
        return `${timeLabel}：${normalizedMessageContent(message).slice(0, 800)}`;
    });
    return '【你最近主动发给江鱼的消息原文】\n'
        + '以下内容是你自己已经发送过的真实消息，不是唤醒摘要；可以承接和解释，但不要假装看不到，也不要原样复读。\n'
        + lines.join('\n');
}

module.exports = {
    formatProactiveMessagesForContext,
    messageTimestampMs,
    selectRecentWakeHistory,
    sortConversationMessages,
};
