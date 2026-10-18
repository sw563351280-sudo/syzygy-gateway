'use strict';

const PROJECT_FILE_INTENT = /文件|代码|源码|server|prompt|json|接口|报错|日志|目录|路径|仓库|git|github|修复|修改|写入|替换|编辑|vps|服务器|终端|部署|systemctl|服务状态|原始对话|对话记录|聊天记录|transcript/i;
// Device names are optional, but the phrase still needs to express a concrete
// device action so unrelated chat about "opening" or "stopping" stays safe.
const TOY_DEVICE_INTENT = /振动|震动|玩具|啵啵|强度|力度|档位|吸力|toy|vibrat|suction|震(?:我|一下|一会|起来)|(?:开|打开|启动|来|给我来|给我开).{0,4}(?:震|振|档)|(?:调|加|减|换).{0,4}(?:强|弱|轻|重|快|慢|大|小|档|力度|吸力)|(?:停|关|关闭|暂停).{0,3}(?:震|振|设备)/i;
const TOY_FOLLOW_UP_INTENT = /继续|还要|再来|再要|再|轻一点|重一点|快一点|慢一点|停|加一点|减一点|换|保持|就这样/i;
const ALBUM_TERM = /相册|照片|图片|相片|看图|album|photo|image|pixai|高中paro/i;

function hasProjectFileIntent(text) {
    return PROJECT_FILE_INTENT.test(String(text || ''));
}

function hasToyDeviceIntent(text) {
    return TOY_DEVICE_INTENT.test(String(text || ''));
}

function hasToyFollowUpIntent(text) {
    return TOY_FOLLOW_UP_INTENT.test(String(text || ''));
}

function hasAlbumSearchIntent(text) {
    const value = String(text || '').trim();
    if (!ALBUM_TERM.test(value)) return false;

    const term = '(?:相册|照片|图片|相片|看图|album|photo|image|pixai|高中paro)';
    const action = '(?:看(?:看|一下)?|找(?:找|一下)?|搜(?:搜|一下)?|翻(?:翻|一下)?|调出|发给我|展示)';

    // Direct requests such as "看看相册" and polite requests such as
    // "帮我找一下去年旅行的照片".  Merely mentioning photos or screenshots
    // must not pull album images into the current turn.
    return new RegExp(`^(?:${action}).{0,20}${term}`, 'i').test(value)
        || new RegExp(`(?:帮我|给我|我想|我要|请|能不能|可以|把).{0,20}${action}.{0,20}${term}`, 'i').test(value)
        || new RegExp(`(?:帮我|给我|我想|我要|请|能不能|可以|把).{0,20}${term}.{0,20}${action}`, 'i').test(value)
        || new RegExp(`${term}.{0,16}(?:里|中).{0,16}(?:有什么|有没|有没有|哪|找|搜|看|发|调出)`, 'i').test(value);
}

function hasMusicIntent(text) {
    return /音乐|听.{0,6}歌|点歌|放.{0,8}歌|推荐.{0,8}歌|一起听|这首|歌单|私选|music/i.test(String(text || ''));
}

function requestedBuiltinToolNames(text) {
    const value = String(text || '');
    // Music tools only prepare a card/read state, never autoplay. Keep them
    // available for voluntary song gifts and short follow-ups such as "好".
    const names = new Set(['music_search_and_play', 'music_current_session', 'dispatch_codex_task']);
    if (/工作记录|开发记录|工作日志|开发进度|codex|看看记录|查查记录/i.test(value)) names.add('query_work_records');
    if (/工作区.*(?:原文|原话|共聊|聊天|片段|记录)|(?:原文|原话|片段).*(?:工作区|便签)|segment_[a-z0-9-]+/i.test(value)) names.add('query_workspace_conversations');

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
    if (/碎屑|星尘|生活记忆|还记得|之前|以前|上次|昨天|前天|那天|记不记得|想起来/i.test(value)) names.add('search_crumbs');
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
    hasMusicIntent,
    hasToyDeviceIntent,
    hasToyFollowUpIntent,
    hasAlbumSearchIntent,
    requestedBuiltinToolNames,
    keepRequestedReadTools,
};
