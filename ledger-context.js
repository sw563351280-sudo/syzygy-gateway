'use strict';

const LEDGER_CONTEXT_INTENT = /账本|小金库|记账|收支|收入|支出|结余|预算|月末|月底|消费|外卖|点餐|吃饭|购物|打车|车费|旅行|旅游|房租|工资|钱不够|乱花钱|check_ledger|query_ledger/i;

function hasLedgerContextIntent(text) {
    return LEDGER_CONTEXT_INTENT.test(String(text || ''));
}

function formatMoney(cents) {
    return (Number(cents || 0) / 100).toLocaleString('zh-CN', {
        style: 'currency',
        currency: 'CNY',
        minimumFractionDigits: 2,
    });
}

function renderLedgerRealtimeContext(overview) {
    if (!overview) return '';
    const lines = [
        '【共同账本实时数据（服务端已读取，无需再调用工具）】',
        `月份：${overview.month}`,
        `收入：${formatMoney(overview.income_cents)}`,
        `支出：${formatMoney(overview.expense_cents)}`,
        `结余：${formatMoney(overview.balance_cents)}`,
        `记录数：${Number(overview.count || 0)} 笔`,
    ];
    if (overview.savings_rate !== null && overview.savings_rate !== undefined) {
        lines.push(`结余率：${overview.savings_rate}%`);
    }
    if (Array.isArray(overview.category_breakdown) && overview.category_breakdown.length) {
        lines.push(`支出分类：${overview.category_breakdown.slice(0, 6).map(item => `${item.name} ${formatMoney(item.amount_cents)}`).join('；')}`);
    }
    if (Array.isArray(overview.recent) && overview.recent.length) {
        lines.push('最近记录：');
        for (const row of overview.recent.slice(0, 8)) {
            lines.push(`- ${row.date}｜${row.kind === 'income' ? '收入' : '支出'}｜${row.category || '其他'}｜${row.name || '未命名'}｜${row.kind === 'income' ? '+' : '-'}${formatMoney(row.amount_cents)}`);
        }
    } else {
        lines.push('最近记录：暂无');
    }
    lines.push('回答要求：直接依据以上数据回答江鱼，不讨论工具是否存在，也不要让江鱼再次检查或等待。');
    return lines.join('\n');
}

module.exports = { hasLedgerContextIntent, renderLedgerRealtimeContext };
