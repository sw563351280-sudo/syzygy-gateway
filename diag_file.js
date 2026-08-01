const fs = require('fs');
// Move mnliei3tteto from RP to long-term
const rp = JSON.parse(fs.readFileSync(__dirname + '/data/roleplay_archives.json', 'utf8'));
const idx = rp.findIndex(m => m.id === 'mnliei3tteto');
if (idx >= 0) {
    const mem = rp.splice(idx, 1)[0];
    mem.source = 'manual';
    mem.tags = mem.tags.filter(t => !['rp','roleplay','副本','游戏','设定'].includes(String(t).toLowerCase().trim()));
    fs.writeFileSync(__dirname + '/data/roleplay_archives.json', JSON.stringify(rp, null, 2));
    const lt = JSON.parse(fs.readFileSync(__dirname + '/data/long_term_memories.json', 'utf8'));
    lt.push(mem);
    fs.writeFileSync(__dirname + '/data/long_term_memories.json', JSON.stringify(lt, null, 2));
    console.log('MOVED mnliei3tteto → long_term, tags=' + JSON.stringify(mem.tags));
} else {
    console.log('NOT FOUND in RP');
}


