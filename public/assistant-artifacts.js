(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else if (root) root.AssistantArtifacts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const URGENCIES = new Set(['low', 'medium', 'high', 'critical']);
    const WAKE_KEYS = ['after_minutes', 'reason', 'urgency'];

    function parseJsonBody(raw) {
        try {
            return JSON.parse(String(raw || '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim());
        } catch (_) {
            return null;
        }
    }

    function isWakePlan(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
        const keys = Object.keys(value).sort();
        if (keys.length !== WAKE_KEYS.length || keys.some((key, index) => key !== WAKE_KEYS[index])) return false;
        const after = value.after_minutes;
        const validAfter = Number.isFinite(Number(after)) || /^\d+(?:\.\d+)?\s*[mh]$/i.test(String(after || '').trim());
        return validAfter
            && URGENCIES.has(String(value.urgency || '').trim().toLowerCase())
            && typeof value.reason === 'string'
            && Boolean(value.reason.trim());
    }

    function trailingWakePlan(source) {
        // A provider occasionally drops either side of the wrapper. Ignore only
        // a closing fragment adjacent to the end while looking for the JSON;
        // it is removed permanently only after the body passes the strict schema.
        const candidateSource = String(source || '').replace(/\s*(?:<\s*\/?\s*NEXT_WAKE\s*>?|\/?\s*NEXT_WAKE\s*>?)\s*$/i, '').trimEnd();
        for (let index = candidateSource.lastIndexOf('{'); index >= 0; index = candidateSource.lastIndexOf('{', index - 1)) {
            const raw = candidateSource.slice(index).trim();
            let parsed;
            try { parsed = JSON.parse(raw); } catch (_) { continue; }
            if (!isWakePlan(parsed)) continue;
            const prefix = candidateSource.slice(0, index).replace(/\s*(?:<\s*)?NEXT_WAKE\b[^>\n]*(?:>\s*)?$/i, '').trimEnd();
            return { cleanText: prefix, plan: parsed };
        }
        return null;
    }

    function extractNextWakeTag(content) {
        const source = String(content || '');
        const plans = [];
        let cleanText = source.replace(/<NEXT_WAKE\s*>([\s\S]*?)<\/NEXT_WAKE\s*>/gi, (_match, raw) => {
            const parsed = parseJsonBody(raw);
            // Explicitly wrapped legacy plans keep their historical permissive
            // parsing; only wrapper-less JSON needs the strict schema guard.
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) plans.push(parsed);
            return '';
        });
        cleanText = cleanText.replace(/<NEXT_WAKE\b[^>]*\/>/gi, '');

        const trailing = trailingWakePlan(cleanText);
        if (trailing) {
            cleanText = trailing.cleanText;
            plans.push(trailing.plan);
        }

        // Old drafts and genuinely truncated wrappers must never leak. Without
        // valid complete JSON they deliberately fall back to the scheduler.
        cleanText = cleanText.replace(/<NEXT_WAKE\b[\s\S]*$/i, '').trim();
        return { cleanText, plan: plans.length ? plans[plans.length - 1] : null, tagCount: plans.length };
    }

    return Object.freeze({ extractNextWakeTag, isWakePlan });
});
