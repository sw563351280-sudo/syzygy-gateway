// 从 data/transcripts/ 恢复丢失的对话到 web_config.json
// 用法: node restore_transcript_to_chat.js
// 策略: 找到 web_config 中最后一条消息的 fullTime，把所有 transcript 中晚于该时间的对话追加进去

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

// 找到 web_config 中最后一条消息的 fullTime
let latestExisting = '1970-01-01T00:00:00.000Z';
for (let i = mainSession.messages.length - 1; i >= 0; i--) {
    const m = mainSession.messages[i];
    const v = (m.versions && m.versions.length) ? (m.versions[m.activeVersion || 0] || m.versions[0]) : m;
    if (v.fullTime) { latestExisting = v.fullTime; break; }
}

console.log(`现有 ${mainSession.messages.length} 条消息，最新时间: ${latestExisting}`);

// 读取最近两个月的 transcript 文件
const now = new Date();
const currentMonth = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');
const lastMonth = now.getFullYear() + '-' + String(now.getMonth()).padStart(2,'0');
const recentFiles = [lastMonth, currentMonth].filter(m => {
    return fs.existsSync(path.join(TRANSCRIPTS_DIR, m + '.json'));
}).map(m => m + '.json');

console.log(`处理 transcript 文件: ${recentFiles.join(', ')}`);

// 收集所有 transcript 消息对（user→assistant），只取晚于 latestExisting 的
let pending = [];
for (const file of recentFiles) {
    let chunks;
    try { chunks = JSON.parse(fs.readFileSync(path.join(TRANSCRIPTS_DIR, file), 'utf8')); } catch(e) { continue; }

    for (const chunk of chunks) {
        const msgs = chunk.messages || [];
        for (let i = 0; i < msgs.length - 1; i++) {
            if (msgs[i].role === 'user' && msgs[i+1].role === 'assistant') {
                // transcript 的 time 是 ISO 字符串
                if (msgs[i].time && msgs[i].time > latestExisting) {
                    pending.push({
                        user: msgs[i],
                        assistant: msgs[i+1]
                    });
                }
            }
        }
    }
}

console.log(`从 transcript 找到 ${pending.length} 对晚于最新时间的对话`);

if (pending.length === 0) {
    console.log('没有需要恢复的消息。');
    process.exit(0);
}

// 追加到 messages 末尾
for (const pair of pending) {
    const userTime = pair.user.time || new Date().toISOString();
    const aiTime = pair.assistant.time || new Date().toISOString();
    mainSession.messages.push(
        { role: 'user', versions: [{ content: pair.user.content || '', fullTime: userTime, time: new Date(userTime).toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit',timeZone:'Asia/Shanghai'}) }], activeVersion: 0 },
        { role: 'assistant', versions: [{ content: pair.assistant.content || '', fullTime: aiTime, time: new Date(aiTime).toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit',timeZone:'Asia/Shanghai'}) }], activeVersion: 0 }
    );
    console.log(`📥 恢复: ${(pair.user.content||'').substring(0,40)}... → ${(pair.assistant.content||'').substring(0,40)}...`);
}

fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
console.log(`✅ 已写入 web_config.json。共恢复 ${pending.length} 对对话。总消息数: ${mainSession.messages.length}`);
