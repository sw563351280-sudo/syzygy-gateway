(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.SyzygyClipboard = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function isImageFile(file) {
        return Boolean(file && typeof file.type === 'string' && file.type.toLowerCase().startsWith('image/'));
    }

    function collectImages(clipboardData) {
        if (!clipboardData) return [];
        const result = [];
        const seen = new Set();
        const add = file => {
            if (!isImageFile(file) || seen.has(file)) return;
            seen.add(file);
            result.push(file);
        };

        for (const item of Array.from(clipboardData.items || [])) {
            if (item && item.kind === 'file' && String(item.type || '').toLowerCase().startsWith('image/')) {
                add(typeof item.getAsFile === 'function' ? item.getAsFile() : null);
            }
        }
        for (const file of Array.from(clipboardData.files || [])) add(file);
        return result;
    }

    return { isImageFile, collectImages };
});
