// 从 transcript 文件中恢复最近 N 条消息到 web_config.json
// 仅在数据被脏兜底状态污染时才执行（会话名含"加载中"）
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const TRANSCRIPTS_DIR = path.join(DATA_DIR, 'transcripts');
const CONFIG_FILE = path.join(DATA_DIR, 'web_config.json');
const N = 20;

// 0. 检查是否需要恢复
if (fs.existsSync(CONFIG_FILE)) {
    try {
        const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        const main = (cfg.chatSessions || []).find(s => s.id === 'main');
        const dirty = main && (main.name || '').includes('加载中');
        const tooFew = !main || !main.messages || main.messages.length < 3;
        if (!dirty && !tooFew) {
            console.log('✅ 数据健康 (' + (main?.messages?.length||0) + '条消息)，跳过恢复');
            process.exit(0);
        }
        console.log('🔧 需要恢复: dirty=' + dirty + ' msgCount=' + (main?.messages?.length||0));
    } catch(e) { console.log('⚠️ 配置文件读取失败，尝试恢复:', e.message); }
} else {
    console.log('⚠️ web_config.json 不存在，尝试从 transcript 重建');
}

// 1. 收集所有 transcript 消息
if (!fs.existsSync(TRANSCRIPTS_DIR)) { console.log('❌ transcripts 目录不存在'); process.exit(1); }

const transcriptFiles = fs.readdirSync(TRANSCRIPTS_DIR)
    .filter(f => f.endsWith('.json'))
    .sort()
    .map(f => path.join(TRANSCRIPTS_DIR, f));

console.log(`📂 ${transcriptFiles.length} 个文件`);

const allMessages = [];
for (const file of transcriptFiles) {
    try {
        const chunks = JSON.parse(fs.readFileSync(file, 'utf8'));
        for (const chunk of chunks) {
            for (const msg of (chunk.messages || [])) {
                if (msg.role && msg.content && msg.time) {
                    allMessages.push({ role: msg.role, content: msg.content, time: msg.time });
                }
            }
        }
    } catch(e) {}
}

if (allMessages.length === 0) { console.log('❌ 无消息'); process.exit(1); }

// 2. 按时间排序 + 去重（同角色+同内容+10分钟内 = 重复）
allMessages.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
const deduped = [];
for (let i = 0; i < allMessages.length; i++) {
    const m = allMessages[i];
    const isDup = deduped.length > 0 && (() => {
        const prev = deduped[deduped.length - 1];
        if (prev.role !== m.role) return false;
        if (prev.content.substring(0, 60) !== m.content.substring(0, 60)) return false;
        const t1 = new Date(prev.time).getTime(), t2 = new Date(m.time).getTime();
        return Math.abs(t2 - t1) < 10 * 60 * 1000;
    })();
    if (!isDup) deduped.push(m);
}

console.log(`📊 ${allMessages.length} → ${deduped.length} 条（去重后）`);
const latest = deduped[deduped.length - 1];
console.log(`📅 最新: ${latest.time} (${latest.role === 'user' ? '江鱼' : '沈望'})`);

// 3. 取最近 N 条
const recentN = deduped.slice(-N);
const roles = {};
recentN.forEach(m => { roles[m.role] = (roles[m.role]||0) + 1; });
console.log(`🔄 恢复 ${recentN.length} 条 (江鱼:${roles.user||0} 沈望:${roles.assistant||0})`);

// 4. 写入 web_config.json
if (fs.existsSync(CONFIG_FILE)) fs.copyFileSync(CONFIG_FILE, CONFIG_FILE + '.restore.bak');

const config = fs.existsSync(CONFIG_FILE)
    ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
    : { _version: 0, suppliers: [], chatSessions: [], activeSupIndex: 0, activeChatId: 'main' };

let main = (config.chatSessions || []).find(s => s.id === 'main');
if (!main) {
    main = { id: 'main', name: '沈望 ♡', messages: [] };
    config.chatSessions = config.chatSessions || [];
    config.chatSessions.unshift(main);
}

const restored = recentN.map(m => ({
    role: m.role,
    versions: [{
        content: m.content,
        fullTime: m.time,
        time: new Date(m.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' })
    }],
    activeVersion: 0
}));

main.messages = restored;
if ((main.name || '').includes('加载中')) main.name = '沈望 ♡';
config._version = (config._version || 0) + 1;
fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');

console.log(`✅ 恢复完成 → ${restored.length} 条 | v${config._version} | ${main.name}`);
