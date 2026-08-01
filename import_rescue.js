// 一次性导入浏览器导出的未同步消息
const fs = require('fs'), path = require('path');
const C = path.join(__dirname, 'data', 'web_config.json');
const R = path.join(__dirname, 'rescue_data.json');

const rescue = JSON.parse(fs.readFileSync(R, 'utf8'));
const config = JSON.parse(fs.readFileSync(C, 'utf8'));
const main = config.chatSessions.find(s => s.id === rescue.sessionId || s.id === 'main');
if (!main) { console.log('ERROR: no main session'); process.exit(1); }
if (!main.messages) main.messages = [];

const before = main.messages.length;

// 去重 key：fullTime + role（与前端 msgKey 对等）
const seen = new Set();
for (const m of main.messages) {
    const v = (m.versions || [{}])[m.activeVersion || 0] || {};
    if (v.fullTime) seen.add(v.fullTime + '|' + m.role);
}

let added = 0;
for (const m of rescue.messages) {
    const v = (m.versions || [{}])[m.activeVersion || 0] || {};
    const key = (v.fullTime || '') + '|' + m.role;
    if (seen.has(key)) continue;
    seen.add(key);
    // strip _crossPlatform flag
    const clean = { role: m.role, versions: m.versions, activeVersion: m.activeVersion || 0 };
    main.messages.push(clean);
    added++;
}

// 按时间排序
main.messages.sort((a, b) => {
    const va = (a.versions || [{}])[a.activeVersion || 0] || {};
    const vb = (b.versions || [{}])[b.activeVersion || 0] || {};
    return (va.fullTime || '').localeCompare(vb.fullTime || '');
});

// 备份
fs.copyFileSync(C, C + '.bak');

fs.writeFileSync(C, JSON.stringify(config, null, 2), 'utf8');
console.log('Imported ' + added + ' messages. Before: ' + before + ' After: ' + main.messages.length);
