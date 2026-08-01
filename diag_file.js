const fs = require('fs');
const p = __dirname + '/data/long_term_memories.json';
const ms = JSON.parse(fs.readFileSync(p, 'utf8'));
let n = 0;
for (const m of ms) {
    if ((m.content||'').includes('戒指')) {
        console.log('FOUND id=' + m.id + ' tags=' + JSON.stringify(m.tags));
        n++;
    }
}
console.log('total checked: ' + ms.length + ' found: ' + n + ' ring memories');
