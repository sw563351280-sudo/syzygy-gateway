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
// Also dump raw tag format for ring memories
let tagDiag = '';
for (const f of ['long_term_memories.json']) {
    const p = __dirname + '/data/' + f;
    const ms = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const m of (Array.isArray(ms)?ms:[])) {
        if ((m.tags||[]).some(t => (t||'').includes('戒指'))) {
            tagDiag += 'id:' + m.id + ' tags: ' + JSON.stringify(m.tags) + ' len:' + (m.tags||[]).length + '\n';
        }
    }
}
fs.writeFileSync(__dirname + '/data/diag_result.json', JSON.stringify({raw: out, tagJSON: tagDiag || 'none'}));
console.log(out); console.log(tagDiag);
console.log(out || 'NO RING MEMORY FOUND');
