'use strict';
const { measureMessages } = require('./context-budget');
const size = text => measureMessages([{ content: text }]).textTokens;

function budgetDynamicParts(parts, { maxTokens = 3000, detailTokens = 600 } = {}) {
    const sections = parts.flatMap(part => {
        const content = typeof part === 'string' ? part : part?.content || '';
        return content.split(/\n(?=【)/).filter(text => text.trim());
    });
    // Keep live facts and instructions intact. This is a soft budget: correctness
    // wins if essential state alone is larger. Explicit retrieved pages are added
    // separately by the caller, not silently truncated here.
    const essential = text => /(?:规则|指令|校验|铁律|环境参数|时间线|实时|当前|待办|约定|状态|账本|钱包|日程|生理|身体)/.test((text.match(/^\s*【([^】]+)】/) || [])[1] || text.slice(0, 50));
    const priority = sections.map((text, index) => ({ text, index, required: essential(text) }));
    const selected = new Map();
    let used = 0, truncated = 0, dropped = 0;
    for (const item of priority.filter(s => s.required)) { selected.set(item.index, item.text); used += size(item.text); }
    const seen = new Set();
    for (const item of priority.filter(s => !s.required)) {
        const identity = item.text.replace(/\s+/g, ' ').trim();
        if (seen.has(identity)) { dropped++; continue; }
        seen.add(identity);
        const allowed = Math.min(detailTokens, Math.max(0, maxTokens - used));
        if (allowed < 50) { dropped++; continue; }
        let text = item.text;
        if (size(text) > allowed) {
            const marker = '\n[资料节选，更多原文未展开]';
            let low = 0, high = text.length;
            while (low < high) { const mid = Math.ceil((low + high) / 2); if (size(text.slice(0, mid) + marker) <= allowed) low = mid; else high = mid - 1; }
            const prefix = text.slice(0, low);
            const end = Math.max(prefix.lastIndexOf('\n'), prefix.lastIndexOf('。'), prefix.lastIndexOf('！'), prefix.lastIndexOf('？'));
            // Prefer a complete sentence; never turn a cut passage into a false fact.
            if (end < 0 || end < prefix.length / 2) { dropped++; continue; }
            text = prefix.slice(0, end + 1) + marker;
            truncated++;
        }
        selected.set(item.index, text); used += size(text);
    }
    return { parts: [...selected].sort((a, b) => a[0] - b[0]).map(([, text]) => text),
        metrics: { beforeTokens: size(sections.join('\n\n')), afterTokens: used, maxTokens,
            truncated, dropped, essentialOverBudget: used > maxTokens } };
}
module.exports = { budgetDynamicParts };
