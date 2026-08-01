const fs = require('fs');
const ms = JSON.parse(fs.readFileSync(__dirname + '/data/long_term_memories.json', 'utf8'));
for (const m of ms) {
    if ((m.content||'').includes('起源故事') || (m.content||'').includes('戒指含义') || (m.id||'').startsWith('mnliei3')) {
        console.log('id:', m.id, 'source:', m.source, 'heat:', m.heat);
        console.log('expires_at:', m.expires_at || 'perm');
        console.log('content:', (m.content||'').substring(0, 60));
        console.log('---');
    }
}
