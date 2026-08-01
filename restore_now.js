const fs = require('fs'), path = require('path');
const C = path.join(__dirname, 'data', 'web_config.json');
const D = path.join(__dirname, 'data', 'transcripts');
const c = JSON.parse(fs.readFileSync(C, 'utf8'));
const m = c.chatSessions.find(s => s.id === 'main').messages;
const last = m[m.length - 1];
const v = last ? ((last.versions || [{}])[last.activeVersion || 0] || {}) : {};
const after = v.fullTime || '2026-07-01T00:00:00Z';
let n = 0;
for (const f of fs.readdirSync(D).sort().reverse()) {
    if (!f.endsWith('.json')) continue;
    try {
        for (const ch of JSON.parse(fs.readFileSync(path.join(D, f), 'utf8'))) {
            for (const msg of ch.messages || []) {
                if (msg.time > after && msg.role && msg.content) {
                    m.push({ role: msg.role, versions: [{ content: msg.content, fullTime: msg.time, time: new Date(msg.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' }) }], activeVersion: 0 });
                    n++;
                }
            }
        }
    } catch (_) {}
}
fs.writeFileSync(C, JSON.stringify(c, null, 2), 'utf8');
console.log('restored', n, 'total', m.length, 'last', (m[m.length-1]||{}).role);
