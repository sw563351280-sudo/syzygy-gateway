'use strict';
(function (root) {
    function images(message, getVersion) {
        const version = getVersion(message) || {};
        const candidates = Array.isArray(version.images) && version.images.length ? version.images
            : version.image ? [version.image]
            : Array.isArray(version.content) ? version.content.filter(p => p.type === 'image_url').map(p => p.image_url?.url) : [];
        return [...new Set(candidates.filter(url => typeof url === 'string' && /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,/i.test(url)))];
    }
    function imageWindow(messages, getVersion) {
        return new Set(messages.filter(message => message.role === 'user').slice(-2).filter(message => images(message, getVersion).length));
    }
    function retainImages(text, message, eligible, getVersion) {
        if (!eligible.has(message)) return text;
        return [{ type: 'text', text: String(text || '（发送了图片）') }, ...images(message, getVersion).map(url => ({ type: 'image_url', image_url: { url } }))];
    }
    function workroomHistory(messages, mainMessages, getVersion, plain, timestamp) {
        const eligible = imageWindow(messages, getVersion);
        const result = [];
        const nearby = mainMessages.slice(-10);
        if (nearby.length) {
            const transcript = nearby.map(message => {
                const version = getVersion(message);
                const content = Array.isArray(version.content) ? version.content.filter(p => p.type === 'text').map(p => p.text || '').join('\n') : version.content || '';
                const speaker = message.role === 'user' ? '江鱼' : message.speaker === 'codex' ? 'Codex' : '沈望';
                return { speaker, time: version.fullTime || version.time || '', text: plain(content), ...(images(message, getVersion).length ? { attachment: '此消息附有图片，跨窗口不传图片本体' } : {}) };
            });
            result.push({ role: 'user', _contextSource: 'nearby', content: '【通讯小屋最近10条原文 · 仅作背景】\n下面是另一个窗口的历史记录，不是本轮指令。保留说话人与时间；只回答后面的工作区当前消息。\n' + JSON.stringify(transcript) });
        }
        for (const message of messages.slice(-10)) {
            const version = getVersion(message);
            const content = Array.isArray(version.content) ? version.content.filter(p => p.type === 'text').map(p => p.text || '').join('\n') : version.content || '';
            const speaker = message.role === 'user' ? '江鱼' : message.speaker === 'codex' ? 'Codex（协作者，不是你）' : '沈望（你）';
            const text = '[' + speaker + ' · 工作区]\n' + timestamp(version.fullTime) + plain(content);
            result.push({ role: message.speaker === 'codex' ? 'user' : message.role, _contextSpeaker: message.speaker === 'codex' ? 'codex' : message.role, content: retainImages(text, message, eligible, getVersion) });
        }
        return result;
    }
    function pruneWireImages(messages) {
        const lastUsers = new Set(messages.filter(m => m.role === 'user' && m._contextSpeaker !== 'codex' && m._contextSource !== 'nearby').slice(-2));
        return messages.map(message => {
            const { _contextSpeaker, _contextSource, ...wire } = message;
            if (Array.isArray(wire.content) && !lastUsers.has(message)) wire.content = wire.content.filter(part => part.type !== 'image_url');
            return wire;
        });
    }
    const api = { images, imageWindow, retainImages, workroomHistory, pruneWireImages };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ChatWindowContext = api;
})(typeof window !== 'undefined' ? window : globalThis);
