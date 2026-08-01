const fs = require('fs');
let out = '';
const stores = ['long_term_memories.json', 'deep_archive.json', 'roleplay_archives.json'];
for (const f of stores) {
    const p = __dirname + '/data/' + f;
    if (!fs.existsSync(p)) { out += f + ': not found\n'; continue; }
    const ms = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const m of (Array.isArray(ms) ? ms : [])) {
        if ((m.content||'').includes('戒指') || (m.tags||[]).some(t => (t||'').includes('戒指'))) {
            out += 'FILE: ' + f + '\n';
            out += 'id: ' + (m.id||'?') + ' source: ' + (m.source||'?') + ' heat: ' + (m.heat||'?') + '\n';
            out += 'expires_at: ' + (m.expires_at || 'perm') + ' ttl: ' + (m.ttl || 'perm') + '\n';
            out += 'tags: ' + ((m.tags||[]).join(', ') || 'none') + '\n';
            out += '---\n';
        }
    }
}
fs.writeFileSync(__dirname + '/data/diag_result.json', JSON.stringify({output: out || 'NO RING MEMORY FOUND'}));
console.log(out || 'NO RING MEMORY FOUND');
