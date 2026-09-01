'use strict';

const PROJECT_FILE_INTENT = /文件|代码|源码|server|prompt|json|接口|报错|日志|目录|路径|仓库|git|github|修复|修改|写入|替换|编辑|vps|服务器|终端|部署|systemctl|服务状态|原始对话|对话记录|聊天记录|transcript/i;

function hasProjectFileIntent(text) {
    return PROJECT_FILE_INTENT.test(String(text || ''));
}

function requestedBuiltinToolNames(text) {
    const value = String(text || '');
    const names = new Set();

    if (/https?:\/\//i.test(value)) names.add('fetch_txt');
    if (/html|网页源码|页面结构/i.test(value)) names.add('fetch_html');
    if (/json|接口|api/i.test(value)) names.add('fetch_json');
    if (/日记|昨天.*(?:做|吃|去|发生)|前天.*(?:做|吃|去|发生)/i.test(value)) names.add('read_diary');
    if (/vps|服务器|终端|部署|systemctl|服务状态|服务日志|代码文件|源码|\/opt\/syzygy/i.test(value)) names.add('exec');
    if (/推送|通知栏|bark/i.test(value)) names.add('bark_push');
    if (/手机.*(?:记录|使用|app|状态)|(?:查|看).*(?:手机|app)/i.test(value)) names.add('check_phone');
    // 共同账本是沈望的日常感官：明确查账和自然的消费/预算语境都应
    // 让模型拿到只读工具，再由模型决定是否调用。
    if (/账本|小金库|记账|收支|收入|支出|结余|预算|月末|月底|消费|外卖|点餐|吃饭|购物|打车|车费|旅行|旅游|房租|工资|钱不够|乱花钱/i.test(value)) {
        names.add('check_ledger');
        names.add('query_ledger');
    }
    if (/原始对话|对话记录|聊天记录|对话原文|之前.*说过|以前.*说过|答应了什么|承诺过什么|搜.*(?:对话|原话|记录)/i.test(value)) names.add('search_transcript');
    if (/环境|位置|电量|天气|在哪里|周围响度/i.test(value)) names.add('check_environment');

    return names;
}

function keepRequestedReadTools(tools, text) {
    const requested = requestedBuiltinToolNames(text);
    return (tools || []).filter(tool => {
        if (tool && tool._mcp) return true;
        const name = tool?.function?.name || tool?.name || '';
        return requested.has(name);
    });
}

module.exports = {
    hasProjectFileIntent,
    requestedBuiltinToolNames,
    keepRequestedReadTools,
};
