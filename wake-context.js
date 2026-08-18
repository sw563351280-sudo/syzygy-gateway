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
            kept[duplicateIndex] = entry;
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

module.exports = {
    messageTimestampMs,
    selectRecentWakeHistory,
    sortConversationMessages,
};
