'use strict';
const { randomBytes, createHmac } = require('node:crypto');

// Object key order and tool ranking carry no schema semantics. Array order
// inside schemas (tuples/examples/enum/etc.) and all descriptions remain intact.
function canonicalObject(value) {
    if (Array.isArray(value)) return value.map(canonicalObject);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalObject(value[key])]));
}
function stableToolSchema(tools) {
    if (!Array.isArray(tools)) return tools;
    const unique = new Map();
    for (const tool of tools) {
        const normalized = canonicalObject(tool);
        const serialized = JSON.stringify(normalized);
        unique.set(serialized, normalized); // Only byte-identical definitions deduplicate.
    }
    return [...unique].sort(([a, x], [b, y]) => {
        const left = String(x.function?.name || x.name || ''), right = String(y.function?.name || y.name || '');
        return left < right ? -1 : left > right ? 1 : a < b ? -1 : a > b ? 1 : 0;
    }).map(([, tool]) => tool);
}

function createToolSchemaTracker({ limit = 500, ttlMs = 30 * 60 * 1000, now = Date.now } = {}) {
    const secret = randomBytes(32), snapshots = new Map();
    const digest = value => createHmac('sha256', secret).update(JSON.stringify(value)).digest('hex');
    return {
        compare(scope, tools = []) {
            const key = digest(scope), time = now();
            const previous = snapshots.get(key);
            const before = previous && time - previous.at < ttlMs ? previous : null;
            // Actual serialized wire definitions, not an assumed canonical payload.
            const signature = digest(tools);
            const current = new Map(tools.map(t => [digest([t.type, t.function?.name || t.name]), digest(t)]));
            let added = 0, removed = 0, changed = 0;
            if (before) {
                for (const [name, schema] of current) {
                    if (!before.tools.has(name)) added++;
                    else if (before.tools.get(name) !== schema) changed++;
                }
                for (const name of before.tools.keys()) if (!current.has(name)) removed++;
            }
            snapshots.delete(key);
            snapshots.set(key, { at: time, signature, tools: current });
            while (snapshots.size > limit) snapshots.delete(snapshots.keys().next().value);
            return { state: !before ? 'first' : before.signature === signature ? 'stable' : 'changed',
                count: tools.length, added, removed, definitionsChanged: changed };
        },
    };
}
module.exports = { stableToolSchema, createToolSchemaTracker };
