'use strict';

const fs = require('fs');
const path = require('path');

const dataDir = process.argv[2];
const outputFile = process.argv[3];

if (!dataDir || !outputFile) {
    console.error('usage: node recover_interrupted_chat_report.js <data-dir> <output-file>');
    process.exit(2);
}

function readJson(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_) {
        return fallback;
    }
}

function normalizeMessage(message, source) {
    if (!message || !message.role) return null;
    const version = Array.isArray(message.versions) && message.versions.length
        ? (message.versions[message.activeVersion || 0] || message.versions[0])
        : message;
    const content = typeof version.content === 'string' ? version.content : '';
    if (!content) return null;
    return {
        role: message.role,
        content,
        time: version.fullTime || message.fullTime || message.time || null,
        id: message._id || message.id || null,
        source
    };
}


const incidentFrom = Date.parse('2026-10-12T01:30:00Z');
const incidentTo = Date.parse('2026-10-12T04:15:00Z');
const inIncident = message => { const time = Date.parse(message.time); return time >= incidentFrom && time <= incidentTo; };
const transcriptMessages = [];
const transcriptsDir = path.join(dataDir, 'transcripts');
if (fs.existsSync(transcriptsDir)) {
    for (const name of fs.readdirSync(transcriptsDir).filter(name => name.endsWith('.json')).sort()) {
        const chunks = readJson(path.join(transcriptsDir, name), []);
        for (const chunk of Array.isArray(chunks) ? chunks : []) {
            for (const message of Array.isArray(chunk.messages) ? chunk.messages : []) {
                const normalized = normalizeMessage(message, `transcripts/${name}`);
                if (normalized) transcriptMessages.push(normalized);
            }
        }
    }
}

const buffer = readJson(path.join(dataDir, 'transcript_buffer.json'), {});
for (const message of Array.isArray(buffer.messages) ? buffer.messages : []) {
    const normalized = normalizeMessage(message, 'transcript_buffer.json');
    if (normalized) transcriptMessages.push(normalized);
}

transcriptMessages.sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));

const config = readJson(path.join(dataDir, 'web_config.json'), {});
const sessions = (Array.isArray(config.chatSessions) ? config.chatSessions : []).map(session => ({
    id: session.id,
    name: session.name,
    messages: (Array.isArray(session.messages) ? session.messages : [])
        .map(message => normalizeMessage(message, `web_config:${session.id}`))
        .filter(Boolean)
        .filter(inIncident)
}));

const report = {
    generatedAt: new Date().toISOString(),
    configVersion: config._version || 0,
    activeChatId: config.activeChatId || null,
    transcriptTail: transcriptMessages.filter(inIncident),
    sessions: sessions.filter(session => session.id === config.activeChatId || session.id === 'main')
};


report.incidentRange = { from: new Date(incidentFrom).toISOString(), to: new Date(incidentTo).toISOString() };
fs.writeFileSync(outputFile, JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(`wrote recovery report: ${report.transcriptTail.length} transcript messages, ${report.sessions.length} sessions`);
