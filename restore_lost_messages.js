// 从 transcript 恢复 web_config 中 2026-07-31T13:38:07 之后的消息
const fs = require('fs');
const path = require('path');
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG = path.join(DATA_DIR, 'web_config.json');
const TRANS = path.join(DATA_DIR, 'transcripts', '2026-07.json');

const config = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
const main = config.chatSessions.find(s => s.id === 'main');

// Last timestamp already in config
const lastTime = '2026-07-31T13:38:07';

const trans = JSON.parse(fs.readFileSync(TRANS, 'utf8'));
let restored = 0;

for (const chunk of trans) {
    for (const m of chunk.messages || []) {
        if ((m.time || '') > lastTime && m.role && m.content) {
            main.messages.push({
                role: m.role,
                versions: [{
                    content: m.content,
                    fullTime: m.time,
                    time: new Date(m.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' })
                }],
                activeVersion: 0
            });
            restored++;
            console.log(`${m.role}: ${(m.content || '').substring(0, 50)}...`);
        }
    }
}

config.chatSessions = config.chatSessions.map(s => s.id === 'main' ? main : s);
fs.writeFileSync(CONFIG, JSON.stringify(config, null, 2), 'utf8');
console.log(`\n✅ Restored ${restored} messages. Total: ${main.messages.length}`);
