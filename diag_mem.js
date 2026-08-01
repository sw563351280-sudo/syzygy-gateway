const fs = require('fs'), path = require('path');
const F = path.join(__dirname, 'data', 'long_term_memories.json');
const ms = JSON.parse(fs.readFileSync(F, 'utf8'));
for (const m of ms) {
    if ((m.content || '').includes('戒指') || (m.tags || []).join(' ').includes('戒指')) {
        console.log('id:', m.id);
        console.log('heat:', m.heat);
        console.log('has_embedding:', Array.isArray(m.embedding) ? m.embedding.length + ' dims' : 'NO');
        console.log('chunk_summary:', (m.chunk_summary || '(none)').substring(0, 80));
        console.log('activation_count:', m.activation_count || 0);
        console.log('---');
    }
}
