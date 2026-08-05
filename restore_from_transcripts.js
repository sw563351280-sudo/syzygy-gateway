// 从 transcript 文件中查看最新对话时间 + 恢复最近 N 条消息到 web_config.json
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const TRANSCRIPTS_DIR = path.join(DATA_DIR, 'transcripts');
const CONFIG_FILE = path.join(DATA_DIR, 'web_config.json');
const N = 20;

// 1. 读取所有 transcript 文件
if (!fs.existsSync(TRANSCRIPTS_DIR)) { console.log('❌ transcripts 目录不存在'); process.exit(1); }

const transcriptFiles = fs.readdirSync(TRANSCRIPTS_DIR)
    .filter(f => f.endsWith('.json'))
    .sort()
    .map(f => path.join(TRANSCRIPTS_DIR, f));

console.log(`📂 找到 ${transcriptFiles.length} 个文件: ${transcriptFiles.map(f => path.basename(f)).join(', ')}`);

// 2. 收集所有消息
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
    } catch(e) { console.log(`⚠️ ${path.basename(file)}: ${e.message}`); }
}

allMessages.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
console.log(`📊 共 ${allMessages.length} 条消息`);

if (allMessages.length === 0) { console.log('❌ 无消息'); process.exit(1); }

const latest = allMessages[allMessages.length - 1];
const earliest = allMessages[0];
console.log(`📅 最早: ${earliest.time} | 最新: ${latest.time}`);
console.log(`  最新角色: ${latest.role === 'user' ? '江鱼' : '沈望'}`);
console.log(`  最新内容: ${latest.content.substring(0, 80)}...`);

// 3. 取最近 N 条
const recentN = allMessages.slice(-N);
console.log(`\n🔄 恢复最近 ${recentN.length} 条`);

// 4. 更新 web_config.json
fs.copyFileSync(CONFIG_FILE, CONFIG_FILE + '.restore.bak');
const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
let main = (config.chatSessions || []).find(s => s.id === 'main');
if (!main) {
    main = { id: 'main', name: '主频道', messages: [] };
    config.chatSessions = config.chatSessions || [];
    config.chatSessions.unshift(main);
}

const restored = recentN.map(m => ({
    role: m.role,
    versions: [{ content: m.content, fullTime: m.time, time: new Date(m.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' }) }],
    activeVersion: 0
}));

const oldCount = main.messages ? main.messages.length : 0;
main.messages = restored;
if ((main.name || '').includes('加载中')) main.name = '沈望 ♡';
config._version = (config._version || 0) + 1;
fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');

console.log(`✅ ${oldCount} → ${restored.length} 条 | v${config._version} | 名: ${main.name}`);
console.log(`   范围: ${recentN[0].time} ~ ${recentN[recentN.length - 1].time}`);
