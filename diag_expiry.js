const fs = require('fs');
// Check ALL memory stores
const stores = ['long_term_memories.json', 'deep_archive.json', 'roleplay_archives.json'];
for (const f of stores) {
    const p = __dirname + '/data/' + f;
    if (!fs.existsSync(p)) { console.log(f + ': not found'); continue; }
    const ms = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const m of (Array.isArray(ms) ? ms : [])) {
        if ((m.content||'').includes('戒指') || (m.tags||[]).some(t => t.includes('戒指'))) {
            console.log('FILE:', f);
            console.log('id:', m.id, 'source:', m.source, 'heat:', m.heat);
            console.log('expires_at:', m.expires_at || 'perm');
            console.log('ttl:', m.ttl || 'perm');
            console.log('tags:', (m.tags||[]).join(', '));
            console.log('content:', (m.content||'').substring(0, 80));
            console.log('---');
        }
    }
}
