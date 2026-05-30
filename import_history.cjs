// 一次性脚本：将 web_config.json 里的聊天历史导入对话原文雷达 (transcripts/)
// 用法: node import_history.cjs
// 前提: data/web_config.json 存在，EMBEDDING_API_KEY 环境变量已设（可选，会降级纯关键词）

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const TRANSCRIPTS_DIR = path.join(DATA_DIR, 'transcripts');
const EMBEDDINGS_CACHE_FILE = path.join(DATA_DIR, 'embeddings_cache.json');
const CONFIG_FILE = path.join(DATA_DIR, 'web_config.json');

// ---- 工具函数 ----
function loadMonthFile(filePath) {
    try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch(e) { return []; }
}
function saveMonthFile(filePath, chunks) {
    fs.writeFileSync(filePath, JSON.stringify(chunks, null, 2), 'utf8');
}
function loadEmbeddingsCache() {
    try { return JSON.parse(fs.readFileSync(EMBEDDINGS_CACHE_FILE, 'utf8')); } catch(e) { return {}; }
}
function saveEmbeddingsCache(cache) {
    fs.writeFileSync(EMBEDDINGS_CACHE_FILE, JSON.stringify(cache), 'utf8');
}

async function getEmbedding(text, apiKey) {
    const truncated = text.substring(0, 512);
    const providers = [
        { url: 'https://api.siliconflow.cn/v1/embeddings', model: 'BAAI/bge-m3' },
        { url: 'https://api.siliconflow.cn/v1/embeddings', model: 'BAAI/bge-large-zh-v1.5' }
    ];
    for (const p of providers) {
        try {
            const res = await fetch(p.url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                body: JSON.stringify({ model: p.model, input: truncated, encoding_format: "float" })
            });
            if (!res.ok) continue;
            const data = await res.json();
            const emb = data?.data?.[0]?.embedding;
            if (emb && Array.isArray(emb) && emb.length > 0) return emb;
        } catch(e) { continue; }
    }
    return null;
}

