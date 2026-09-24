'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function createCostLedger({ filename, limit = 500, now = () => new Date().toISOString() }) {
    const records = new Map();
    let storageError = false, corrupt = false;
    try {
        const saved = JSON.parse(fs.readFileSync(filename, 'utf8'));
        if (saved.version !== 1 || !Array.isArray(saved.records)) throw Error('invalid ledger');
        for (const row of saved.records.slice(-limit)) {
            if (typeof row.turnId !== 'string' || !row.turn || !(row.turn.calls > 0)) throw Error('invalid row');
            if (!row.turn.finished) row.turn = { ...row.turn, finished: true, outcome: 'interrupted', complete: false, completeCny: false };
            records.set(row.turnId, row);
        }
    } catch (error) { if (error.code !== 'ENOENT') { storageError = true; corrupt = true; records.clear(); } }
    function persist() {
        if (corrupt) return; // Never overwrite an unreadable previous ledger.
        const temp = filename + '.' + randomUUID() + '.tmp';
        try {
            fs.mkdirSync(path.dirname(filename), { recursive: true });
            fs.writeFileSync(temp, JSON.stringify({ version: 1, records: [...records.values()] }), { mode: 0o600 });
            fs.renameSync(temp, filename);
            storageError = false;
        } catch (_) { storageError = true; }
        finally { try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch (_) {} }
    }
    return {
        record(event) {
            if (!event.turnId || !event.turn || !event.turn.calls) return;
            const previous = records.get(event.turnId);
            // Only observer's aggregate data, never request body, messages or API key.
            records.set(event.turnId, { turnId: event.turnId, host: event.host, model: event.model,
                startedAt: previous?.startedAt || now(), updatedAt: now(), turn: structuredClone(event.turn) });
            while (records.size > limit) records.delete(records.keys().next().value);
            persist();
        },
        snapshot() {
            const rows = [...records.values()];
            const finished = rows.filter(r => r.turn.finished).slice(-100);
            const complete = finished.filter(r => r.turn.complete && r.turn.completeCny && r.turn.outcome === 'completed');
            const total = complete.reduce((s, r) => s + (r.turn.knownCny || 0), 0);
            const known = finished.filter(r => r.turn.knownCny !== null);
            return { retainedLimit: limit, storageError, latest: rows.at(-1) || null,
                recent: { turns: finished.length, completeTurns: complete.length, incompleteTurns: finished.length - complete.length,
                    knownCny: known.length ? known.reduce((s, r) => s + r.turn.knownCny, 0) : null,
                    completeTotalCny: complete.length ? total : null,
                    averageCompleteCny: complete.length ? total / complete.length : null,
                    summaryCalls: finished.reduce((s, r) => s + (r.turn.summary?.calls || 0), 0) } };
        },
    };
}
module.exports = { createCostLedger };
