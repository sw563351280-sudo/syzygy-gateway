'use strict';
(function (root) {
    function formatCacheStatus(status) {
        const ready = status.cacheAdapter?.localCheckPassed;
        const lines = [ready
            ? 'AIHubMix 缓存格式：本地检查通过 · 5 分钟缓存（未向模型发请求，不代表实际命中）'
            : 'AIHubMix 缓存格式：尚未确认，请检查服务是否更新并重启'];
        if (!status.enabled) lines.push('费用观测已关闭，无法更新实际缓存结果。');
        const last = status.latestCache;
        if (!last) lines.push('本次服务启动后暂无用量记录，无需为检查配置而发送聊天。');
        else {
            const labels = { hit: '已命中', written: '已写入', no_cache: '本次未读写缓存', unknown: '读写信息不完整，不能判断未命中' };
            const number = value => typeof value === 'number' && Number.isFinite(value) ? value : '未知';
            lines.push(`最近一次模型调用：${last.host} / ${last.model} · ${labels[last.state] || labels.unknown}`);
            lines.push(`读取 ${number(last.usage?.read)} / 写入 ${number(last.usage?.write)} token · ${last.at || ''}`);
            if (typeof last.estimatedCost?.cny === 'number') lines.push(`该次调用估算 ¥${last.estimatedCost.cny.toFixed(4)}（不等于整轮账单）`);
        }
        return lines.join('\n');
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = { formatCacheStatus };
    else root.formatCacheStatus = formatCacheStatus;
})(typeof window !== 'undefined' ? window : globalThis);