async function main() {
    if (!fs.existsSync(DATA_DIR)) { console.error('❌ data/ 目录不存在'); process.exit(1); }
    if (!fs.existsSync(CONFIG_FILE)) { console.error('❌ data/web_config.json 不存在'); process.exit(1); }
    if (!fs.existsSync(TRANSCRIPTS_DIR)) fs.mkdirSync(TRANSCRIPTS_DIR, { recursive: true });

    // ---- 读取历史消息 ----
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    const msgs = config.chatSessions?.find(s => s.id === 'main')?.messages || [];
    console.log(`📄 读取到 ${msgs.length} 条消息`);

    // ---- 按 (user, assistant) 成对分组 ----
    const rounds = [];
    for (let i = 0; i < msgs.length; i++) {
        const m = msgs[i];
        const role = m.role;
        const content = m.versions?.[0]?.content || m.content || '';
        const time = m.versions?.[0]?.fullTime || m.fullTime || null;

        if (role === 'user') {
            let next = null;
            for (let j = i + 1; j < msgs.length; j++) {
                if (msgs[j].role === 'assistant' && msgs[j].versions?.[0]?.content) {
                    next = msgs[j];
                    break;
                }
                if (msgs[j].role === 'user') break;
            }
            if (next) {
                rounds.push({
                    user: { role: 'user', content, time },
                    assistant: { role: 'assistant', content: next.versions?.[0]?.content || '', time: next.versions?.[0]?.fullTime || null }
                });
                i = msgs.indexOf(next);
            }
        }
    }
    console.log(`🔁 解析为 ${rounds.length} 轮对话`);

    if (rounds.length === 0) { console.log('⚠️ 没有可导入的对话'); process.exit(0); }

    // ---- 按15轮一组分 chunk 到对应月份文件 ----
    const monthBuckets = {};

    let currentChunk = null;
    for (let r = 0; r < rounds.length; r++) {
        const rd = rounds[r];
        const monthKey = rd.user.time
            ? new Date(rd.user.time).toISOString().substring(0, 7)
            : new Date().toISOString().substring(0, 7);

        if (!currentChunk || currentChunk.monthKey !== monthKey || currentChunk.messages.length >= 30) {
            if (currentChunk) {
                if (!monthBuckets[currentChunk.monthKey]) monthBuckets[currentChunk.monthKey] = [];
                monthBuckets[currentChunk.monthKey].push(currentChunk);
            }
            currentChunk = {
                id: 'tx_import_' + Date.now().toString(36) + '_' + r,
                timestamp: rd.user.time || new Date().toISOString(),
                messages: [],
                monthKey: monthKey,
                topic_boundary: false,
                platform: 'web'
            };
        }

        currentChunk.messages.push(
            { role: 'user', content: rd.user.content, time: rd.user.time },
            { role: 'assistant', content: rd.assistant.content, time: rd.assistant.time }
        );
        currentChunk.end_time = rd.assistant.time || currentChunk.timestamp;
    }
    if (currentChunk) {
        if (!monthBuckets[currentChunk.monthKey]) monthBuckets[currentChunk.monthKey] = [];
        monthBuckets[currentChunk.monthKey].push(currentChunk);
    }

    // ---- 完善 chunk 字段 + 去重 + 写入 ----
    let totalNew = 0;
    const EMBEDDING_API_KEY = process.env.EMBEDDING_API_KEY;
    const embCache = loadEmbeddingsCache();
    let embNewCount = 0;

    const months = Object.keys(monthBuckets).sort();
    for (const month of months) {
        const filePath = path.join(TRANSCRIPTS_DIR, month + '.json');
        const existing = loadMonthFile(filePath);

        const newChunks = monthBuckets[month].filter(c => {
            const firstUser = c.messages.find(m => m.role === 'user')?.content?.substring(0, 60) || '';
            return !existing.some(e => {
                const eFirst = e.messages?.find(m => m.role === 'user')?.content?.substring(0, 60) || '';
                return eFirst === firstUser;
            });
        });

        const processed = newChunks.map(c => {
            const content = c.messages.map(m =>
                `${m.role === 'user' ? '江鱼' : '沈望'}: ${m.content}`
            ).join('\n');
            const firstUser = c.messages.find(m => m.role === 'user')?.content || '';
            const firstAi = c.messages.find(m => m.role === 'assistant')?.content || '';
            const summary = (firstUser.substring(0, 30) + ' → ' + firstAi.substring(0, 30)).trim();
            return {
                id: c.id,
                timestamp: c.timestamp,
                end_time: c.end_time || c.timestamp,
                platform: 'web',
                topic_boundary: c.messages.length >= 30 || c.topic_boundary,
                messages: c.messages,
                chunk_summary: summary,
                content: content.substring(0, 2000),
                tags: [],
                expires_at: null
            };
        });

        const all = [...existing, ...processed];
        saveMonthFile(filePath, all);
        totalNew += processed.length;
        console.log(`  📁 ${month}: 已有 ${existing.length} 个, 新增 ${processed.length} 个, 共 ${all.length} 个`);
    }

    console.log(`\n✅ 导入完成，共新增 ${totalNew} 个对话 chunk`);

    // ---- 生成向量 ----
    if (EMBEDDING_API_KEY) {
        console.log('\n🧲 开始生成向量嵌入...');
        let done = 0;
        for (const month of months) {
            const filePath = path.join(TRANSCRIPTS_DIR, month + '.json');
            const chunks = loadMonthFile(filePath);
            for (const c of chunks) {
                if (embCache[c.id]) continue;
                const text = (c.chunk_summary || '') + ' ' + (c.content || '').substring(0, 400);
                if (!text.trim() || text.trim().length < 5) continue;
                try {
                    const embedding = await getEmbedding(text, EMBEDDING_API_KEY);
                    if (embedding) {
                        embCache[c.id] = embedding;
                        embNewCount++;
                    }
                } catch(e) {}
                done++;
                if (done % 10 === 0) process.stdout.write(`  🧲 ${done}/${totalNew}\r`);
            }
        }
        saveEmbeddingsCache(embCache);
        console.log(`\n✅ 向量完成: 新增 ${embNewCount} 条`);
    } else {
        console.log('\n⚠️ 未设置 EMBEDDING_API_KEY，跳过向量嵌入（雷达将仅使用关键词，效果稍弱）');
    }

    console.log('\n🎉 全部完成！');
}

main();
