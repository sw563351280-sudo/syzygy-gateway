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
        const seenObjects = new Set();
        const seenFingerprints = new Set();
        const fingerprint = file => [
            String(file && file.name || ''),
            String(file && file.type || '').toLowerCase(),
            Number(file && file.size || 0),
            Number(file && file.lastModified || 0)
        ].join('\u0000');
        const add = file => {
            if (!isImageFile(file) || seenObjects.has(file)) return;
            const key = fingerprint(file);
            if (seenFingerprints.has(key)) return;
            seenObjects.add(file);
            seenFingerprints.add(key);
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
