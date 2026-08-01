const fs = require('fs');
const id = 'mnliei3tteto';
for (const f of ['long_term_memories.json','deep_archive.json','roleplay_archives.json']) {
    const p = __dirname + '/data/' + f;
    if (!fs.existsSync(p)) { console.log(f + ': MISSING'); continue; }
    const ms = JSON.parse(fs.readFileSync(p, 'utf8'));
    const idx = (Array.isArray(ms)?ms:[]).findIndex(m => m.id === id);
    if (idx >= 0) {
        console.log('FOUND in ' + f + ' index=' + idx + ' tags=' + JSON.stringify(ms[idx].tags));
    }
}
// Also search by content
for (const f of ['long_term_memories.json','deep_archive.json','roleplay_archives.json']) {
    const p = __dirname + '/data/' + f;
    if (!fs.existsSync(p)) continue;
    const ms = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const m of (Array.isArray(ms)?ms:[])) {
        if ((m.content||'').includes('戒指含义')) {
            console.log('CONTENT-FOUND in ' + f + ' id=' + m.id);
        }
    }
}
console.log('scan complete');



