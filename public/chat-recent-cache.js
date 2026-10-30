(function (root) {
    'use strict';
    // A display-only snapshot. Never import this into the pending-message journal
    // or a cloud save: the server remains authoritative for edits and deletions.
    let database;
    function open() {
        if (!database) database = new Promise((resolve, reject) => {
            const request = indexedDB.open('syzygy_recent_chat_v1', 1);
            request.onupgradeneeded = () => request.result.createObjectStore('snapshots');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
            request.onblocked = () => reject(new Error('Recent chat cache blocked'));
        });
        return database;
    }
    async function read() {
        try {
            const db = await open();
            const snapshot = await new Promise((resolve, reject) => {
                const request = db.transaction('snapshots').objectStore('snapshots').get('main');
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
            if (snapshot?.schema !== 1 || Date.now() - snapshot.savedAt > 7 * 86400000
                || snapshot.session?.id !== 'main' || !Array.isArray(snapshot.session.messages)) return null;
            return snapshot;
        } catch (_) { return null; }
    }
    async function write(session, preferences) {
        if (!session || session.id !== 'main') return;
        try {
            const snapshot = { schema: 1, savedAt: Date.now(), preferences,
                session: { id: 'main', name: session.name, messages: session.messages.slice(-80) } };
            // Clone before awaiting so later edits cannot change this confirmed snapshot.
            const data = structuredClone(snapshot);
            const db = await open();
            await new Promise((resolve, reject) => {
                const transaction = db.transaction('snapshots', 'readwrite');
                transaction.objectStore('snapshots').put(data, 'main');
                transaction.oncomplete = resolve;
                transaction.onerror = () => reject(transaction.error);
                transaction.onabort = () => reject(transaction.error);
            });
        } catch (_) { /* Cache quota/private-mode failures must not block chat. */ }
    }
    root.ChatRecentCache = { read, write };
})(window);
