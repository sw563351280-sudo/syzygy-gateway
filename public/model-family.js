'use strict';
(function (root) {
    function label(modelId) {
        const value = String(modelId || '').toLowerCase();
        if (value.includes('gemini')) return 'Gemini';
        if (value.includes('claude')) return 'Claude';
        return '';
    }

    function switched(previousModel, nextModel) {
        const previous = label(previousModel);
        const next = label(nextModel);
        return Boolean(previous && next && previous !== next);
    }

    function notice(modelId, requested) {
        const family = requested === true ? label(modelId) : '';
        return family
            ? `【模型切换提醒】当前对话模型已切换为 ${family}。`
            : '';
    }

    const api = { label, switched, notice };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ModelFamily = api;
})(typeof window !== 'undefined' ? window : globalThis);
