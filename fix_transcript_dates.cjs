// 一次性修复: 给 transcripts 里所有 chunk 的 content 字段加上日期
// 用法: EMBEDDING_API_KEY=sk-xxx node fix_transcript_dates.cjs
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const TRANSCRIPTS_DIR = path.join(DATA_DIR, 'transcripts');

if (!fs.existsSync(TRANSCRIPTS_DIR)) { console.log('no transcripts dir'); process.exit(0); }

const files = fs.readdirSync(TRANSCRIPTS_DIR).filter(f => f.endsWith('.json'));
let totalFixed = 0;

for (const file of files) {
    const fp = path.join(TRANSCRIPTS_DIR, file);
    let chunks = JSON.parse(fs.readFileSync(fp, 'utf8'));
    let fixed = 0;
    for (const c of chunks) {
        if (!c.messages || !Array.isArray(c.messages)) continue;
        // 检查是否已有日期
        if (c.content && c.content.startsWith('[')) continue; // 已修复
        const content = c.messages.map(m => {
            const t = m.time ? new Date(m.time).toLocaleDateString('zh-CN') : '';
            return `[${t}] ${m.role === 'user' ? '江鱼' : '沈望'}: ${m.content}`;
        }).join('\n');
        c.content = content.substring(0, 2000);
        fixed++;
    }
    if (fixed > 0) {
        fs.writeFileSync(fp, JSON.stringify(chunks, null, 2), 'utf8');
        totalFixed += fixed;
        console.log(`📁 ${file}: 修复 ${fixed} 个 chunk`);
    }
}
console.log(`\n✅ 共修复 ${totalFixed} 个 chunk`);
