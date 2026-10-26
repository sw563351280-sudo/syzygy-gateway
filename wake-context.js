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

function normalizedMessageRole(message) {
    return message?.role === 'ai' ? 'assistant' : message?.role;
}

function conversationMessageKey(message) {
    const role = normalizedMessageRole(message);
    const content = normalizedMessageContent(message);
    return role && content ? `${role}\u0000${content}` : '';
}

// Zep historically used one global session, so an old workroom turn may still
// be present there. Only accept Zep rows that also exist in the persisted main
// conversation; web_config remains the channel boundary and the freshest tail.
function filterConversationHistoryToReference(messages = [], referenceMessages = []) {
    const referencesByKey = new Map();
    for (const reference of sortConversationMessages(referenceMessages)) {
        const key = conversationMessageKey(reference);
        if (!key) continue;
        if (!referencesByKey.has(key)) referencesByKey.set(key, []);
        referencesByKey.get(key).push(reference);
    }
    const filtered = [];
    for (const message of sortConversationMessages(messages)) {
        const matches = referencesByKey.get(conversationMessageKey(message));
        if (!matches?.length) continue;
        const reference = matches.shift();
        if (messageTimestampMs(message) !== null || messageTimestampMs(reference) === null) {
            filtered.push(message);
            continue;
        }
        filtered.push({ ...message, created_at: new Date(messageTimestampMs(reference)).toISOString() });
    }
    return filtered;
}

function dedupeChronologicalMessages(entries = []) {
    const kept = [];
    for (const entry of entries) {
        const content = normalizedMessageContent(entry.message);
        if (!content) continue;
        const role = normalizedMessageRole(entry.message);
        const time = messageTimestampMs(entry.message);
        const duplicateIndex = kept.findIndex(previous => {
            const previousRole = normalizedMessageRole(previous.message);
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
        usedZep: selected.some(entry => entry.source === 'zep'),
        sources: [...new Set(selected.map(entry => entry.source))],
    };
}

module.exports = {
    conversationMessageKey,
    filterConversationHistoryToReference,
    messageTimestampMs,
    selectRecentWakeHistory,
    sortConversationMessages,
};
