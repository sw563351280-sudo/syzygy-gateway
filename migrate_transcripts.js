// 补录历史对话原文到 data/transcripts/
// 用法: 在 VPS 上 /opt/syzygy 目录下运行: node migrate_transcripts.js
// 安全: 不会覆盖已有的 transcript 文件，只追加不存在的 chunk (按 id 去重)

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const TRANSCRIPTS_DIR = path.join(DATA_DIR, 'transcripts');
const WEB_CONFIG_FILE = path.join(DATA_DIR, 'web_config.json');

if (!fs.existsSync(TRANSCRIPTS_DIR)) fs.mkdirSync(TRANSCRIPTS_DIR, { recursive: true });

// ---- 读取 web_config.json ----
let config;
try {
    config = JSON.parse(fs.readFileSync(WEB_CONFIG_FILE, 'utf8'));
} catch(e) {
    console.error('❌ 读取 web_config.json 失败:', e.message);
    process.exit(1);
}

const chatSessions = config.chatSessions || [];
console.log(`📋 共 ${chatSessions.length} 个会话`);

// ---- 从所有会话收集消息对 ----
// 每个 session 的 messages 是 [{role, versions: [{content, fullTime, ...}], activeVersion, ...}]
// 配对: 连续 user→assistant

const allPairs = []; // [{time: ISO8601, user: string, assistant: string}]

for (const session of chatSessions) {
    const msgs = session.messages || [];
    let pendingUser = null;

    for (const msg of msgs) {
        if (!msg.versions || !msg.versions.length) continue;
        const activeIdx = msg.activeVersion || 0;
        const activeVer = msg.versions[Math.min(activeIdx, msg.versions.length - 1)];
        if (!activeVer || !activeVer.content) continue;

        if (msg.role === 'user') {
            if (pendingUser) {
                // 前一个 user 没收到 assistant 回复，丢掉
                pendingUser = null;
            }
            pendingUser = { content: activeVer.content, time: activeVer.fullTime || activeVer.time || null };
        } else if (msg.role === 'assistant') {
            if (pendingUser) {
                allPairs.push({
                    time: pendingUser.time,
                    user: pendingUser.content,
                    assistant: activeVer.content
                });
                pendingUser = null;
            }
            // 独立的 assistant（无 user），跳过
        }
    }
}

console.log(`📬 共提取 ${allPairs.length} 对 user→assistant 对话`);

if (allPairs.length === 0) {
    console.log('没有对话数据，退出。');
    process.exit(0);
}

// ---- 读取已有 transcript 的所有 chunk id 用于去重 ----
const existingIds = new Set();
if (fs.existsSync(TRANSCRIPTS_DIR)) {
    for (const file of fs.readdirSync(TRANSCRIPTS_DIR)) {
        if (!file.endsWith('.json')) continue;
        try {
            const chunks = JSON.parse(fs.readFileSync(path.join(TRANSCRIPTS_DIR, file), 'utf8'));
            for (const c of chunks) {
                if (c.id) existingIds.add(c.id);
            }
        } catch(e) {}
    }
}
console.log(`🏷️  已有 ${existingIds.size} 个 chunk id，将跳过重复`);

// ---- 话题切换检测（与 server.js 一致） ----
function detectTopicShift(messages) {
    if (messages.length < 10) return false;
    const userMsgs = messages.filter(m => m.role === 'user');
    const recent = userMsgs.slice(-2);
    const older = userMsgs.slice(0, -2).slice(-3);
    if (recent.length < 2 || older.length < 2) return false;
    const recentWords = new Set((recent.map(m => m.content).join('').match(/[一-鿿]{2,4}/g)) || []);
    const olderWords = new Set((older.map(m => m.content).join('').match(/[一-鿿]{2,4}/g)) || []);
    if (recentWords.size === 0 || olderWords.size === 0) return false;
    let overlap = 0;
    for (const w of recentWords) { if (olderWords.has(w)) overlap++; }
    return (overlap / Math.min(recentWords.size, olderWords.size)) < 0.15;
}

// ---- 将消息对分组为 chunks ----
const transcriptChunks = []; // [{timestamp, end_time, messages: [{role, content, time}], platform}]
let buffer = [];

function flushBuffer() {
    if (buffer.length === 0) return;
    // buffer 里是 [{role, content, time}] 的序列
    const bufMessages = [...buffer];
    const id = 'tx_migrate_' + bufMessages[0]?.time?.replace(/[^0-9]/g, '').substring(0, 10) + '_' + Math.random().toString(36).substr(2, 6);
    const content = bufMessages.map(m => {
        const t = m.time ? new Date(m.time).toLocaleDateString('zh-CN') : '';
        return `[${t}] ${m.role === 'user' ? '江鱼' : '沈望'}: ${m.content}`;
    }).join('\n');
    const firstUser = bufMessages.find(m => m.role === 'user')?.content || '';
    const firstAi = bufMessages.find(m => m.role === 'assistant')?.content || '';
    const chunk = {
        id,
        timestamp: bufMessages[0]?.time || new Date().toISOString(),
        end_time: bufMessages[bufMessages.length - 1]?.time || new Date().toISOString(),
        platform: 'web',
        topic_boundary: true,
        messages: bufMessages,
        chunk_summary: (firstUser.substring(0, 30) + ' → ' + firstAi.substring(0, 30)).trim(),
        content: content.substring(0, 3000),
        tags: [],
        expires_at: null
    };
    transcriptChunks.push(chunk);
    buffer = [];
}

for (const pair of allPairs) {
    const now = new Date().toISOString();
    buffer.push(
        { role: 'user', content: pair.user, time: pair.time || now },
        { role: 'assistant', content: pair.assistant, time: now }
    );
    const rounds = buffer.length / 2;
    const shouldSplit = rounds >= 6 || (rounds >= 3 && detectTopicShift(buffer));
    if (shouldSplit) flushBuffer();
}
// 最后残留的 buffer
flushBuffer();

console.log(`🧩 切割为 ${transcriptChunks.length} 个 chunk`);

// ---- 按月份分组写入 ----
const chunksByMonth = {};
for (const chunk of transcriptChunks) {
    if (existingIds.has(chunk.id)) continue;
    const ts = chunk.timestamp ? new Date(chunk.timestamp) : new Date();
    const key = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, '0')}`;
    if (!chunksByMonth[key]) chunksByMonth[key] = [];
    chunksByMonth[key].push(chunk);
}

let totalWritten = 0;
for (const [month, newChunks] of Object.entries(chunksByMonth)) {
    const filePath = path.join(TRANSCRIPTS_DIR, `${month}.json`);
    let existing = [];
    try {
        existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch(e) {}
    existing.push(...newChunks);
    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf8');
    console.log(`✅ ${month}.json: 追加 ${newChunks.length} 个 chunk (总计 ${existing.length})`);
    totalWritten += newChunks.length;
}

console.log(`\n🎉 补录完成! 共写入 ${totalWritten} 个新 chunk`);

if (totalWritten > 0) {
    console.log(`\n下一步: 需要生成向量缓存。可以重启服务让 reindexAllEmbeddings 自动处理，或调用 curl "https://syrenth.uk/trigger-cleanup?pwd=<密码>" 触发。`);
}
