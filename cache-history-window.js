'use strict';
const { randomBytes, createHmac } = require('node:crypto');

// Browser fallback only: retain a bounded prefix after proving it still exists
// in the current saved conversation. Never restore deleted/edited messages.
function createCacheHistoryWindow({ now = Date.now, ttlMs = 3600000, limit = 100, maxMessages = 38 } = {}) {
    const states = new Map(), secret = randomBytes(32);
    const hash = value => createHmac('sha256', secret).update(JSON.stringify(value)).digest('hex');
    const plain = text => typeof text === 'string'
        ? text.replace(/[\u001f\u2063]/g, '\n').replace(/^\s*(?:(?:⟦ts:[^⟧]*⟧|\[ts:\d{2}-\d{2}\s+\d{2}:\d{2}\]|\[\d{2}-\d{2}\s+\d{2}:\d{2}\])\s*)+/i, '') : null;
    const wire = m => ({ role: m.role, content: m.content });
    function saved(m) {
        const v = m.versions?.length ? (m.versions[m.activeVersion || 0] || m.versions[0]) : m;
        const content = v.content === undefined ? m.content : v.content;
        const text = plain(content);
        return { id: m._id, text: text === null ? null : hash([m.role, text]),
            revision: hash([m._id, m.role, content, v.fullTime ?? m.fullTime, m.activeVersion || 0]) };
    }
    return {
        project(scope, messages, storedMessages) {
            const time = now(), key = hash(scope);
            for (const [k, state] of states) if (time - state.at >= ttlMs) states.delete(k);
            const previous = states.get(key);
            states.delete(key);
            const fallback = state => ({ messages, state, retained: 0 });
            if (!Array.isArray(storedMessages) || messages.length < 10 || messages.length > maxMessages
                || messages.some(m => !['user', 'assistant'].includes(m.role) || plain(m.content) === null)) return fallback('unverified');
            const full = storedMessages.map(saved);
            const incoming = messages.map(m => hash([m.role, plain(m.content)]));
            const matches = [];
            for (let i = 0; i <= full.length - incoming.length; i++) {
                if (incoming.every((value, j) => full[i + j].text === value && full[i + j].id)) matches.push(i);
            }
            if (matches.length !== 1) return fallback('unverified');
            const start = matches[0], end = start + incoming.length;
            let selected = messages.map(wire), selectedStart = start, state = 'anchored';
            if (previous) {
                const oldStart = full.findIndex(m => m.id === previous.proof[0].id);
                const shift = start - oldStart;
                const overlap = previous.messages.length - shift;
                const intact = oldStart >= 0 && previous.proof.every((proof, j) => {
                    const current = full[oldStart + j];
                    return current?.id === proof.id && current.revision === proof.revision;
                });
                // A sliding suffix must overlap exactly, including wire timestamps.
                const same = shift >= 0 && overlap >= 10 && overlap <= messages.length
                    && messages.slice(0, overlap).every((m, j) => JSON.stringify(wire(m)) === JSON.stringify(previous.messages[shift + j]));
                if (intact && same && end - oldStart <= maxMessages) {
                    selected = [...previous.messages.slice(0, shift), ...selected];
                    selectedStart = oldStart;
                    state = 'reused';
                } else state = intact && same ? 'rotated' : 'reset';
            }
            // Detached wire copies; no keys or message content are logged or persisted.
            states.set(key, { at: time, messages: structuredClone(selected), proof: full.slice(selectedStart, end) });
            while (states.size > limit) states.delete(states.keys().next().value);
            return { messages: selected, state, retained: selected.length - messages.length };
        },
    };
}
module.exports = { createCacheHistoryWindow };
