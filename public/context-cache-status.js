'use strict';
(function (root) {
    function formatCacheStatus(status) {
        const ready = status.cacheAdapter?.localCheckPassed;
        const ttlLabel = { '1h': '1 小时缓存', '5m': '5 分钟缓存' }[status.cacheAdapter?.ttl] || '缓存有效期未确认';
        const lines = [ready
            ? `AIHubMix 缓存格式：本地检查通过 · ${ttlLabel}（未向模型发请求，不代表实际命中）`
            : 'AIHubMix 缓存格式：尚未确认，请检查服务是否更新并重启'];
        if (!status.enabled) lines.push('费用观测已关闭，无法更新实际缓存结果。');
        if (status.contextOptimization) lines.push(status.contextOptimization.rollingSummary
            ? `滚动摘要：已配置，未压缩历史约 ${status.contextOptimization.thresholdTokens} token 时触发（会产生摘要调用费用）`
            : '滚动摘要：未配置摘要密钥，网页保持原历史窗口。');
        if (status.latestSummary) {
            const states = { resumed: '已校验并衔接云端省略的历史', resume_skipped: '历史校验不匹配，按当前记录处理', started: '正在总结', committed: '已完整保存', failed: '失败，保留原文', cooldown: '暂停重试，保留原文', invalidated: '历史有变化，旧覆盖已失效', invalid_ids: '消息身份不完整，保留原文' };
            lines.push('最近摘要：' + (states[status.latestSummary.state] || '状态未知') + ' · ' + status.latestSummary.at);
            if (status.latestSummary.fallbackCount) lines.push('摘要失败保护：本轮最多发送最近 ' + status.latestSummary.fallbackCount + ' 条历史，避免超长原文请求。');
        }
        const last = status.latestCache;
        const context = status.latestContext;
        if (context?.historyDetail) {
            const d = context.historyDetail, s = context.historySource;
            lines.push(`最近上下文（${context.host} / ${context.model} · ${context.at}）：历史 ${d.count} 条 / ${d.characters} 字符，摘要含包装 ${context.summaryCharacters} 字符。`);
            if (s) lines.push(`消息数量：接收 ${s.receivedMessages} 条（含本轮），合并后历史 ${s.mergedHistoryMessages} 条，投影后 ${s.projectedMessages} 条（含摘要）。`);
            lines.push(`本地粗估 token：固定 ${context.stable.textTokens} / 历史 ${context.history.textTokens} / 摘要 ${context.summary.textTokens} / 本轮与动态 ${context.currentWithDynamic.textTokens}。不是上游精确计数。`);
            lines.push('最长历史：' + d.longest.map(m => `第 ${m.index + 1} 条 ${m.role} ${m.characters} 字符`).join('；'));
        }
        if (status.latestToolSchema) {
            const tools = status.latestToolSchema;
            const scope = tools.scope === 'conversation' ? '同会话上次请求' : '本轮上次请求';
            const label = tools.state === 'first' ? '暂无可比较记录'
                : tools.state === 'stable' ? '定义一致' : `发生变化（增加 ${tools.added}、移除 ${tools.removed}、定义修改 ${tools.definitionsChanged}）`;
            lines.push(`工具缓存检查（${tools.model || '当前模型'}）：${tools.count} 个工具，${tools.state === 'first' ? label : '与' + scope + '相比' + label}。这不是实际命中证明。`);
        }
        const ledger = status.costLedger;
        if (ledger?.latest) {
            const turn = ledger.latest.turn;
            const money = value => typeof value === 'number' ? '¥' + value.toFixed(4) : '未知';
            const group = value => !value?.calls ? '未发生调用' : money(value.knownCny) + (value.completeCny ? '' : '（信息不全）');
            const complete = turn.finished && turn.complete && turn.completeCny && turn.outcome === 'completed';
            lines.push(`最近一轮${complete ? '完整估算' : '已知小计'}：${money(turn.knownCny)} · ${turn.finished ? (turn.outcome === 'completed' ? '请求已结束' : '请求未正常完成') : '进行中'}`);
            lines.push(`聊天 ${group(turn.chat)}；摘要 ${group(turn.summary)}。${complete ? '' : '未知部分未计入，不能当作整轮总价。'}`);
            if (turn.overTarget) lines.push(`已知费用超过参考预算 ¥${turn.targetCny}（只提示，不截断）。`);
        }
        if (ledger?.recent?.turns) {
            const recent = ledger.recent;
            lines.push(`最近 ${recent.turns} 轮：${recent.completeTurns} 轮信息完整，${recent.incompleteTurns} 轮不完整；摘要调用 ${recent.summaryCalls} 次。`);
            if (typeof recent.averageCompleteCny === 'number') lines.push(`仅完整轮次平均 ¥${recent.averageCompleteCny.toFixed(4)}／轮（不含不完整轮次，也不是节省率）。`);
        }
        if (ledger?.storageError) lines.push('费用记录保存或读取失败，当前汇总可能不完整。');
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
