// 清理 web_config.json 中的重复消息（同 role + 同 content + 10 分钟内相邻）
const fs = require('fs'), path = require('path');
const C = path.join(__dirname, 'data', 'web_config.json');
if (!fs.existsSync(C)) { console.log('no config'); process.exit(0); }
fs.copyFileSync(C, C + '.dedup.bak');

const cfg = JSON.parse(fs.readFileSync(C, 'utf8'));
const main = (cfg.chatSessions || []).find(s => s.id === 'main');
if (!main || !main.messages) { console.log('no main'); process.exit(0); }

const msgs = main.messages;
const before = msgs.length;
let removed = 0;
const T = 10 * 60 * 1000; // 10 minutes

for (let i = msgs.length - 1; i >= 1; i--) {
    const a = msgs[i], b = msgs[i - 1];
    if (a.role !== b.role) continue;
    const va = (a.versions || [{}])[a.activeVersion || 0] || {};
    const vb = (b.versions || [{}])[b.activeVersion || 0] || {};
    if (va.content !== vb.content) continue;
    const ta = new Date(va.fullTime || 0).getTime();
    const tb = new Date(vb.fullTime || 0).getTime();
    if (Math.abs(ta - tb) > T) continue;
    // duplicate found — keep older one (b), add _id if missing
    if (!b._id && !b.id) b._id = 'dedup_' + Date.now().toString(36) + '_' + i;
    msgs.splice(i, 1);
    removed++;
}

msgs.sort((x, y) => {
    const vx = (x.versions||[{}])[x.activeVersion||0]||{};
    const vy = (y.versions||[{}])[y.activeVersion||0]||{};
    return (vx.fullTime||'').localeCompare(vy.fullTime||'');
});

fs.writeFileSync(C, JSON.stringify(cfg, null, 2), 'utf8');
console.log('Dedup: ' + before + ' → ' + msgs.length + ' (' + removed + ' removed)');
