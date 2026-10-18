'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');
const { DEFAULT_HEAT_RULES, characterCount, heatLevel, shanghaiDate, timestampOf, visibleText } = require('./chat-heat');

const TRANSCRIPT_FILE = /^\d{4}-\d{2}\.json$/;
const WORKROOM_MARKER = /【溯星小屋三方共创工作区(?:\s*·\s*讨论)?】|正在参加[“\"]溯星小屋[”\"]的三方共创工作区|【Codex 当前设定】/;

function monthAfter(value) {
    const [year, month] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function missingArchiveMonths(fileNames = []) {
    const months = [...new Set(fileNames.map(name => path.basename(name, '.json')).filter(value => /^\d{4}-\d{2}$/.test(value)))].sort();
    if (months.length < 2) return [];
    const present = new Set(months), missing = [];
    for (let month = months[0]; month < months.at(-1); month = monthAfter(month)) {
        if (!present.has(month)) missing.push(month);
    }
    return missing;
}

function roundKey(user, assistant, timestamp) {
    return crypto.createHash('sha256')
        .update(String(timestamp)).update('\0')
        .update(visibleText(user)).update('\0')
        .update(visibleText(assistant))
        .digest('base64url');
}

function messageTimestamp(message, fallback = null) {
    return timestampOf(message) ?? timestampOf({ time: fallback });
}

function transcriptRounds(chunks = [], audit = {}) {
    const rounds = [];
    for (const chunk of Array.isArray(chunks) ? chunks : []) {
        let pendingUser = null;
        for (const message of Array.isArray(chunk?.messages) ? chunk.messages : []) {
            if (message?.role === 'user') {
                if (pendingUser) audit.unpairedUsers = (audit.unpairedUsers || 0) + 1;
                pendingUser = message;
                continue;
            }
            if (message?.role !== 'assistant' || !pendingUser) continue;
            const user = pendingUser;
            pendingUser = null;
            const userText = visibleText(user);
            if (WORKROOM_MARKER.test(userText)) {
                audit.workroomRounds = (audit.workroomRounds || 0) + 1;
                continue;
            }
            const timestamp = messageTimestamp(user, chunk?.timestamp);
            if (timestamp === null || !userText.trim() || !visibleText(message).trim()) {
                audit.invalidRounds = (audit.invalidRounds || 0) + 1;
                continue;
            }
            rounds.push({ user, assistant: message, timestamp });
        }
        if (pendingUser) audit.unpairedUsers = (audit.unpairedUsers || 0) + 1;
    }
    return rounds;
}

function createTranscriptAccumulator(options = {}) {
    const audit = { sourceFiles: 0, sourceMessages: 0, completeRounds: 0, duplicateRounds: 0, workroomRounds: 0, invalidRounds: 0, unpairedUsers: 0 };
    const rules = { ...DEFAULT_HEAT_RULES, ...(options.rules || {}) };
    const seen = new Set(), daily = new Map(), fileNames = [];
    function addChunks(chunks) {
        for (const chunk of Array.isArray(chunks) ? chunks : []) audit.sourceMessages += Array.isArray(chunk?.messages) ? chunk.messages.length : 0;
        for (const round of transcriptRounds(chunks, audit)) {
            const key = roundKey(round.user, round.assistant, round.timestamp);
            if (seen.has(key) || options.excludeKeys?.has(key)) {
                audit.duplicateRounds++;
                continue;
            }
            seen.add(key);
            audit.completeRounds++;
            const date = shanghaiDate(round.timestamp);
            const day = daily.get(date) || { date, rounds: 0, userCharacters: 0, messages: 0 };
            day.rounds++;
            day.userCharacters += Math.min(rules.maxCharactersPerMessage, characterCount(visibleText(round.user)));
            day.messages += 2;
            daily.set(date, day);
        }
    }
    return {
        startSource(source) {
            audit.sourceFiles++;
            if (!source.buffer) fileNames.push(source.name);
        },
        addChunks,
        add(source) {
            this.startSource(source);
            const chunks = source.buffer ? [{ timestamp: source.data?.started_at, messages: source.data?.messages || [] }] : source.data;
            addChunks(chunks);
        },
        finish() {
            const days = [...daily.values()].sort((left, right) => left.date.localeCompare(right.date)).map(day => {
                const roundScore = Math.min(rules.maxRoundPoints, day.rounds * rules.roundPoints);
                const characterScore = Math.min(rules.maxCharacterPoints, day.userCharacters / rules.charactersPerPoint);
                const score = Math.round((roundScore + characterScore) * 10) / 10;
                return { ...day, level: heatLevel(score, rules.thresholds), score };
            });
            const dates = days.map(day => day.date);
            const result = {
                year: null,
                rules: { ...rules, thresholds: [...rules.thresholds] },
                days,
                archive: {
                    firstDate: dates[0] || null,
                    lastDate: dates.at(-1) || null,
                    missingMonths: missingArchiveMonths(fileNames),
                    audit
                }
            };
            Object.defineProperty(result, '_roundKeys', { value: seen });
            return result;
        }
    };
}

function forEachJsonArrayItem(file, visit) {
    const descriptor = fs.openSync(file, 'r'), buffer = Buffer.allocUnsafe(128 * 1024), decoder = new StringDecoder('utf8');
    let depth = 0, quoted = false, escaped = false, arrayStarted = false, arrayEnded = false, parts = [];
    function consume(value) {
        let start = depth > 0 ? 0 : -1;
        for (let index = 0; index < value.length; index++) {
            const character = value[index];
            if (depth === 0) {
                if (character === '[') { arrayStarted = true; continue; }
                if (character === ']') { arrayEnded = true; continue; }
                if (character === '{') { start = index; depth = 1; continue; }
                if (!/[\s,]/.test(character)) throw new Error(`${path.basename(file)} 的 JSON 结构损坏`);
                continue;
            }
            if (quoted) {
                if (escaped) escaped = false;
                else if (character === '\\') escaped = true;
                else if (character === '"') quoted = false;
                continue;
            }
            if (character === '"') quoted = true;
            else if (character === '{') depth++;
            else if (character === '}') {
                depth--;
                if (depth === 0) {
                    parts.push(value.slice(start, index + 1));
                    visit(JSON.parse(parts.join('')));
                    parts = [];
                    start = -1;
                }
            }
        }
        if (start >= 0) parts.push(value.slice(start));
    }
    try {
        let bytes;
        while ((bytes = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) consume(decoder.write(buffer.subarray(0, bytes)));
        const tail = decoder.end();
        if (tail) consume(tail);
    } finally {
        fs.closeSync(descriptor);
    }
    if (!arrayStarted || !arrayEnded || quoted || depth !== 0 || parts.length) throw new Error(`${path.basename(file)} 不是完整的对话数组`);
}

function aggregateTranscriptSources(sources = [], options = {}) {
    const accumulator = createTranscriptAccumulator(options);
    for (const source of sources) accumulator.add(source);
    return accumulator.finish();
}

function sourceSnapshot(transcriptsDir, bufferFile) {
    const entries = fs.existsSync(transcriptsDir)
        ? fs.readdirSync(transcriptsDir).filter(name => TRANSCRIPT_FILE.test(name)).sort().map(name => ({ name, file: path.join(transcriptsDir, name), buffer: false }))
        : [];
    if (bufferFile && fs.existsSync(bufferFile)) entries.push({ name: path.basename(bufferFile), file: bufferFile, buffer: true });
    const resolved = entries.map(entry => {
        const stat = fs.statSync(entry.file);
        return { ...entry, signature: `${entry.name}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}` };
    });
    return { entries: resolved, signature: resolved.map(entry => entry.signature).join('|') };
}

function createTranscriptHeatStore({ transcriptsDir, bufferFile, cacheFile = null }) {
    let archiveSignature = null, bufferSignature = null;
    let archiveHeat = null, bufferHeat = null, cached = null;
    function build(entries, options = {}) {
        const accumulator = createTranscriptAccumulator(options);
        for (const entry of entries) {
            if (entry.buffer) {
                accumulator.add({ ...entry, data: JSON.parse(fs.readFileSync(entry.file, 'utf8')) });
                continue;
            }
            accumulator.startSource(entry);
            forEachJsonArrayItem(entry.file, chunk => accumulator.addChunks([chunk]));
        }
        return accumulator.finish();
    }
    function restoreArchive(signature) {
        if (!cacheFile || !fs.existsSync(cacheFile)) return null;
        try {
            const stored = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
            if (stored.version !== 1 || stored.signature !== signature || !stored.heat?.archive || !Array.isArray(stored.roundKeys)) return null;
            Object.defineProperty(stored.heat, '_roundKeys', { value: new Set(stored.roundKeys) });
            return stored.heat;
        } catch (_) {
            return null;
        }
    }
    function saveArchive(signature, heat) {
        if (!cacheFile) return;
        const temporary = `${cacheFile}.tmp.${process.pid}.${Date.now()}`;
        try {
            fs.writeFileSync(temporary, JSON.stringify({ version: 1, signature, heat, roundKeys: [...heat._roundKeys] }), 'utf8');
            fs.renameSync(temporary, cacheFile);
        } catch (error) {
            try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch (_) {}
            console.warn('⚠️ [heart trail] 缓存写入失败:', error.message);
        }
    }
    function combine(base, overlay) {
        const rules = base.rules;
        const merged = new Map(base.days.map(day => [day.date, { ...day }]));
        for (const day of overlay.days) {
            const target = merged.get(day.date) || { date: day.date, rounds: 0, userCharacters: 0, messages: 0 };
            target.rounds += day.rounds;
            target.userCharacters += day.userCharacters;
            target.messages += day.messages;
            const roundScore = Math.min(rules.maxRoundPoints, target.rounds * rules.roundPoints);
            const characterScore = Math.min(rules.maxCharacterPoints, target.userCharacters / rules.charactersPerPoint);
            target.score = Math.round((roundScore + characterScore) * 10) / 10;
            target.level = heatLevel(target.score, rules.thresholds);
            merged.set(day.date, target);
        }
        const days = [...merged.values()].sort((left, right) => left.date.localeCompare(right.date));
        const audit = {};
        for (const key of Object.keys(base.archive.audit)) audit[key] = (base.archive.audit[key] || 0) + (overlay.archive.audit[key] || 0);
        return { year: null, rules, days, archive: { firstDate: days[0]?.date || null, lastDate: days.at(-1)?.date || null, missingMonths: base.archive.missingMonths, audit } };
    }
    function refresh() {
        const snapshot = sourceSnapshot(transcriptsDir, bufferFile);
        const archives = snapshot.entries.filter(entry => !entry.buffer), buffers = snapshot.entries.filter(entry => entry.buffer);
        const nextArchiveSignature = archives.map(entry => entry.signature).join('|');
        const nextBufferSignature = buffers.map(entry => entry.signature).join('|');
        if (!archiveHeat || archiveSignature !== nextArchiveSignature) {
            const restored = restoreArchive(nextArchiveSignature);
            archiveHeat = restored || build(archives);
            archiveSignature = nextArchiveSignature;
            if (!restored) saveArchive(nextArchiveSignature, archiveHeat);
            bufferSignature = null;
        }
        if (!bufferHeat || bufferSignature !== nextBufferSignature) {
            bufferHeat = build(buffers, { excludeKeys: archiveHeat._roundKeys });
            bufferSignature = nextBufferSignature;
        }
        cached = combine(archiveHeat, bufferHeat);
    }
    return {
        get(year) {
            refresh();
            const numericYear = Number(year);
            return {
                year: numericYear,
                rules: cached.rules,
                days: cached.days.filter(day => day.date.startsWith(`${numericYear}-`)),
                archive: { ...cached.archive, missingMonths: cached.archive.missingMonths.filter(month => month.startsWith(`${numericYear}-`)) }
            };
        },
        diagnostics() {
            return { signature: `${archiveSignature || ''}||${bufferSignature || ''}`, archive: cached?.archive || null };
        }
    };
}

module.exports = { WORKROOM_MARKER, aggregateTranscriptSources, createTranscriptHeatStore, missingArchiveMonths, transcriptRounds };
