'use strict';
const { publicConfiguration, redact } = require('./memory-curator-diagnostics');
const observations = new Map();
async function observe(stage, config, work) {
    const current = { status: 'running', at: new Date().toISOString(), model: redact(config.model, config) };
    observations.set(stage, current);
    try {
        const result = await work();
        if (observations.get(stage) === current) observations.set(stage, { ...current, status: 'success', at: new Date().toISOString() });
        return result;
    } catch (error) {
        if (observations.get(stage) === current) observations.set(stage, { ...current, status: 'failed', at: new Date().toISOString(), error: redact(error.message, config) });
        throw error;
    }
}
function snapshot({ merge, relationship, reality, events = [] }) {
    const pending = events.filter(row => row.kind === 'long_term' && ['received', 'pending', 'processing', 'needs_review'].includes(row.status));
    function service(id, title, config) {
        const observation = observations.get(id);
        return { id, title, ...publicConfiguration(config),
            observation: observation && observation.model === redact(config.model, config) ? observation : null };
    }
    return {
        pending: pending.length,
        review: pending.filter(row => row.status === 'needs_review').length,
        mergeFailures: pending.filter(row => String(row.error || '').startsWith('审查器失败：')).length,
        services: [service('merge', '检查重复并保存', merge),
            service('relationship', '整理关系心得', relationship), service('reality', '整理现实事件', reality)]
    };
}
module.exports = { observe, snapshot };
