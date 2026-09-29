'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const WORKROOM_ID = 'syzygy-workroom';

function activeVersion(message) {
    const versions = Array.isArray(message?.versions) ? message.versions : [];
    return versions[message?.activeVersion || 0] || versions[0] || message || {};
}

function messageTime(message) {
    const version = activeVersion(message);
    const value = version.fullTime || message?.fullTime || version.createdAt || message?.createdAt || null;
    return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function dateInTimeZone(value, timeZone = 'Asia/Shanghai') {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(value ? new Date(value) : new Date());
}

function transcriptMessage(message) {
    const version = activeVersion(message);
    const images = Array.isArray(version.images) ? version.images : (version.image ? [version.image] : []);
    const speaker = message.role === 'user' ? 'jiangyu' : message.speaker === 'codex' ? 'codex' : 'shenwang';
    return {
        id: String(message._id || message.id || ''),
        role: message.role === 'user' ? 'user' : 'assistant',
        speaker,
        content: String(version.content || message.content || ''),
        createdAt: messageTime(message),
        ...(message.role === 'user' && message.workroomTarget ? { target: message.workroomTarget } : {}),
        ...(images.length ? { attachments: images.map((_image, index) => ({
            type: 'image', messageId: String(message._id || message.id || ''), index, source: 'web-config'
        })) } : {})
    };
}

function groupWorkroomTurns(messages = []) {
    const turns = [];
    let current = null;
    for (const message of messages) {
        if (!message || !['user', 'assistant'].includes(message.role)) continue;
        if (message.role === 'user') {
            const normalized = transcriptMessage(message);
            current = {
                id: normalized.id || `turn-${turns.length + 1}`,
                date: dateInTimeZone(normalized.createdAt),
                startedAt: normalized.createdAt,
                messages: [normalized]
            };
            turns.push(current);
        } else if (current) current.messages.push(transcriptMessage(message));
    }
    return turns.map(turn => ({
        ...turn,
        updatedAt: turn.messages.map(row => row.createdAt).filter(Boolean).at(-1) || turn.startedAt,
        complete: turn.messages.some(row => row.speaker === 'codex' || row.speaker === 'shenwang')
    }));
}

function recentWorkroomMessages(messages = [], limit = 50) {
    const starts = [];
    messages.forEach((message, index) => { if (message?.role === 'user') starts.push(index); });
    if (!starts.length || starts.length <= limit) return messages;
    return messages.slice(starts[starts.length - limit]);
}

function readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

function atomicWrite(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
        fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
        fs.renameSync(temporary, file);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

function createWorkroomTranscriptArchive(directory) {
    function archive(chatSessions = []) {
        const room = chatSessions.find(session => session?.id === WORKROOM_ID || session?.type === 'codex-workroom');
        if (!room) return { turns: 0, files: 0 };
        const turns = groupWorkroomTurns(room.messages);
        const byDate = new Map();
        for (const turn of turns) {
            if (!byDate.has(turn.date)) byDate.set(turn.date, []);
            byDate.get(turn.date).push(turn);
        }
        for (const [date, incoming] of byDate) {
            const [year, month] = date.split('-');
            const file = path.join(directory, year, month, `${date}.json`);
            const existing = readJson(file, []);
            if (!Array.isArray(existing)) throw new Error(`工作区原文档案损坏：${date}`);
            const merged = new Map(existing.map(turn => [turn.id, turn]));
            for (const turn of incoming) merged.set(turn.id, turn);
            const next = [...merged.values()].sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
            if (JSON.stringify(next) !== JSON.stringify(existing)) atomicWrite(file, next);
        }
        return { turns: turns.length, files: byDate.size };
    }
    return { archive };
}

module.exports = { createWorkroomTranscriptArchive, groupWorkroomTurns, recentWorkroomMessages, transcriptMessage };
