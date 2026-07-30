// 清理 web_config.json 中的重复消息（由 restore_transcript_to_chat.js 插入）
// 保留最新版本，按 content 前80字符去重

const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, 'data', 'web_config.json');
if (!fs.existsSync(CONFIG_FILE)) { console.log('no config file'); process.exit(0); }

const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
const main = (config.chatSessions || []).find(s => s.id === 'main');
if (!main || !main.messages) { console.log('no main'); process.exit(0); }

const seen = new Set();
const keep = [];
let removed = 0;

for (const m of main.messages) {
    const v = (m.versions && m.versions.length) ? (m.versions[m.activeVersion || 0] || m.versions[0]) : m;
    const key = (v.content || '').substring(0, 80);
    if (key && seen.has(key)) {
        removed++;
        continue;
    }
    if (key) seen.add(key);
    keep.push(m);
}

if (removed === 0) {
    console.log('No duplicates found');
    process.exit(0);
}

// 按时间排序
keep.sort((a, b) => {
    const va = (a.versions && a.versions.length) ? (a.versions[a.activeVersion || 0] || a.versions[0]) : a;
    const vb = (b.versions && b.versions.length) ? (b.versions[b.activeVersion || 0] || b.versions[0]) : b;
    return (va.fullTime || '').localeCompare(vb.fullTime || '');
});

main.messages = keep;
config.chatSessions = config.chatSessions.map(s => s.id === 'main' ? main : s);

fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
console.log(`Dedup done: ${main.messages.length} messages kept, ${removed} duplicates removed`);
