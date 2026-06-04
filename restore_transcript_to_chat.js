// 从 data/transcripts/ 恢复丢失的对话到 web_config.json
// 策略: 收集 web_config 中所有 fullTime，然后遍历 transcript，把所有不在 web_config 中的消息追加进去

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const TRANSCRIPTS_DIR = path.join(DATA_DIR, 'transcripts');
const CONFIG_FILE = path.join(DATA_DIR, 'web_config.json');

if (!fs.existsSync(CONFIG_FILE)) { console.log('web_config.json 不存在'); process.exit(0); }
if (!fs.existsSync(TRANSCRIPTS_DIR)) { console.log('transcripts 目录不存在'); process.exit(0); }

let config;
try { config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch(e) { console.log('读取 web_config.json 失败:', e.message); process.exit(0); }

const mainSession = (config.chatSessions || []).find(s => s.id === 'main');
if (!mainSession || !mainSession.messages) { console.log('main session 不存在'); process.exit(0); }

// 收集 web_config 中所有 fullTime
const existing = new Set();
for (const m of mainSession.messages) {
    const v = (m.versions && m.versions.length) ? (m.versions[m.activeVersion || 0] || m.versions[0]) : m;
    if (v.fullTime) existing.add(v.fullTime);
}
console.log(`web_config 有 ${mainSession.messages.length} 条消息, ${existing.size} 个时间戳`);

// 读取最近两个月 transcript
const now = new Date();
const months = [
    now.getFullYear() + '-' + String(now.getMonth()).padStart(2,'0'),
    now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0')
];
const recentFiles = months.filter(m => fs.existsSync(path.join(TRANSCRIPTS_DIR, m + '.json'))).map(m => m + '.json');
console.log(`处理 transcript: ${recentFiles.join(', ')}`);

// 收集所有 transcript 消息对，去重
let missing = [];
for (const file of recentFiles) {
    let chunks;
    try { chunks = JSON.parse(fs.readFileSync(path.join(TRANSCRIPTS_DIR, file), 'utf8')); } catch(e) { continue; }
    for (const chunk of chunks) {
        const msgs = chunk.messages || [];
        for (let i = 0; i < msgs.length - 1; i++) {
            if (msgs[i].role === 'user' && msgs[i+1].role === 'assistant') {
                if (msgs[i].time && !existing.has(msgs[i].time)) {
                    missing.push({ user: msgs[i], assistant: msgs[i+1] });
                    existing.add(msgs[i].time); // 去重
                }
            }
        }
    }
}

console.log(`找到 ${missing.length} 对 transcript 中有但 web_config 没有的对话`);

if (missing.length === 0) { console.log('无需恢复'); process.exit(0); }

// 按时间排序追加
missing.sort((a,b) => new Date(a.user.time) - new Date(b.user.time));

for (const pair of missing) {
    const ut = pair.user.time || new Date().toISOString();
    const at = pair.assistant.time || new Date().toISOString();
    mainSession.messages.push(
        { role: 'user', versions: [{ content: pair.user.content || '', fullTime: ut, time: new Date(ut).toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit',timeZone:'Asia/Shanghai'}) }], activeVersion: 0 },
        { role: 'assistant', versions: [{ content: pair.assistant.content || '', fullTime: at, time: new Date(at).toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit',timeZone:'Asia/Shanghai'}) }], activeVersion: 0 }
    );
    console.log(`📥 ${(pair.user.content||'').substring(0,30)}... → ${(pair.assistant.content||'').substring(0,30)}...`);
}

fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
console.log(`✅ 恢复 ${missing.length} 对对话。总计 ${mainSession.messages.length} 条`);
