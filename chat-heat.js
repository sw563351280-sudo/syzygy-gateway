'use strict';

const DEFAULT_HEAT_RULES = Object.freeze({
    roundPoints: 1.5,
    maxRoundPoints: 120,
    charactersPerPoint: 50,
    maxCharactersPerMessage: 600,
    maxCharacterPoints: 120,
    thresholds: Object.freeze([1, 100, 190])
});

function activeVersion(message) {
    const versions = Array.isArray(message?.versions) ? message.versions : [];
    return versions[message?.activeVersion || 0] || versions[0] || message || {};
}

function textContent(value) {
    if (typeof value === 'string') return value;
    if (!Array.isArray(value)) return '';
    return value.map(part => typeof part === 'string' ? part : (part?.type === 'text' ? part.text || '' : '')).join('\n');
}

function visibleText(message) {
    const version = activeVersion(message);
    return textContent(version.content === undefined ? message?.content : version.content);
}

function cleanConversationText(value) {
    return String(value || '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/<(?:work_record|NEXT_WAKE|tool_call|tool_result)\b[^>]*>[\s\S]*?<\/(?:work_record|NEXT_WAKE|tool_call|tool_result)>/gi, ' ')
        .replace(/^\s*(?:at\s+\S+\s+\([^\n]+\)|(?:DEBUG|INFO|WARN|ERROR)\b.*|\d{4}-\d{2}-\d{2}[T ][^\s]+\s+.*)$/gim, ' ')
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function characterCount(value) {
    let count = 0;
    for (const character of Array.from(cleanConversationText(value))) {
        if (/[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(character)) count++;
    }
    return count;
}

function timestampOf(message) {
    const version = activeVersion(message);
    const raw = version.fullTime || message?.fullTime || version.time || message?.time || message?.created_at || message?.createdAt || message?.timestamp || null;
    if (!raw) return null;
    const serialized = String(raw);
    const hasClockWithoutZone = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(serialized) && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(serialized);
    const value = new Date(hasClockWithoutZone ? `${serialized}+08:00` : serialized).getTime();
    return Number.isFinite(value) ? value : null;
}

function shanghaiDate(timestamp) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date(timestamp));
    const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${value.year}-${value.month}-${value.day}`;
}

function heatLevel(score, thresholds = DEFAULT_HEAT_RULES.thresholds) {
    if (score < thresholds[0]) return 0;
    if (score < thresholds[1]) return 1;
    if (score < thresholds[2]) return 2;
    return 3;
}

function buildChatHeat(messages = [], options = {}) {
    const rules = { ...DEFAULT_HEAT_RULES, ...(options.rules || {}) };
    const year = Number(options.year);
    const dailyMessages = new Map();
    messages.forEach((message, index) => {
        if (!['user', 'assistant'].includes(message?.role)) return;
        const timestamp = timestampOf(message);
        const text = visibleText(message);
        if (timestamp === null || !cleanConversationText(text)) return;
        const date = shanghaiDate(timestamp);
        if (Number.isInteger(year) && !date.startsWith(`${year}-`)) return;
        if (!dailyMessages.has(date)) dailyMessages.set(date, []);
        dailyMessages.get(date).push({ role: message.role, text, timestamp, index });
    });

    const days = [];
    for (const [date, rows] of [...dailyMessages.entries()].sort(([left], [right]) => left.localeCompare(right))) {
        rows.sort((left, right) => left.timestamp - right.timestamp || left.index - right.index);
        let awaitingReply = false;
        let rounds = 0;
        let userCharacters = 0;
        let messagesCount = 0;
        for (const row of rows) {
            messagesCount++;
            if (row.role === 'user') {
                awaitingReply = true;
                userCharacters += Math.min(rules.maxCharactersPerMessage, characterCount(row.text));
            } else if (awaitingReply) {
                rounds++;
                awaitingReply = false;
            }
        }
        const roundScore = Math.min(rules.maxRoundPoints, rounds * rules.roundPoints);
        const characterScore = Math.min(rules.maxCharacterPoints, userCharacters / rules.charactersPerPoint);
        const score = Math.round((roundScore + characterScore) * 10) / 10;
        days.push({ date, level: heatLevel(score, rules.thresholds), score, rounds, userCharacters, messages: messagesCount });
    }
    return { year: Number.isInteger(year) ? year : null, rules: { ...rules, thresholds: [...rules.thresholds] }, days };
}

module.exports = { DEFAULT_HEAT_RULES, activeVersion, buildChatHeat, characterCount, cleanConversationText, heatLevel, shanghaiDate, timestampOf, visibleText };
