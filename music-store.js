'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function initial() {
    return { version: 1, revision: 0, session: { mode: 'local', state: 'closed', song: null, updatedAt: 0, owner: null }, playlists: {}, events: [], cards: {}, feedback: [], summaries: [], offers: [] };
}

// Transactions never cross an await. A cross-process exclusive lock prevents lost
// updates if another gateway worker happens to share this directory.
function createStore(directory) {
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, 'library.json');
    const lock = path.join(directory, 'library.lock');
    function read() {
        try {
            const value = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (value.version !== 1 || !value.session || !Array.isArray(value.events)) throw new Error('Invalid library');
            return { ...initial(), ...value };
        } catch (e) {
            if (e.code === 'ENOENT') return initial();
            throw Object.assign(new Error('音乐库读取失败，原文件已保留'), { code: 'LIBRARY_INVALID', status: 503 });
        }
    }
    function mutate(fn) {
        let handle;
        try { handle = fs.openSync(lock, 'wx', 0o600); }
        catch { throw Object.assign(new Error('音乐库正在写入，请稍后再试'), { code: 'LIBRARY_BUSY', status: 409 }); }
        const temporary = file + '.' + crypto.randomUUID() + '.tmp';
        try {
            const data = read();
            const result = fn(data);
            data.revision++;
            data.events = data.events.slice(-500);
            data.feedback = data.feedback.slice(-1000);
            data.offers = data.offers.slice(-30);
            data.summaries = data.summaries.slice(-8);
            data.cards = Object.fromEntries(Object.entries(data.cards).sort(([a], [b]) => a.localeCompare(b)).slice(-30));
            fs.writeFileSync(temporary, JSON.stringify(data), { mode: 0o600 });
            fs.renameSync(temporary, file);
            return result;
        } finally {
            fs.closeSync(handle);
            fs.rmSync(lock, { force: true });
            fs.rmSync(temporary, { force: true });
        }
    }
    return { read, mutate };
}

module.exports = { createStore };
