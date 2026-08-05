const fs = require('fs');
// memory_blocks.json — 静态核心记忆库
const bfs = [__dirname + '/data/memory_blocks.json', __dirname + '/data/deep_archive.json'];
for (const f of bfs) {
    if (!fs.existsSync(f)) { console.log(f + ': not found'); continue; }
    const ms = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const m of (Array.isArray(ms) ? ms : [])) {
        if ((m.content||'').includes('戒指') || (m.tags||[]).join(' ').includes('戒指')) {
            console.log('file:', f.split('/').pop());
            console.log('id:', m.id, 'source:', m.source, 'heat:', m.heat);
            console.log('content:', (m.content||'').substring(0, 80));
            console.log('---');
        }
    }
}
