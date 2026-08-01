// 从 transcript 恢复最后一批丢失的消息，跟随 deploy 执行
const fs = require('fs'), path = require('path');
const C = path.join(__dirname, 'data', 'web_config.json');
const tf = ['2026-08.json', '2026-07.json'].map(f => path.join(__dirname, 'data', 'transcripts', f)).filter(fs.existsSync);
const cfg = JSON.parse(fs.readFileSync(C, 'utf8'));
const main = cfg.chatSessions.find(s => s.id === 'main');
const last = main.messages[main.messages.length - 1];
const v = (last.versions || [{}])[last.activeVersion || 0] || {};
const after = v.fullTime || '2026-07-01T00:00:00Z';
let n = 0;
for (const T of tf) {
    const tx = JSON.parse(fs.readFileSync(T, 'utf8'));
    for (const c of tx) {
        for (const m of c.messages || []) {
            if (m.time > after && m.role && m.content) {
                main.messages.push({
                    role: m.role,
                    versions: [{ content: m.content, fullTime: m.time, time: new Date(m.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' }) }],
                    activeVersion: 0
                });
                n++;
            }
        }
    }
}
if (n) { fs.writeFileSync(C, JSON.stringify(cfg, null, 2), 'utf8'); console.log('Restored ' + n + ' msgs, total ' + main.messages.length); }
else console.log('No new msgs in ' + tf.join(',') + '. Last time:', after);
