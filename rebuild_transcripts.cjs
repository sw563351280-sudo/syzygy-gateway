// 重建现有 transcripts：将每个 chunk 按 6 轮（12 条消息）重新拆分
// 用法: node rebuild_transcripts.cjs
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const TRANSCRIPTS_DIR = path.join(DATA_DIR, 'transcripts');
const EMBEDDINGS_CACHE_FILE = path.join(DATA_DIR, 'embeddings_cache.json');

const MAX_ROUNDS = 6;
const MAX_CONTENT = 3000;

async function main() {
const allMessages = [];

// 1. 读取所有现有 chunk，拆成单条消息
const files = fs.readdirSync(TRANSCRIPTS_DIR).filter(f => f.endsWith('.json'));
for (const file of files) {
    const month = file.replace('.json', '');
    const chunks = JSON.parse(fs.readFileSync(path.join(TRANSCRIPTS_DIR, file), 'utf8'));
    for (const c of chunks) {
        const msgs = c.messages || [];
        for (let i = 0; i < msgs.length; i += 2) {
            if (!msgs[i] || !msgs[i+1]) continue;
            allMessages.push({
                monthKey: month,
                timestamp: msgs[i].time || c.timestamp || '',
                user: msgs[i],
                assistant: msgs[i+1],
                origId: c.id
            });
        }
    }
}

// 按时间排序
allMessages.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));

// 2. 重新分组：6轮一个 chunk（12条消息）
const monthBuckets = {};
let chunkId = 0;
let currentChunk = null;

for (const msg of allMessages) {
    const mk = msg.monthKey;
    if (!currentChunk || currentChunk.monthKey !== mk || currentChunk.messages.length >= MAX_ROUNDS * 2) {
        if (currentChunk) {
            if (!monthBuckets[currentChunk.monthKey]) monthBuckets[currentChunk.monthKey] = [];
            monthBuckets[currentChunk.monthKey].push(currentChunk);
        }
        currentChunk = {
            id: 'tx_rebuild_' + (chunkId++),
            timestamp: msg.timestamp || new Date().toISOString(),
            messages: [],
            monthKey: mk
        };
    }
    currentChunk.messages.push(
        { role: 'user', content: msg.user.content, time: msg.user.time },
        { role: 'assistant', content: msg.assistant.content, time: msg.assistant.time }
    );
    currentChunk.end_time = msg.timestamp || currentChunk.timestamp;
}
if (currentChunk) {
    if (!monthBuckets[currentChunk.monthKey]) monthBuckets[currentChunk.monthKey] = [];
    monthBuckets[currentChunk.monthKey].push(currentChunk);
}

// 3. 完善字段 + 写入
let totalNew = 0;
for (const month of Object.keys(monthBuckets).sort()) {
    const fp = path.join(TRANSCRIPTS_DIR, month + '.json');
    const processed = monthBuckets[month].map(c => {
        const content = c.messages.map(m => {
            const t = m.time ? new Date(m.time).toLocaleDateString('zh-CN') : '';
            return `[${t}] ${m.role === 'user' ? '江鱼' : '沈望'}: ${m.content}`;
        }).join('\n');
        const firstUser = c.messages.find(m => m.role === 'user')?.content || '';
        const firstAi = c.messages.find(m => m.role === 'assistant')?.content || '';
        return {
            id: c.id,
            timestamp: c.timestamp,
            end_time: c.end_time || c.timestamp,
            platform: 'import',
            topic_boundary: c.messages.length >= MAX_ROUNDS * 2,
            messages: c.messages,
            chunk_summary: (firstUser.substring(0, 30) + ' → ' + firstAi.substring(0, 30)).trim(),
            content: content.substring(0, MAX_CONTENT),
            tags: [],
            expires_at: null
        };
    });
    fs.writeFileSync(fp, JSON.stringify(processed, null, 2), 'utf8');
    totalNew += processed.length;
    console.log(`📁 ${month}: ${processed.length} 个 chunk`);
}

console.log(`\n✅ 重建完成，共 ${totalNew} 个新 chunk`);

// 4. 重新生成向量
const EMBEDDING_API_KEY = process.env.EMBEDDING_API_KEY;
if (EMBEDDING_API_KEY) {
    console.log('\n🧲 重新生成向量...');
    let embNew = 0;
    const embCache = {};
    for (const month of Object.keys(monthBuckets).sort()) {
        const fp = path.join(TRANSCRIPTS_DIR, month + '.json');
        const chunks = JSON.parse(fs.readFileSync(fp, 'utf8'));
        for (const c of chunks) {
            const text = (c.chunk_summary || '') + ' ' + (c.content || '').substring(0, 400);
            if (!text.trim() || text.trim().length < 5) continue;
            try {
                const url = 'https://api.siliconflow.cn/v1/embeddings';
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${EMBEDDING_API_KEY}` },
                    body: JSON.stringify({ model: 'BAAI/bge-m3', input: text.substring(0, 512), encoding_format: 'float' })
                });
                if (res.ok) {
                    const data = await res.json();
                    const emb = data?.data?.[0]?.embedding;
                    if (emb) { embCache[c.id] = emb; embNew++; }
                }
            } catch (e) {}
            if (embNew % 5 === 0) await new Promise(r => setTimeout(r, 500));
        }
    }
    fs.writeFileSync(EMBEDDINGS_CACHE_FILE, JSON.stringify(embCache), 'utf8');
    console.log(`✅ 向量: ${embNew} 条`);
} else {
    console.log('\n⚠️ 跳过向量（设 EMBEDDING_API_KEY）');
}

console.log('\n🎉 全部完成！');
}

main();