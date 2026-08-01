// 给所有没有 chunk_summary 的长期记忆自动生成摘要
const fs = require('fs'), path = require('path');
const F = path.join(__dirname, 'data', 'long_term_memories.json');
const m = JSON.parse(fs.readFileSync(F, 'utf8'));
let n = 0;
for (const mem of m) {
    if (!mem.chunk_summary && mem.content) {
        mem.chunk_summary = mem.content.trim().substring(0, 60);
        n++;
    }
}
fs.writeFileSync(F, JSON.stringify(m, null, 2), 'utf8');
console.log('Backfilled ' + n + ' memories');
