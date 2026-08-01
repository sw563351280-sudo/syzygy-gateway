// Immediate restore — reads all recent transcript files
const fs = require('fs'), path = require('path');
const C = path.join(__dirname, 'data', 'web_config.json');
const D = path.join(__dirname, 'data', 'transcripts');
const config = JSON.parse(fs.readFileSync(C, 'utf8'));
const main = config.chatSessions.find(s => s.id === 'main');
const last = main.messages[main.messages.length - 1];
const v = (last.versions || [{}])[last.activeVersion || 0] || {};
const after = v.fullTime || '2026-07-01T00:00:00Z';
console.log('Last in config:', after);
let added = 0;
const files = fs.readdirSync(D).filter(f => f.endsWith('.json')).sort().reverse();
for (const f of files.slice(0, 3)) {
    const tx = JSON.parse(fs.readFileSync(path.join(D, f), 'utf8'));
    for (const chunk of tx) for (const m of chunk.messages || []) {
        if (m.time > after && m.role && m.content) {
            main.messages.push({
                role: m.role,
                versions: [{ content: m.content, fullTime: m.time, time: new Date(m.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' }) }],
                activeVersion: 0
            });
            added++;
        }
    }
}
if (added) {
    fs.writeFileSync(C, JSON.stringify(config, null, 2), 'utf8');
    console.log('Restored ' + added + ' messages, total ' + main.messages.length);
} else {
    console.log('Nothing to restore. Files checked:', files.slice(0, 3).join(', '));
}
