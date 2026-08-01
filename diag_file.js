const fs = require('fs');
const files = ['long_term_memories.json', 'deep_archive.json', 'roleplay_archives.json'];
for (const f of files) {
    const p = __dirname + '/data/' + f;
    if (!fs.existsSync(p)) { console.log(f + ': MISSING'); continue; }
    const ms = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const m of (Array.isArray(ms)?ms:[])) {
        if ((m.content||'').includes('戒指') || m.id === 'mnliei3tteto') {
            console.log('FILE=' + f + ' id=' + m.id + ' tags=' + JSON.stringify(m.tags));
        }
    }
}

