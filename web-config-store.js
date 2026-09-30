'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function fileSignature(stat) {
    if (!stat) return null;
    return [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':');
}

function createWebConfigStore(filename, options = {}) {
    const fileSystem = options.fs || fs;
    const clone = options.clone || structuredClone;
    const makeId = options.randomUUID || randomUUID;
    let cachedValue = null;
    let cachedSignature = null;
    let cacheInitialized = false;
    let writeTail = Promise.resolve();
    const metrics = { diskReads: 0, cacheHits: 0, writes: 0 };

    async function statFile() {
        try { return await fileSystem.promises.stat(filename); }
        catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    }

    async function readCurrent(copy = true) {
        const before = await statFile();
        const signature = fileSignature(before);
        if (cacheInitialized && signature === cachedSignature) {
            metrics.cacheHits++;
            return copy ? clone(cachedValue) : cachedValue;
        }
        if (!before) {
            cachedValue = null;
            cachedSignature = null;
            cacheInitialized = true;
            return null;
        }
        let raw = await fileSystem.promises.readFile(filename, 'utf8');
        let after = await statFile();
        if (fileSignature(after) !== signature) {
            raw = await fileSystem.promises.readFile(filename, 'utf8');
            after = await statFile();
        }
        const parsed = JSON.parse(raw);
        cachedValue = parsed;
        cachedSignature = fileSignature(after);
        cacheInitialized = true;
        metrics.diskReads++;
        return copy ? clone(parsed) : parsed;
    }

    async function atomicWrite(value) {
        const serialized = JSON.stringify(value, null, 2);
        const temporary = `${filename}.${makeId()}.tmp`;
        await fileSystem.promises.mkdir(path.dirname(filename), { recursive: true });
        try {
            await fileSystem.promises.writeFile(temporary, serialized, { flag: 'wx', mode: 0o600 });
            await fileSystem.promises.rename(temporary, filename);
        } finally {
            try { await fileSystem.promises.unlink(temporary); }
            catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        const stat = await statFile();
        cachedValue = clone(value);
        cachedSignature = fileSignature(stat);
        cacheInitialized = true;
        metrics.writes++;
        return Buffer.byteLength(serialized);
    }

    async function read() {
        await writeTail;
        return readCurrent();
    }

    async function readShared() {
        await writeTail;
        return readCurrent(false);
    }

    function transaction(updater) {
        const task = writeTail.then(async () => {
            const current = await readCurrent(false);
            const outcome = await updater(clone(current));
            if (!outcome || outcome.commit === false) {
                return { committed: false, value: outcome?.value };
            }
            if (!Object.prototype.hasOwnProperty.call(outcome, 'data')) {
                throw new Error('web config transaction must return data');
            }
            const fileSize = await atomicWrite(outcome.data);
            return { committed: true, value: outcome.value, fileSize };
        });
        writeTail = task.then(() => undefined, () => undefined);
        return task;
    }

    return {
        read,
        readShared,
        transaction,
        diagnostics: () => ({ ...metrics, cached: cacheInitialized, signature: cachedSignature })
    };
}

module.exports = { createWebConfigStore, fileSignature };
