(function (root) {
    'use strict';
    const KEY = 'syzygy_pending_chat_v1';
    const idOf = message => String(message?._id || message?.id || '');
    const copy = value => JSON.parse(JSON.stringify(value));
    // Favorite markers are a projection of /api/favorites, not authored edits.
    const fingerprint = message => {
        const { _favoriteId, ...persisted } = message;
        return JSON.stringify(persisted);
    };

    // This journal contains only newly authored, unacknowledged messages. Legacy
    // snapshots deliberately aren't imported: they may contain deleted history.
    function createJournal(storage) {
        let pending = [];
        let ready = false;
        const known = new Map();
        try {
            const saved = JSON.parse(storage.getItem(KEY) || 'null');
            if (saved?.schema === 1 && Array.isArray(saved.sessions)) {
                pending = saved.sessions.filter(s => typeof s.id === 'string' && Array.isArray(s.messages))
                    .map(s => ({ ...s, messages: s.messages.filter(m => idOf(m) && ['user', 'assistant'].includes(m.role)) }));
            }
        } catch (_) { /* A damaged journal must not prevent loading cloud data. */ }
        function persist() {
            // Keep memory intact if storage throws; callers surface the failure.
            try { storage.setItem(KEY, JSON.stringify({ schema: 1, sessions: pending })); }
            catch (error) {
                // Large image bytes must not prevent the conversation text from
                // surviving termination. The live messages keep their images.
                const textOnly = copy(pending);
                for (const session of textOnly) for (const message of session.messages) {
                    for (const version of [message, ...(message.versions || [])]) {
                        delete version.image;
                        delete version.images;
                        if (Array.isArray(version.content)) version.content = version.content.filter(p => p.type === 'text');
                    }
                }
                storage.setItem(KEY, JSON.stringify({ schema: 1, sessions: textOnly }));
            }
        }
        function observe(sessions) {
            for (const session of sessions) {
                const messages = known.get(session.id) || new Map();
                for (const message of session.messages || []) {
                    if (idOf(message)) messages.set(idOf(message), fingerprint(message));
                }
                known.set(session.id, messages);
            }
            ready = true;
        }
        function capture(sessions) {
            if (!ready) return;
            pending = sessions.map(session => {
                const messages = known.get(session.id) || new Map();
                const previous = pending.find(s => s.id === session.id);
                const unconfirmed = new Set((previous?.messages || []).map(idOf));
                return { id: session.id, name: session.name, type: session.type,
                    newSession: previous?.newSession ?? !known.has(session.id),
                    messages: (session.messages || []).filter(m => idOf(m) && (
                        messages.get(idOf(m)) !== fingerprint(m) || unconfirmed.has(idOf(m))
                    )) };
            }).filter(s => s.messages.length);
            pending = copy(pending);
            persist();
        }
        function restore(sessions) {
            let restored = 0;
            const result = copy(sessions);
            for (const queued of pending) {
                // Do not resurrect a remotely deleted channel.
                let target = result.find(s => s.id === queued.id);
                if (!target && queued.newSession === true) {
                    target = { id: queued.id, name: queued.name, type: queued.type, messages: [] };
                    result.push(target);
                }
                if (!target) continue;
                const ids = new Set((target.messages || []).map(idOf));
                for (const message of queued.messages) {
                    if (!ids.has(idOf(message))) {
                        (target.messages ||= []).push(copy(message));
                        ids.add(idOf(message));
                        restored++;
                    }
                }
            }
            return { sessions: result, restored };
        }
        function acknowledge(snapshot) {
            observe(snapshot);
            const sent = new Map(snapshot.map(s => [s.id, new Map((s.messages || []).map(m => [idOf(m), fingerprint(m)]))]));
            pending = pending.map(s => ({ ...s, messages: s.messages.filter(m =>
                sent.get(s.id)?.get(idOf(m)) !== fingerprint(m)) })).filter(s => s.messages.length);
            persist();
        }
        return {
            capture, observe, restore, acknowledge,
            pendingSnapshot: () => copy(pending),
            hasPending: () => pending.some(s => s.messages.length)
        };
    }

    async function requestJson(url, options = {}, timeoutMs = 20000) {
        const controller = new AbortController();
        let timer;
        try {
            return await Promise.race([
                (async () => {
                    const response = await fetch(url, { ...options, cache: 'no-store', signal: controller.signal });
                    if (!response.ok) throw new Error('HTTP ' + response.status);
                    // The deadline also covers a response body that never finishes.
                    return await response.json();
                })(),
                new Promise((_, reject) => {
                    timer = setTimeout(() => {
                        reject(new Error('同步请求超时，消息已保留在本机，将重试'));
                        controller.abort();
                    }, timeoutMs);
                })
            ]);
        } finally { clearTimeout(timer); }
    }
    const api = { createJournal, requestJson };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ChatPersistence = api;
})(typeof window !== 'undefined' ? window : globalThis);
