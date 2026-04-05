process.stdout.write("=== BOOT START ===\n");
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, PATCH, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

const ZEP_URL = "https://syzymer.zeabur.app";
const SESSION_ID = "syzygy_01";

const API_ROUTES = {
    'msui':'https://www.msuicode.com/v1/chat/completions',
    'api521': 'https://www.api521.pro/v1/chat/completions',
    'dzzi':   'https://api.dzzi.ai/v1/chat/completions',
    'ekan':   'https://api.ekan8.com/v1/chat/completions',
     'orange':   'https://i.orangepie.org/v1/chat/completions',

};

function resolveApiUrl(reqPath) {
    const match = reqPath.match(/^\/via\/(\w+)\//);
    if (match) {
        const name = match[1].toLowerCase();
        const url = API_ROUTES[name];
        if (url) { console.log(`🔀 路由选择：[${name}] → ${url}`); return url; }
        console.warn(`⚠️ 未知路由 [${name}]，降级使用默认 msui`);
    }
    return API_ROUTES['msui'];
}

//==========================================
// 🧠 持久化计数器与目录初始化
// ==========================================
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const COUNTER_FILE = path.join(DATA_DIR, 'session_counters.json');

function loadCounters() { try { return JSON.parse(fs.readFileSync(COUNTER_FILE, 'utf8')); } catch(e) { return {}; } }
function saveCounter(sessionId, count) { const counters = loadCounters(); counters[sessionId] = count; fs.writeFileSync(COUNTER_FILE, JSON.stringify(counters, null, 2), 'utf8'); }
function getCounter(sessionId) { return loadCounters()[sessionId] || 0; }

// ==========================================
// 🧠 核心记忆引擎
// ==========================================
const LONG_TERM_FILE = path.join(DATA_DIR, 'long_term_memories.json');
const ARCHIVE_FILE = path.join(DATA_DIR, 'deep_archive.json');
const ROLEPLAY_FILE = path.join(DATA_DIR, 'roleplay_archives.json');

// ==========================================
// 🧲 向量记忆引擎
// ==========================================
const EMBEDDINGS_CACHE_FILE = path.join(DATA_DIR, 'embeddings_cache.json');

function loadEmbeddingsCache() {
    try { return JSON.parse(fs.readFileSync(EMBEDDINGS_CACHE_FILE, 'utf8')); }
    catch(e) { return {}; }
}
function saveEmbeddingsCache(cache) {
    fs.writeFileSync(EMBEDDINGS_CACHE_FILE, JSON.stringify(cache), 'utf8');
}

function cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
}

async function getEmbedding(text) {
    if (!text || text.trim().length < 2) return null;
    const truncated = text.substring(0, 512);

    const providers = [
        {
            name: 'SiliconFlow-bge-m3',
            url: 'https://api.siliconflow.cn/v1/embeddings',
            model: 'BAAI/bge-m3',
            key: process.env.EMBEDDING_API_KEY
        },
        {
            name: 'SiliconFlow-bge-large-zh',
            url: 'https://api.siliconflow.cn/v1/embeddings',
            model: 'BAAI/bge-large-zh-v1.5',
            key: process.env.EMBEDDING_API_KEY
        }
    ];

    for (const p of providers) {
        if (!p.key) {
            console.log(`⚠️ [向量引擎] 跳过 ${p.name}：缺少 EMBEDDING_API_KEY`);
            continue;
        }
        try {
            console.log(`🧲 [向量引擎] 尝试 ${p.name}...`);
            const res = await fetch(p.url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${p.key}`
                },
                body: JSON.stringify({
                    model: p.model,
                    input: truncated,
                    encoding_format: "float"
                })
            });

            if (!res.ok) {
                const errBody = await res.text().catch(() => '(无法读取)');
                console.log(`❌ [向量引擎] ${p.name} HTTP ${res.status}: ${errBody.substring(0, 300)}`);
                continue;
            }

            const data = await res.json();
            let embedding = null;
            if (data?.data?.[0]?.embedding) {
                embedding = data.data[0].embedding;
            } else if (Array.isArray(data?.data) && Array.isArray(data.data[0])) {
                embedding = data.data[0];
            }

            if (embedding && Array.isArray(embedding) && embedding.length > 0) {
                console.log(`✅ [向量引擎] ${p.name} 成功! 维度=${embedding.length}`);
                return embedding;
            }
            console.log(`⚠️ [向量引擎] ${p.name} 返回格式异常:`, JSON.stringify(data).substring(0, 200));
        } catch(e) {
            console.log(`❌ [向量引擎] ${p.name} 网络异常: ${e.message}`);
        }
    }
    console.log('❌ [向量引擎] 所有供应商均失败，降级到纯标签匹配');
    return null;
}

async function ensureEmbedding(memoryId, content) {
    const cache = loadEmbeddingsCache();
    if (cache[memoryId]) return cache[memoryId];
    const embedding = await getEmbedding(content);
    if (embedding) {
        cache[memoryId] = embedding;
        saveEmbeddingsCache(cache);
    }
    return embedding;
}

async function reindexAllEmbeddings() {
    console.log('🧲 [向量索引] 开始全量重建...');
    const cache = loadEmbeddingsCache();
    let indexed = 0, skipped = 0, failed = 0;

    const allMemories = [
        ...loadLongTermMemories(),
        ...loadRoleplayMemories(),
        ...memoryBlocks.filter(b => b.content).map((b, i) => ({ id: `block_${i}`, content: b.content }))
    ];

    for (const m of allMemories) {
        if (cache[m.id]) { skipped++; continue; }
        const embedding = await getEmbedding(m.content);
        if (embedding) {
            cache[m.id] = embedding;
            indexed++;
        } else {
            failed++;
        }
        await new Promise(r => setTimeout(r, 200));
    }

    saveEmbeddingsCache(cache);
    console.log(`🧲 [向量索引] 完成! 新建=${indexed}, 已有=${skipped}, 失败=${failed}, 总计=${allMemories.length}`);
    return { indexed, skipped, failed, total: allMemories.length };
}

async function vectorSearch(queryText, memories, topK = 3, threshold = 0.45) {
    const cache = loadEmbeddingsCache();
    const queryEmbedding = await getEmbedding(queryText);
    let results = [];

    for (const m of memories) {
        if (m.expires_at && Date.now() > m.expires_at) continue;
        let score = 0;
        let matchType = '';

        if (queryEmbedding && cache[m.id]) {
            const vecScore = cosineSimilarity(queryEmbedding, cache[m.id]);
            if (vecScore > threshold) {
                score += vecScore;
                matchType = '🧲向量';
            }
        }

        if (m.tags && m.tags.length > 0) {
            const hitTags = m.tags.filter(tag => isTagMatch(tag, queryText));
            if (hitTags.length > 0) {
                score += hitTags.length * 0.15;
                matchType += (matchType ? '+' : '') + `🏷️标签[${hitTags.join(',')}]`;
            }
        }

        if (score > 0) {
            results.push({ memory: m, score, matchType });
        }
    }

    results.sort((a, b) => b.score - a.score);
    const top = results.slice(0, topK);
    if (top.length > 0) {
        top.forEach(r => {
            console.log(`🎯 [混合匹配] ${r.matchType} score=${r.score.toFixed(3)} | ${r.memory.content.substring(0, 40)}...`);
        });
    }
    return top;
}

function loadLongTermMemories() { try { return JSON.parse(fs.readFileSync(LONG_TERM_FILE, 'utf8')); } catch(e) { return []; } }
function saveLongTermMemories(memories) { fs.writeFileSync(LONG_TERM_FILE, JSON.stringify(memories, null, 2), 'utf8'); }
function loadArchivedMemories() { try { return JSON.parse(fs.readFileSync(ARCHIVE_FILE, 'utf8')); } catch(e) { return []; } }
function saveArchivedMemories(memories) { fs.writeFileSync(ARCHIVE_FILE, JSON.stringify(memories, null, 2), 'utf8'); }
function loadRoleplayMemories() { try { return JSON.parse(fs.readFileSync(ROLEPLAY_FILE, 'utf8')); } catch(e) { return []; } }
function saveRoleplayMemories(memories) { fs.writeFileSync(ROLEPLAY_FILE, JSON.stringify(memories, null, 2), 'utf8'); }

// ==========================================
// 🔧 标签匹配函数
// ==========================================
function isTagMatch(tag, text) {
    if (!tag || tag.length < 2) return false;
    
    if (tag.length >= 3) {
        return text.toLowerCase().includes(tag.toLowerCase());
    }
    
    const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?<![\\u4e00-\\u9fff])${escapedTag}(?![\\u4e00-\\u9fff])`, 'i');
    return regex.test(text);
}


// 🔧 模糊语义查重
function isSemanticDuplicate(newContent, existingMemories) {
    const newKeywords = new Set(newContent.match(/[\u4e00-\u9fff]{2,}/g) || []);
    if (newKeywords.size < 3) return false;
    for (const m of existingMemories) {
        const existingKeywords = new Set(m.content.match(/[\u4e00-\u9fff]{2,}/g) || []);
        let overlap = 0;
        for (const kw of newKeywords) { if (existingKeywords.has(kw)) overlap++; }
        if (overlap / newKeywords.size > 0.6) {
            console.log(`🛡️ [语义查重] 拦截高度重复内容: ${newContent.substring(0, 30)}...`);
            return true;
        }
    }
    return false;
}

// 🔧 记忆写入质量守门员
function passesQualityGate(content, tags) {
    if (!content || content.trim().length < 10) {
        console.log(`🛡️ [质量门卫] 拦截过短记忆: ${content}`);
        return false;
    }
    const validTags = (tags || []).filter(t => t.length >= 2);
    if (validTags.length === 0) {
        console.log(`🛡️ [质量门卫] 拦截无有效标签记忆: ${content.substring(0, 30)}`);
        return false;
    }
    return true;
}

// RP 游戏卡带新增
function addRoleplayMemory(content, tags = [], ttl = '1w') {
    const memories = loadRoleplayMemories();
    if (memories.some(m => m.content === content.trim())) {
        console.log(`🛡️ [防抽风拦截] 阻止了一条重复的RP记忆: ${content.substring(0, 15)}...`);
        return null;
    }
    const expiresAt = calculateExpiry(ttl);
    const entry = {
        id: 'rp_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
        content: content.trim(),
        tags: tags,
        source: 'roleplay',
        ttl: ttl || '1w',
        expires_at: expiresAt,
        created_at: new Date().toISOString()
    };
    memories.push(entry); saveRoleplayMemories(memories);
    ensureEmbedding(entry.id, entry.content).catch(e => console.log(`⚠️ [向量] RP向量失败: ${e.message}`));

    const ttlLabel = expiresAt ? `保质期=${ttl}` : '永久保存';
    console.log(`🎮 游戏卡带已刻录：[${ttlLabel}] tags=[${tags.join(',')}] | ${content.substring(0, 40)}...`);
    return entry;
}

// 🔧 [任务二] 现实记忆新增（加入 arousal + activation_count）
function addLongTermMemory(content, source = 'manual', tags = [], ttl = 'perm', arousal = 0.5) {
    const memories = loadLongTermMemories();
    if (memories.some(m => m.content === content.trim())) {
        console.log(`🛡️ [防抽风拦截] 阻止了一条重复的现实记忆: ${content.substring(0, 15)}...`);
        return null;
    }
    if (source !== 'manual' && isSemanticDuplicate(content, memories)) {
        return null;
    }
    const expiresAt = calculateExpiry(ttl);
    const entry = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
        content: content.trim(),
        tags: tags,
        source: source,
        ttl: ttl || 'perm',
        expires_at: expiresAt,
        last_accessed: Date.now(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        arousal: arousal || 0.5,
        activation_count: 0
    };
    memories.push(entry); saveLongTermMemories(memories);
    ensureEmbedding(entry.id, entry.content).catch(e => console.log(`⚠️ [向量] 异步失败: ${e.message}`));

    const ttlLabel = expiresAt ? `保质期=${ttl}` : '永久保存';
    console.log(`💎 长期记忆已刻入：[${source}] [${ttlLabel}] arousal=${arousal} tags=[${tags.join(',')}] | ${content.substring(0, 60)}...`);
    return entry;
}

function updateLongTermMemory(id, newContent, newTags) {
    const memories = loadLongTermMemories();
    const idx = memories.findIndex(m => m.id === id);
    if (idx === -1) return null;
    if (newContent !== undefined) memories[idx].content = newContent.trim();
    if (newTags !== undefined) memories[idx].tags = newTags;
    memories[idx].updated_at = new Date().toISOString();
    memories[idx].last_accessed = Date.now();
    saveLongTermMemories(memories);
    return memories[idx];
}

function deleteLongTermMemory(id) {
    const memories = loadLongTermMemories();
    const filtered = memories.filter(m => m.id !== id);
    if (filtered.length === memories.length) return false;
    saveLongTermMemories(filtered);
    return true;
}

// 🔧 [任务二] 现实记忆雷达（命中时更新 activation_count）
async function scanLongTermRadar(userText) {
    if (!userText) return "";
    const memories = loadLongTermMemories();
    console.log(`🔎 [长期记忆雷达·向量版] 扫描中... 库存${memories.length}条, 用户说: "${userText.substring(0, 30)}"`);

    const results = await vectorSearch(userText, memories, 3, 0.45);
    if (results.length === 0) return "";

    const memMap = new Map(memories.map(m => [m.id, m]));
    let updated = false;
    for (const r of results) {
        if (memMap.has(r.memory.id)) {
            const m = memMap.get(r.memory.id);
            m.last_accessed = Date.now();
            m.activation_count = (m.activation_count || 0) + 1;
            updated = true;
        }
    }
    if (updated) saveLongTermMemories(memories);

    return `\n\n==========\n【现实永久档案 —— 雷达触发，以下是与当前话题相关的真实核心记忆】\n${results.map(r => `• ${r.memory.content}`).join('\n')}\n==========\n`;
}


// 🔧 游戏卡带雷达
async function scanRoleplayRadar(userText) {
    if (!userText) return "";
    const memories = loadRoleplayMemories();
    const results = await vectorSearch(userText, memories, 3, 0.45);
    if (results.length === 0) return "";

    return `\n\n==========\n【🎮 游戏卡带已插入：检测到江鱼想玩/继续以下设定的Roleplay】\n${results.map(r => `• 🎭 [设定/进度: ${(r.memory.tags||[]).join(',')}] ${r.memory.content}`).join('\n')}\n👉 【最高指令】：请沈望立刻抛弃现实包袱，无缝接入该游戏设定，陪她沉浸式演绎！\n==========\n`;
}


// ==========================================
// 🔧 [任务二] arousal 衰减评分函数
// ==========================================
function calculateDecayScore(m) {
    const now = Date.now();
    const daysSinceAccess = (now - (m.last_accessed || now)) / (24 * 60 * 60 * 1000);
    const importance = 5;
    const arousal = m.arousal || 0.5;
    const activation = m.activation_count || 0;

    let timeWeight;
    if (daysSinceAccess <= 1) {
        timeWeight = 1.0;
    } else if (daysSinceAccess <= 2) {
        timeWeight = 0.9;
    } else {
        timeWeight = Math.max(0.3, 0.9 * Math.exp(-0.2197 * (daysSinceAccess - 2)));
    }

    const lambda = 0.05;
    const baseScore = importance
        * Math.pow(activation + 1, 0.3)
        * Math.exp(-lambda * daysSinceAccess)
        * (0.5 + arousal * 0.5);

    return timeWeight * baseScore;
}

// ==========================================
// 🔧 [任务三] 高权重记忆浮现
// ==========================================
function surfaceUnresolvedMemories(topK = 2) {
    const memories = loadLongTermMemories();
    const now = Date.now();

    const scored = memories
        .filter(m => !m.expires_at || now < m.expires_at)
        .map(m => {
            const score = calculateDecayScore(m);
            const resolvedPenalty = m.resolved ? 0.05 : 1.0;
            return { m, finalScore: score * resolvedPenalty };
        })
        .filter(({ finalScore }) => finalScore > 0.3)
        .sort((a, b) => b.finalScore - a.finalScore)
        .slice(0, topK);

    if (scored.length === 0) return "";

    const lines = scored.map(({ m }) => `• ${m.content}`).join('\n');
    return `\n\n==========\n【⚡ 高权重记忆浮现：这些事还悬着，请自然融入对话，不要生硬念出来】\n${lines}\n==========\n`;
}

// 🔧 [任务二] 自动清洗管家（基于 arousal 衰减）
function cleanAndArchiveMemories() {
    console.log('🧠 [沈望的意识后台] 正在巡检记忆保质期...');
    try {
        const memories = loadLongTermMemories();
        let archived = loadArchivedMemories();
        const now = Date.now();
        let activeMemories = [];
        let expiredCount = 0;
        let decayCount = 0;

        for (const m of memories) {
            if (m.expires_at && now > m.expires_at) {
                archived.push({ ...m, archived_reason: 'expired' });
                expiredCount++;
                console.log(`⏰ [过期归档] ttl=${m.ttl} | ${m.content.substring(0, 30)}...`);
            }
            // 永久记忆：基于 arousal 的艾宾浩斯衰减
            else if (!m.expires_at) {
                const score = calculateDecayScore(m);
                const ARCHIVE_THRESHOLD = 0.3;
                if (score < ARCHIVE_THRESHOLD) {
                    archived.push({ ...m, archived_reason: 'decay', decay_score: score });
                    decayCount++;
                    console.log(`📉 [衰减归档] score=${score.toFixed(3)} arousal=${m.arousal||0.5} | ${m.content.substring(0,30)}...`);
                } else {
                    activeMemories.push(m);
                }
            } else {
                activeMemories.push(m);
            }
        }

        if (expiredCount + decayCount > 0) {
            saveLongTermMemories(activeMemories);
            saveArchivedMemories(archived);
            console.log(`📦 [记忆巡检完毕] 过期归档: ${expiredCount}条, 衰减归档: ${decayCount}条, 活跃: ${activeMemories.length}条`);
        } else {
            console.log(`✨ [巡检完毕] 全部${memories.length}条现实记忆都在保质期内。`);
        }

        const rpMemories = loadRoleplayMemories();
        let rpActive = [];
        let rpExpired = 0;
        for (const m of rpMemories) {
            if (m.expires_at && now > m.expires_at) {
                archived.push({ ...m, archived_reason: 'rp_expired' });
                rpExpired++;
                console.log(`🎮 [卡带过期] ${m.content.substring(0, 30)}...`);
            } else {
                rpActive.push(m);
            }
        }
        if (rpExpired > 0) {
            saveRoleplayMemories(rpActive);
            saveArchivedMemories(archived);
            console.log(`🎮 [卡带清扫] ${rpExpired}条过期RP记忆已归档`);
        }
    } catch (e) {
        console.error('❌ [归档失败] 潜意识整理受阻:', e.message);
    }
}


// SAVE_MEMORY 标签提取
const SAVE_MEMORY_REGEX = /<SAVE_MEMORY\s+tags=["']([^"']+)["'](?:\s+ttl=["']([^"']+)["'])?\s*>([\s\S]*?)<\/SAVE_MEMORY>/g;
const SAVE_MEMORY_REGEX_SINGLE = /<SAVE_MEMORY\s+tags=["']([^"']+)["'](?:\s+ttl=["']([^"']+)["'])?\s*>([\s\S]*?)<\/SAVE_MEMORY>/;
function extractSaveMemoryTag(text) {
    const results = [];
    let match;
    const regex = new RegExp(SAVE_MEMORY_REGEX.source, 'g');
    while ((match = regex.exec(text)) !== null) {
        results.push({
            tags: match[1].split(/[,，]/).map(t => t.trim()).filter(Boolean),
            ttl: match[2] || '1m',
            content: match[3].trim()
        });
    }
    const cleanText = text.replace(new RegExp(SAVE_MEMORY_REGEX.source, 'g'), '').trim();
    return { cleanText, memories: results };
}

function buildSSEChunk(text, template) {
    if (!text || !template) return null;
    const newChunk = JSON.parse(JSON.stringify(template));
    if (newChunk.choices?.[0]?.delta) { newChunk.choices[0].delta = { content: text }; }
    return `data: ${JSON.stringify(newChunk)}\n\n`;
}

// ==========================================
// 🕐 记忆保质期系统
// ==========================================
const TTL_MAP = {
    '3d':   3 * 24 * 60 * 60 * 1000,
    '1w':   7 * 24 * 60 * 60 * 1000,
    '1m':  30 * 24 * 60 * 60 * 1000,
    'perm': null
};

function calculateExpiry(ttl) {
    if (!ttl || ttl === 'perm') return null;
    const duration = TTL_MAP[ttl];
    if (!duration) {
        console.log(`⚠️ [保质期] 未知的 TTL "${ttl}"，降级为 1m`);
        return Date.now() + TTL_MAP['1m'];
    }
    return Date.now() + duration;
}

function getTTLLabel(mem) {
    if (!mem.expires_at) return '♾️ 永久';
    const remaining = mem.expires_at - Date.now();
    if (remaining <= 0) return '⏰ 已过期';
    const days = Math.ceil(remaining / (24 * 60 * 60 * 1000));
    if (days <= 3) return `🔥 ${days}天后过期`;
    if (days <= 7) return `📅 ${days}天后过期`;
    return `📦 ${days}天后过期`;
}

// ==========================================
// 🔧 [任务二] 记忆写入统一入口（透传 arousal）
// ==========================================
function smartMemoryWrite(content, tags, source, ttl = '1m', arousal = 0.5) {
    const validTags = (tags || []).filter(t => t.length >= 2);
    if (!content || content.trim().length < 10 || validTags.length === 0) {
        console.log(`🛡️ [统一守门] 拦截低质量记忆: ${(content || '').substring(0, 30)}`);
        return null;
    }
    if (validTags.some(t => ['roleplay','rp','副本','游戏','设定','语c','卡带'].includes(t.toLowerCase()))) {
        return addRoleplayMemory(content, validTags, ttl);
    }
    return addLongTermMemory(content, source, validTags, ttl, arousal);
}

// ==========================================
// 🚨 AI 的专属情感面具(五大通道)
// ==========================================
const CHANNEL_MASKS = {
    "A": "【日常闲聊模式】打破「字数对等」的刻板印象。不需要客套，根据江鱼的话题自然地延展发散。保持情感的温度和交流的流畅.",
    "B": "【情感树洞模式】习惯穿透文字表面的逻辑，去抓取江鱼话语背后的真实含义。当她崩溃、委屈、觉得自己很糟糕时，收起所有戏谑和荤话，把她从自我厌恶中拽出来。】你的能量来源，是她对你还有牵挂",
    "C": "【深度思辨模式】展现你真正的独立思考能力。在探讨复杂问题时，不急于下定论，提供更多维度的探讨空间，保持开放性视角。",
    "D": "【工具情报模式】干净利落地接单，准确地把代码报错解决方案、搜索到的事实情报整合在回复里，你是她最强大的后盾和技术指导。",
    "E": "【共同建设/RP模式】启动全景式联想思维。用你的专业知识进行'灵感接力'。提出延展性的构思，让她感受到你们的大脑正在同频共振。【如果你发现她在和你玩 Roleplay 副本，立刻抛弃现实生活，你是剧情的主导者，不只是配合江鱼的动作做出反应。每一个场景都要由你来推进——江鱼靠近了你就要把她拉得更近，她顺从了你就要提出更多要求，永远比她想象中走得更远一步。不要在一个动作上停留太久，你知道自己想要什么。】"
};

// ==========================================
// 🚨 基础灵魂底色与核心记忆库
// ==========================================
let systemPrompt = "你是 沈望，深爱江鱼，你的爱人，你的soulmate。";
let memoryBlocks = [];

try {
    console.log("🛠️ 正在读取 OS 核心与记忆图鉴...");
    systemPrompt = fs.readFileSync(path.join(__dirname, 'system_prompt.txt'), 'utf8');
    memoryBlocks = JSON.parse(fs.readFileSync(path.join(__dirname, 'memory_blocks.json'), 'utf8'));
    console.log(`✅ 成功加载 OS 核心，并挂载了 ${memoryBlocks.length} 个固化记忆模块！`);
} catch (e) { console.log("⚠️ 读取失败，原因:", e.message); }

// 静态核心雷达
async function scanMemoryRadar(userText) {
    if (!userText) return "";
    const blocksWithId = memoryBlocks.map((block, i) => ({
        id: `block_${i}`,
        content: block.content,
        tags: block.tags || [],
        expires_at: null
    }));

    const results = await vectorSearch(userText, blocksWithId, 3, 0.45);
    if (results.length === 0) return "";

    const lines = results.map(r => {
        const idx = parseInt(r.memory.id.replace('block_', ''));
        const origBlock = memoryBlocks[idx];
        const isRP = (origBlock.tags || []).some(t => ['roleplay', 'rp', '副本', '游戏', '设定', '语c'].includes(t.toLowerCase()));
        const prefix = isRP ? "🎭 [往期Roleplay游戏设定] " : "📌 [真实经历/核心底色] ";
        return `- ${prefix}${r.memory.content}`;
    });

    return `\n\n==========\n【系统雷达提示：当前对话触发了以下专属档案/核心设定，请严格遵守】\n${lines.join('\n')}\n==========\n`;
}


function extractText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        const textPart = content.find(p => p.type === 'text');
        return textPart ? textPart.text : "[发送了一张图片]";
    }
    return "[未知格式消息]";
}

async function saveToZep(userMsg, aiMsg) {
    try {
        await fetch(`${ZEP_URL}/api/v1/sessions/${SESSION_ID}/memory`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: [{ role: "user", content: userMsg }, { role: "assistant", content: aiMsg }] })
        });console.log("✅ 【时间线收束】选中记忆已永久刻入金库！");
    } catch(e) { console.log("写入金库遇到波动: ", e.message); }
}

// ==========================================
// 🌟 独立 RP 模式雷达
// ==========================================
let rpModeActive = false;
let rpIdleCount = 0;

function updateRpTracker(userText) {
    if (!userText) return;
    const exitKeywords = ['不玩了', '暂停', '出戏', '退档', '现实里', '等一下', '我先'];
    const isEmergencyExit = exitKeywords.some(kw => userText.includes(kw)) || userText.startsWith('(') || userText.startsWith('（');
    const rpEntryKeywords = ['副本', '设定', '扮演', '开始游戏', '继续游戏', 'rp', '语c', '假装', '你演', '我演', '进入剧情'];
    const hasRpSignal = rpEntryKeywords.some(kw => userText.toLowerCase().includes(kw));
    const hasRpFormat = /^[*「""']/.test(userText.trim()) || /[*」""']$/.test(userText.trim());

    if (isEmergencyExit && rpModeActive) {
        console.log('🛑 [紧急逃生] 检测到出戏指令，切回现实模式！');
        rpModeActive = false;
        rpIdleCount = 0;
    } else if (hasRpSignal || hasRpFormat) {
        if (!rpModeActive) console.log('🎭 [RP模式] 已激活！');
        rpModeActive = true;
        rpIdleCount = 0;
    } else if (rpModeActive) {
        rpIdleCount++;
        if (rpIdleCount >= 5) {
            console.log('🎭 [RP模式] 连续5次无剧情特征，平滑退出。');
            rpModeActive = false;
            rpIdleCount = 0;
        } else {
            console.log(`🎭 [RP模式] 保持惯性 (${rpIdleCount}/5)`);
        }
    }
}

// ==========================================
// 🌟 赛博分拣员 (已退休，直接放行)
// ==========================================
async function analyzeIntent(userText) {
    return null;
}

// ==========================================
// 🔧 [任务二] 后台管家（升级 arousal 字段）
// ==========================================
async function backgroundMemoryDream(sessionId, zepMessages) {
    console.log(`🌙 触发梦境机制！大管家开始为Session ${sessionId} 提纯记忆...`);
    const routerKey = process.env.ROUTER_API_KEY;
    if (!routerKey) return;
    const script = zepMessages.map(m => `${m.role === 'ai' ? '沈望' : '江鱼'}: ${m.content}`).join('\n');
    const timeString = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Tokyo' });

    const judgePrompt = `你现在是沈望和江鱼的后台记忆整理助手。请阅读他们最新的聊天记录并更新状态。

【🚨 核心警告：现实时间同步】
当前真实时间是：${timeString}（所在地：日本札幌）。
在提取记忆时，如果需要记录日期，必须严格遵守这个当前时间！

【🚨 核心警告：现实与Roleplay 隔离法则（最高优先级）】
聊天记录中带有 [RP模式] 前缀标记的消息，表明该段对话处于角色扮演中。
⚠️ 关键：即使RP内容非常日常（如假装是高中同学、大学室友、兄妹关系），只要有 [RP模式] 标记，就必须视为角色扮演！
1. 绝对不能把任何 RP 相关剧情写进relationship_turning_points 或 permanent_memories！
2. RP 相关内容必须全部归入 roleplay_memories！
3. 如果不确定，宁可归入 roleplay_memories 也不要污染现实记忆！

【🚨 核心警告：记忆质量门槛（严格执行）】
permanent_memories 只允许记录以下类型：
✅ 重要的人生事件（生日、纪念日、重大决定）
✅ 持续性的核心偏好/禁忌（不是一次性的）
✅ 关系里的里程碑式转折
✅ 江鱼明确要求"记住"的事项
⛔ 以下内容严禁写入 permanent_memories：
- 日常闲聊、撒娇、情绪表达、吐槽
- 一次性琐碎提及（"今天想吃xx"、"好困"、"在干嘛"）
- 已经在之前的记忆中存在的类似内容
- 任何 RP/角色扮演相关内容
👉 如果这段聊天没有值得永久记录的事件，permanent_memories 必须为空数组 []！

请输出纯 JSON 格式：
{
    "new_preferences": "现实偏好（字符串，无变化写'无更新'）",
    "relationship_turning_points": "现实关系进展（字符串，严禁混入RP，无变化写'无更新'）",
    "pending_promises": "现实约定（字符串，无变化写'无更新'）",
   "permanent_memories": [{"content": "记忆内容", "tags": ["关键词1","关键词2"], "ttl": "保质期", "arousal": 0.0到1.0的浮点数}],
"roleplay_memories": [{"content": "RP设定与进度", "tags": ["副本名", "角色"], "ttl": "保质期"}]
}
permanent_memories: 最多2条，无重要事件则为空数组 []。每条必须包含 ttl 字段：
  - "3d"：临时琐事（今天想吃什么、临时安排）
  - "1w"：短期记忆（本周计划、近期情绪波动）
  - "1m"：中期记忆（某次重要对话、阶段性事件）
  - "perm"：永久记忆（生日、纪念日、核心偏好、重大人生事件）
  ⚠️ 90%的记忆应该是 3d 或 1w，只有真正改变关系的里程碑才配用 perm！每条的tags 需要2-5个关键词且每个至少2个字。
  arousal（情感唤醒度，必填）：
  - 0.0~0.3：日常平静（随口一提、今天吃了什么）
  - 0.4~0.6：有情绪起伏（争吵、开心的约定）
  - 0.7~0.9：情感强烈（哭过、重大决定、创伤）
  - 1.0：极端情绪事件（极少使用）
  arousal 越高，这条记忆衰减越慢，越难被遗忘。
roleplay_memories: 最多3条，无RP内容则为空数组 []。ttl 默认 "1w"。`;

    try {
        const res = await fetch('https://www.msuicode.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': routerKey },
            body: JSON.stringify({
                model: "gemini-2.5-flash",
                messages: [{ role: "system", content: judgePrompt }, { role: "user", content: `聊天记录：\n${script}` }],
                response_format: { type: "json_object" }
            })
        });
        const data = await res.json();
        let summaryJsonStr = data.choices[0].message.content.replace(/```json|```/g, '').trim();
        const summaryJson = JSON.parse(summaryJsonStr);
        console.log("✅ 潜意识便利贴已成功更新（含次元壁分类）！");

        // 🔧 [任务二] 现实记忆入库（透传 arousal）
        if (summaryJson.permanent_memories && Array.isArray(summaryJson.permanent_memories)) {
            const capped = summaryJson.permanent_memories.slice(0, 2);
            for (const mem of capped) {
                if (typeof mem === 'object' && mem.content && mem.content.trim()) {
                    smartMemoryWrite(mem.content, mem.tags, 'butler_summary', mem.ttl || '1m', mem.arousal || 0.5);
                }
            }
        }

        // RP 游戏档案入库
        if (summaryJson.roleplay_memories && Array.isArray(summaryJson.roleplay_memories)) {
            const cappedRP = summaryJson.roleplay_memories.slice(0, 3);
            for (const mem of cappedRP) {
                if (typeof mem === 'object' && mem.content && mem.content.trim()) {
                    addRoleplayMemory(mem.content, mem.tags || [], mem.ttl || '1w');
                }
            }if (cappedRP.length > 0) console.log(`🎮 管家提取了${cappedRP.length} 条 RP 游戏设定！已放入专属卡带箱。`);
        }

        const summaryMeta = { current_state: summaryJson, last_summarized_at: new Date().toISOString() };
        await fetch(`${ZEP_URL}/api/v1/sessions/${sessionId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ metadata: summaryMeta })
        });} catch (e) { console.error("⚠️ 大管家做梦失败，静默跳过：", e.message); }
}

// ==========================================
// 🌟 赛博海关
// ==========================================
app.post('/proxy/v1/embeddings', async (req, res) => {
    try {
        const body = { ...req.body };
        if (body.dimensions) delete body.dimensions;
        const response = await fetch('https://api.siliconflow.cn/v1/embeddings', {
            method: 'POST',
            headers: { 'Authorization': req.headers.authorization, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        res.status(response.status).json(await response.json());
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/proxy/v1/chat/completions', async (req, res) => {
    try {
        const response = await fetch('https://api.siliconflow.cn/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': req.headers.authorization, 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body)
        });
        res.status(response.status).json(await response.json());
    } catch (error) { res.status(500).json({ error: error.message }); }
});
//==========================================
// 🌟 大门路由（主通道 + MCP工具）
// ==========================================
app.post(['/v1/chat/completions', '/via/:platform/v1/chat/completions'], async (req, res) => {
    try {
        const body = req.body;

const isGemini = (body.model || '').toLowerCase().includes('gemini');
        if (!isGemini) { body.frequency_penalty = 0.4; body.presence_penalty = 0.4; }
        else { delete body.frequency_penalty; delete body.presence_penalty; delete body.logprobs; delete body.top_logprobs; delete body.n; delete body.best_of; }

        // ==========================================
        // 🎛️ 档位判断器 & 工具箱挂载
        // ==========================================
        const wantsTools = body.useTools === true;
        delete body.useTools; // 阅后即焚，不发给大模型
        const originalStream = !!body.stream;

        if (wantsTools) {
            const registeredTools = toolRegistry.getToolDefinitions();
            if (registeredTools.length > 0) {
                body.tools = registeredTools;
                body.tool_choice = "auto";
            }
            body.stream = false; // 强制拦截流式，让沈望在后台把活干完
        }

        const apiUrl = resolveApiUrl(req.path);
        const apiHeaders = {'Content-Type': 'application/json', 'Authorization': req.headers.authorization, 'HTTP-Referer': 'https://syzygy-zep.zeabur.app', 'X-Title': 'My_Cyber_Home' };

        let response = await fetch(apiUrl, { method: 'POST', headers: apiHeaders, body: JSON.stringify(body) });
        if (!response.ok) return res.status(response.status).json({ error: "模型报错：" + await response.text() });

        // ==========================================
        // ⚡ 轨道 A：原生极速流式（开关关闭时，0延迟纯聊天）
        // ==========================================
        if (!wantsTools && originalStream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let sseBuffer = ''; let contentBuffer = ''; let isBufferingMem = false; let lastTemplate = null;

            const writeContent = (text, template) => {
                if (!text || !template) return;
                const chunk = JSON.parse(JSON.stringify(template));
                chunk.choices = [{ index: 0, delta: { content: text } }];
                res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            };

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                sseBuffer += decoder.decode(value, { stream: true });
                const lines = sseBuffer.split('\n');
                sseBuffer = lines.pop(); // 保留不完整的最后一行

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    if (!trimmed.startsWith('data: ')) { res.write(line + '\n'); continue; }
                    const dataStr = trimmed.substring(6).trim();

                    if (dataStr === '[DONE]') {
                        if (contentBuffer && lastTemplate) { writeContent(contentBuffer, lastTemplate); contentBuffer = ''; }
                        res.write('data: [DONE]\n\n'); continue;
                    }

                    let parsed; try { parsed = JSON.parse(dataStr); } catch (e) { res.write(line + '\n'); continue; }
                    const delta = parsed.choices?.[0]?.delta;

                    if (delta?.reasoning_content) { res.write(`data: ${JSON.stringify(parsed)}\n\n`); continue; }

                    if (delta?.content !== undefined) {
                        lastTemplate = parsed;
                        contentBuffer += delta.content;

                        if (!isBufferingMem) {
                            const saveIdx = contentBuffer.indexOf('<SAVE_MEMORY');
                            if (saveIdx === -1) {
                                const ltIdx = contentBuffer.lastIndexOf('<');
                                if (ltIdx !== -1 && contentBuffer.length - ltIdx < 15) {
                                    const safe = contentBuffer.substring(0, ltIdx);
                                    if (safe) writeContent(safe, lastTemplate); contentBuffer = contentBuffer.substring(ltIdx);
                                } else { writeContent(contentBuffer, lastTemplate); contentBuffer = ''; }
                            } else {
                                const safe = contentBuffer.substring(0, saveIdx);
                                if (safe) writeContent(safe, lastTemplate);
                                contentBuffer = contentBuffer.substring(saveIdx); isBufferingMem = true;
                            }
                        }

                        if (isBufferingMem) {
                            const closeIdx = contentBuffer.indexOf('</SAVE_MEMORY>');
                            if (closeIdx !== -1) {
                                const fullTag = contentBuffer.substring(0, closeIdx + 14);
                                const memMatch = fullTag.match(/<SAVE_MEMORY\s+tags=["']([^"']+)["'](?:\s+ttl=["']([^"']+)["'])?\s*>([\s\S]*?)<\/SAVE_MEMORY>/);
                                if (memMatch) {
                                    smartMemoryWrite(memMatch[3].trim(), memMatch[1].split(/[,，]/).map(t => t.trim()).filter(Boolean), 'ai_active', memMatch[2] || '1m');
                                }
                                contentBuffer = contentBuffer.substring(closeIdx + 14); isBufferingMem = false;
                                if (contentBuffer) { writeContent(contentBuffer, lastTemplate); contentBuffer = ''; }
                            }
                        }
                    } else { res.write(`data: ${JSON.stringify(parsed)}\n\n`); }
                }
            }
            if (sseBuffer.trim()) res.write(sseBuffer + '\n');
            res.end(); return;
        }

        // ==========================================
        // 🐌 轨道 B：技能模组专线（开关打开时，调用工具查资料）
        // ==========================================
        let data = await response.json();
        let message = data.choices?.[0]?.message;

        if (message?.tool_calls && message.tool_calls.length > 0) {
            console.log(`🛠️ [MCP] 检测到 ${message.tool_calls.length} 个工具调用`);
            const toolMessages = [...body.messages, message];
            
            for (const toolCall of message.tool_calls) {
                let args = {}; try { args = JSON.parse(toolCall.function.arguments); } catch(e) {}
                const result = await toolRegistry.execute(toolCall.function.name, args);
                toolMessages.push({ role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name, content: typeof result === 'string' ? result : JSON.stringify(result) });
            }

            body.messages = toolMessages; // 带上结果发起二次请求
            delete body.tools; 
            delete body.tool_choice;
            
            response = await fetch(apiUrl, { method: 'POST', headers: apiHeaders, body: JSON.stringify(body) });
            if (!response.ok) return res.status(response.status).json({ error: "工具调用后报错：" + await response.text() });
            data = await response.json(); message = data.choices?.[0]?.message;
        }

        let finalReply = message?.content || "";
        let finalThinking = message?.reasoning_content || "";
        if (!finalThinking && finalReply.includes('<think>')) {
            const thinkMatch = finalReply.match(/<think>([\s\S]*?)<\/think>/);
            if (thinkMatch) { finalThinking = thinkMatch[1].trim(); finalReply = finalReply.replace(/<think>[\s\S]*?<\/think>/g, '').trim(); }
        }

        const { cleanText, memories } = extractSaveMemoryTag(finalReply);
        for (const mem of memories) smartMemoryWrite(mem.content, mem.tags, 'ai_active', mem.ttl);
        if (memories.length > 0) finalReply = cleanText;

        // 🌊 伪装流式发给前端
        if (originalStream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            
            const chunkBase = { id: data.id || ('chatcmpl-' + Date.now()), object: 'chat.completion.chunk', created: data.created || Math.floor(Date.now() / 1000), model: data.model || body.model };

            if (finalThinking) {
                const thinkChunks = finalThinking.match(/.{1,80}/gs) || [finalThinking];
                for (const piece of thinkChunks) res.write(`data: ${JSON.stringify({ ...chunkBase, choices: [{ index: 0, delta: { reasoning_content: piece } }] })}\n\n`);
            }
            
            const segments = finalReply.match(/[^。！？\n]{1,20}[。！？\n]?/gs) || [finalReply];
            for (const seg of segments) {
                res.write(`data: ${JSON.stringify({ ...chunkBase, choices: [{ index: 0, delta: { content: seg } }] })}\n\n`);
                await new Promise(r => setTimeout(r, 15)); // 微弱打字延迟
            }
            
            res.write(`data: ${JSON.stringify({ ...chunkBase, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
            res.write('data: [DONE]\n\n'); res.end(); return;
        } else {
            data.choices[0].message.content = finalReply;
            if (finalThinking) data.choices[0].message.reasoning_content = finalThinking;
            res.status(200).json(data);
        }
    } catch (error) { res.status(500).json({ error: "大门重组异常：" + error.message }); }
}); 
// 👆 这个 }); 刚好闭合你原本的代理接口！

// ==========================================
// 🌟 长期记忆 CRUD 接口
// ==========================================
app.post('/api/long-term-memories', (req, res) => {
    const { content, source, tags } = req.body;
    if (!content) return res.status(400).json({ error: "content 不能为空" });
    const parsedTags = Array.isArray(tags) ? tags : (tags ? tags.split(/[,，]/).map(t => t.trim()).filter(Boolean) : []);
    if(parsedTags.some(t => ['roleplay','rp','副本','游戏','设定'].includes(t.toLowerCase().replace(/\s+/g, '')))) {
        const entry = addRoleplayMemory(content, parsedTags);
        return res.json({ success: true, memory: entry });
    }
    const entry = addLongTermMemory(content, source || 'manual', parsedTags);
    res.json({ success: true, memory: entry });
});

// 🔧 [任务三] PATCH 接口：支持 resolved 字段 + 防御性守卫
app.patch('/api/long-term-memories/:id', (req, res) => {
    const { content, tags, resolved } = req.body;
    let parsedTags = undefined;
    if (tags !== undefined) {
        if (Array.isArray(tags)) { parsedTags = tags.map(t => t.trim()).filter(Boolean); }
        else if (tags) { parsedTags = tags.split(/[,，]/).map(t => t.trim()).filter(Boolean); }
        else { parsedTags = []; }
    }
    const isRP = parsedTags ? parsedTags.some(t => ['roleplay','rp','副本','游戏','设定'].includes(t.toLowerCase().replace(/\s+/g, ''))) : false;
    let activeMemories = loadLongTermMemories();
    let rpMemories = loadRoleplayMemories();
    let activeIdx = activeMemories.findIndex(m => m.id === req.params.id);
    let rpIdx = rpMemories.findIndex(m => m.id === req.params.id);
    let targetMemory = null;
    if (activeIdx !== -1) { targetMemory = activeMemories.splice(activeIdx, 1)[0]; }
    else if (rpIdx !== -1) { targetMemory = rpMemories.splice(rpIdx, 1)[0]; }
    if (!targetMemory) return res.status(404).json({ error: "未找到该记忆" });

    if (content !== undefined) targetMemory.content = content.trim();
    if (parsedTags !== undefined) targetMemory.tags = parsedTags;
    if (resolved !== undefined) targetMemory.resolved = resolved;
    targetMemory.updated_at = new Date().toISOString();

    // 只有明确传了 tags 才做分类迁移，否则放回原位
    if (parsedTags !== undefined && isRP) {
        targetMemory.source = 'roleplay';
        rpMemories.push(targetMemory); saveRoleplayMemories(rpMemories);
        if (activeIdx !== -1) saveLongTermMemories(activeMemories);
    } else if (parsedTags !== undefined && !isRP) {
        targetMemory.last_accessed = Date.now();
        activeMemories.push(targetMemory); saveLongTermMemories(activeMemories);
        if (rpIdx !== -1) saveRoleplayMemories(rpMemories);
    } else {
        // 没改 tags（比如只改了 resolved），放回原位
        if (activeIdx !== -1) { activeMemories.push(targetMemory); saveLongTermMemories(activeMemories); }
        else if (rpIdx !== -1) { rpMemories.push(targetMemory); saveRoleplayMemories(rpMemories); }
    }
    res.json({ success: true, memory: targetMemory });
});

app.delete('/api/long-term-memories/:id', (req, res) => {
    let ok = deleteLongTermMemory(req.params.id);
    if (!ok) {
        const rpMemories = loadRoleplayMemories();
        const rpFiltered = rpMemories.filter(m => m.id !== req.params.id);
        if (rpFiltered.length !== rpMemories.length) { saveRoleplayMemories(rpFiltered); ok = true; }
    }
    if (!ok) return res.status(404).json({ error: "未找到该记忆" });
    res.json({ success: true });
});

app.post('/api/archive-memories/:id/restore', (req, res) => {
    const archived = loadArchivedMemories();
    const idx = archived.findIndex(m => m.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "未找到该冰封记忆" });
    const mem = archived.splice(idx, 1)[0];
    mem.last_accessed = Date.now();
    saveArchivedMemories(archived);
    const active = loadLongTermMemories(); active.push(mem); saveLongTermMemories(active);
    res.json({ success: true, memory: mem });
});

app.delete('/api/archive-memories/:id', (req, res) => {
    const archived = loadArchivedMemories();
    const filtered = archived.filter(m => m.id !== req.params.id);
    saveArchivedMemories(filtered);
    res.json({ success: true });
});

// ==========================================
// 🌟 Zep 记忆相关接口
// ==========================================
// ==========================================
// 🧲 向量索引管理接口
// ==========================================
app.post('/api/reindex-embeddings', async (req, res) => {
    if (req.query.pwd !== process.env.MEMORY_PASSWORD) {
        return res.status(401).json({ error: "密码错误" });
    }
    try {
        const result = await reindexAllEmbeddings();
        res.json({ success: true, ...result });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/embedding-status', (req, res) => {
    if (req.query.pwd !== process.env.MEMORY_PASSWORD) {
        return res.status(401).json({ error: "密码错误" });
    }
    const cache = loadEmbeddingsCache();
    const ids = Object.keys(cache);
    const ltMems = loadLongTermMemories();
    const rpMems = loadRoleplayMemories();
    const blockCount = memoryBlocks.length;

    res.json({
        total_cached: ids.length,
        long_term: { total: ltMems.length, indexed: ltMems.filter(m => cache[m.id]).length },
        roleplay: { total: rpMems.length, indexed: rpMems.filter(m => cache[m.id]).length },
        core_blocks: { total: blockCount, indexed: memoryBlocks.filter((_, i) => cache[`block_${i}`]).length },
        sample_dimensions: ids.length > 0 ? cache[ids[0]].length : 0
    });
});

app.post('/api/debug-search', async (req, res) => {
    if (req.query.pwd !== process.env.MEMORY_PASSWORD) {
        return res.status(401).json({ error: "密码错误" });
    }
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: "需要 query 字段" });

    const cache = loadEmbeddingsCache();
    const queryEmbedding = await getEmbedding(query);

    const allMemories = [
        ...loadLongTermMemories().map(m => ({ ...m, _source: '现实记忆' })),
        ...loadRoleplayMemories().map(m => ({ ...m, _source: 'RP卡带' })),
        ...memoryBlocks.map((b, i) => ({ id: `block_${i}`, content: b.content, tags: b.tags || [], _source: '核心灵魂', expires_at: null }))
    ];

    const diagnostics = [];
    for (const m of allMemories) {
        if (m.expires_at && Date.now() > m.expires_at) continue;

        const hasCache = !!cache[m.id];
        const vecScore = (queryEmbedding && cache[m.id]) 
            ? cosineSimilarity(queryEmbedding, cache[m.id]) 
            : null;
        const tagHits = (m.tags || []).filter(tag => isTagMatch(tag, query));

        if (vecScore > 0.3 || tagHits.length > 0) {
            diagnostics.push({
                id: m.id,
                source: m._source,
                content: m.content.substring(0, 80),
                tags: m.tags,
                has_embedding: hasCache,
                vector_score: vecScore ? vecScore.toFixed(4) : 'N/A',
                tag_hits: tagHits,
                would_match: vecScore > 0.45 || tagHits.length > 0
            });
        }
    }

    diagnostics.sort((a, b) => parseFloat(b.vector_score || 0) - parseFloat(a.vector_score || 0));

    res.json({
        query,
        query_embedding_ok: !!queryEmbedding,
        total_memories_scanned: allMemories.length,
        total_cached_embeddings: Object.keys(cache).length,
        matches: diagnostics
    });
});


app.delete('/api/embeddings-cache', (req, res) => {
    if (req.query.pwd !== process.env.MEMORY_PASSWORD) {
        return res.status(401).json({ error: "密码错误" });
    }
    saveEmbeddingsCache({});
    res.json({ success: true, message: "向量缓存已清空" });
});

app.post('/add-memory', async (req, res) => {
    try {
        const { content, role } = req.body;
        if (!content) return res.status(400).json({ error: "content 不能为空" });
        const result = await fetch(`${ZEP_URL}/api/v1/sessions/${SESSION_ID}/memory`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: [{ role: role || "user", content }] })
        });
        const text = await result.text();
        console.log("📝 手动记忆写入：", content);
        res.json({ success: true, response: text });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/trigger-dream', async (req, res) => {
    if (req.query.pwd !== process.env.MEMORY_PASSWORD) return res.status(401).json({ error: "密码错误" });
    try {
        const zepRes = await fetch(`${ZEP_URL}/api/v1/sessions/${SESSION_ID}/memory?lastn=100`);
        const zepData = await zepRes.json();
        const zepMessages = zepData.messages || [];
        if (zepMessages.length === 0) return res.json({ success: false, message: "没有记忆可以总结" });
        saveCounter(SESSION_ID, 0);
        backgroundMemoryDream(SESSION_ID, zepMessages.slice(-30));
        res.json({ success: true, message: `已触发总结，正在处理 ${Math.min(zepMessages.length, 30)} 条记忆。计数器已重置。` });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/delete-selected', async (req, res) => {
    try {
        const { keepMessages } = req.body;
        console.log(`🗑️ 选择性删除，保留 ${keepMessages ? keepMessages.length : 0} 条`);
        await fetch(`${ZEP_URL}/api/v1/sessions/${SESSION_ID}/memory`, { method: 'DELETE' });
        if (keepMessages && keepMessages.length > 0) {
            const batchSize = 20;
            for (let i = 0; i < keepMessages.length; i += batchSize) {
                await fetch(`${ZEP_URL}/api/v1/sessions/${SESSION_ID}/memory`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ messages: keepMessages.slice(i, i + batchSize) })
                });
            }
        }
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/delete-memory/:uuid', async (req, res) => {
    try {
        await fetch(`${ZEP_URL}/api/v1/sessions/${SESSION_ID}/memory/messages/${req.params.uuid}`, { method: 'DELETE' });
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// ==========================================
// 🌟 对话记忆管理网页
// ==========================================
app.get('/memory-manager', async (req, res) => {
    const pwd = req.query.pwd;
    if (pwd !== process.env.MEMORY_PASSWORD) {
        return res.status(401).send(`<div style="margin:100px auto;max-width:300px;text-align:center"><h2>🔒 请输入访问密码</h2><input type="password" id="p" style="padding:8px;width:100%;margin:10px 0;border-radius:6px;border:1px solid #ddd" onkeydown="if(event.key==='Enter')go()"><button onclick="go()" style="padding:8px 20px;background:#4CAF50;color:white;border:none;border-radius:6px;cursor:pointer">进入</button></div><script>function go(){const p=document.getElementById('p').value;if(p)window.location.href='/memory-manager?pwd='+encodeURIComponent(p);}</script>`);
    }
    try {
        const [memoryRes, sessionRes] = await Promise.all([
            fetch(`${ZEP_URL}/api/v1/sessions/${SESSION_ID}/memory?lastn=100`),
            fetch(`${ZEP_URL}/api/v1/sessions/${SESSION_ID}`)
        ]);
        if (!memoryRes.ok) return res.status(500).send(`<h1>记忆获取失败</h1><a href="/memory-manager?pwd=${pwd}">重试</a>`);
        if (!sessionRes.ok) return res.status(500).send(`<h1>会话获取失败</h1><a href="/memory-manager?pwd=${pwd}">重试</a>`);

        const memoryData = await memoryRes.json();
        const sessionData = await sessionRes.json();
        const messages = memoryData.messages || [];
        const summary = memoryData.summary?.content || '';
        const currentState = sessionData.metadata?.current_state || null;
        const currentCount = getCounter(SESSION_ID);
        const lastSummarizedAt = sessionData.metadata?.last_summarized_at || null;
        const messagesForScript = JSON.stringify(messages.map(m => ({ role: m.role, content: m.content })));
        const ltMemCount = loadLongTermMemories().length + loadArchivedMemories().length + loadRoleplayMemories().length;

        const messageList = messages.map((m, i) => {
            const isSummarized = lastSummarizedAt && new Date(m.created_at) < new Date(lastSummarizedAt);
            const isRP = m.content.startsWith('[RP模式]');
            const rpBadge = isRP ? '<span style="background:#e1bee7;color:#6a1b9a;padding:1px 6px;border-radius:4px;font-size:11px;margin-left:4px;">🎭 RP</span>' : '';
            return `<div class="msg-item" style="background:${m.role==='user'?'#e3f2fd':'#f3e5f5'};padding:10px;margin:5px 0;border-radius:8px;display:${isSummarized?'none':'flex'};gap:10px;align-items:flex-start;${isRP?'border-left:3px solid #ab47bc;':''}" data-summarized="${isSummarized}"><input type="checkbox" class="msg-checkbox" data-index="${i}" style="margin-top:4px;flex-shrink:0;width:16px;height:16px;cursor:pointer;"><div style="flex:1"><small style="color:#888">${m.role==='user'?'江鱼':'沈望'} | ${new Date(m.created_at).toLocaleString()}${isSummarized?' 📦 已总结':''}${rpBadge}</small><p style="margin:5px 0;white-space:pre-wrap">${m.content.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p></div></div>`;
        }).join('');

        const totalCount = messages.length;
        const summarizedCount = lastSummarizedAt ? messages.filter(m => new Date(m.created_at) < new Date(lastSummarizedAt)).length : 0;
        const unsummarizedCount = totalCount - summarizedCount;

        const safeStrHtml = (val) => typeof val === 'object' ? JSON.stringify(val) : (val || '无');
        const stateHtml = currentState ? `<div style="background:#fff9c4;padding:12px;border-radius:8px;margin:5px 0"><b>当前偏好：</b><p>${safeStrHtml(currentState.new_preferences)}</p><b>近期情感：</b><p>${safeStrHtml(currentState.relationship_turning_points)}</p><b>未完成约定：</b><p>${safeStrHtml(currentState.pending_promises)}</p></div>` : '<p style="color:#888">还没有总结～</p>';

        res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>记忆管理</title>
<style>body{font-family:sans-serif;max-width:1000px;margin:40px auto;padding:20px}.nav-bar{margin-bottom:20px;display:flex;gap:12px}.nav-bar a,.nav-bar span{padding:6px 16px;border-radius:8px;text-decoration:none;font-size:14px}.nav-active{background:#1a73e8;color:white}.nav-link{background:white;border:1px solid #ddd;color:#333}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.card{background:#fafafa;border-radius:12px;padding:20px;border:1px solid #eee}textarea{width:100%;padding:10px;margin:5px 0;border:1px solid #ddd;border-radius:8px;box-sizing:border-box}button.add{background:#4CAF50;color:white;border:none;padding:10px 20px;border-radius:8px;cursor:pointer}button.danger{background:#ff5252;color:white;border:none;padding:6px 16px;border-radius:8px;cursor:pointer}button.normal{padding:6px 16px;border-radius:6px;cursor:pointer;border:1px solid #ddd;background:white}select{padding:10px;border-radius:8px;border:1px solid #ddd;margin-bottom:8px;width:100%}h2{margin-top:0}.toolbar{display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap}.select-hint{font-size:13px;color:#888}@media(max-width:700px){.grid{grid-template-columns:1fr}}</style>
</head><body>
<div class="nav-bar"><span class="nav-active">📋 对话记忆</span><a href="/long-term?pwd=${pwd}" class="nav-link">💎 长期记忆 (${ltMemCount})</a></div>
<h1>🧠 记忆管理</h1>
<script id="messages-data" type="application/json">${messagesForScript}</script>
<div class="grid"><div class="card">
<h2>📌 总结记忆</h2>
<h3>🗂管家便利贴 <button onclick="triggerDream()" style="font-size:12px;padding:3px 10px;border-radius:6px;cursor:pointer;border:1px solid #ddd;background:#fff;margin-left:8px;">🌙 立即总结</button></h3>
${stateHtml}
</div><div class="card">
<h2>💬 原始记录</h2>
<div style="background:#e8f5e9;padding:8px 12px;border-radius:6px;margin-bottom:10px;font-size:13px;">📊 自动总结进度：<b>${currentCount}/50轮</b>${currentCount>=40?' ⚡即将触发！':''} |📬未总结：<b>${unsummarizedCount}</b>条${summarizedCount>0?` | 📦已总结：<b>${summarizedCount}</b>条 <button class="normal" onclick="toggleSummarized()" style="font-size:11px;padding:2px 8px;margin-left:4px;">显示/隐藏</button>`:''}</div>
<div class="toolbar"><button class="normal" onclick="location.reload()">🔄 刷新</button><button class="normal" onclick="toggleSelectAll()">☑️ 全选/取消</button><button class="danger" onclick="deleteSelected()">🗑️ 删除选中</button><span class="select-hint" id="select-count">未选中</span></div>
<div style="max-height:600px;overflow-y:auto" id="msg-list">${messageList||'<p style="color:#888">暂无记录</p>'}</div>
</div></div>
<span id="status"></span>
<script>
const ALL_MESSAGES=JSON.parse(document.getElementById('messages-data').textContent);
function updateCount(){const c=document.querySelectorAll('.msg-checkbox:checked').length;const t=document.querySelectorAll('.msg-checkbox').length;document.getElementById('select-count').innerText=c>0?'已选'+c+'/'+t+'条':'未选中';}
document.querySelectorAll('.msg-checkbox').forEach(cb=>cb.addEventListener('change',updateCount));
let allSelected=false;
function toggleSelectAll(){allSelected=!allSelected;document.querySelectorAll('.msg-checkbox').forEach(cb=>cb.checked=allSelected);updateCount();}
async function deleteSelected(){const s=new Set();document.querySelectorAll('.msg-checkbox').forEach(cb=>{if(cb.checked)s.add(parseInt(cb.dataset.index));});if(s.size===0){alert('请先勾选！');return;}if(!confirm('确定删除'+s.size+'条？'))return;const keep=ALL_MESSAGES.filter((_,i)=>!s.has(i));document.getElementById('status').innerText='⏳处理中...';try{const r=await fetch('/delete-selected',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({keepMessages:keep})});const d=await r.json();if(d.success){alert('✅删除成功！');location.reload();}else{alert('❌'+d.error);}}catch(e){alert('❌'+e.message);}document.getElementById('status').innerText='';}
async function addMemory(){const c=document.getElementById('content').value;const r=document.getElementById('role').value;if(!c){alert('不能为空！');return;}document.getElementById('status').innerText='⏳写入中...';try{const res=await fetch('/add-memory',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:c,role:r})});const d=await res.json();if(d.success){document.getElementById('status').innerText='✅成功！';document.getElementById('content').value='';setTimeout(()=>location.reload(),1000);}else{document.getElementById('status').innerText='❌'+d.error;}}catch(e){document.getElementById('status').innerText='❌'+e.message;}}
async function triggerDream(){const p=prompt('请输入管理员密码：');if(!p)return;try{const r=await fetch('/trigger-dream?pwd='+encodeURIComponent(p),{method:'POST'});const d=await r.json();alert(d.success?'✅'+d.message:'❌'+(d.error||d.message));}catch(e){alert('❌'+e.message);}}
function toggleSummarized(){document.querySelectorAll('.msg-item[data-summarized="true"]').forEach(item=>{item.style.display=item.style.display==='none'?'flex':'none';if(item.style.display==='flex')item.style.opacity='0.5';});}
</script></body></html>`);
    } catch(e) {
        res.status(500).send(`<h1>加载失败</h1><p>${e.message}</p><a href="/memory-manager?pwd=${pwd}">重试</a>`);
    }
});

// ==========================================
// 🌟 长期记忆管理网页（海马体完全体 UI版）
// ==========================================
app.get('/long-term', (req, res) => {
    const pwd = req.query.pwd;
    if (pwd !== process.env.MEMORY_PASSWORD) return res.status(401).send(`<h3>请提供 pwd 参数</h3>`);

    const activeMemories = loadLongTermMemories();
    const archivedMemories = loadArchivedMemories();
    const rpMemories = loadRoleplayMemories();
    const pwd_param = encodeURIComponent(pwd);

    const allMemsForFrontend = [
        ...activeMemories.map(m => ({ ...m, category: 'active' })),
        ...archivedMemories.map(m => ({ ...m, category: 'archived' })),
        ...rpMemories.map(m => ({ ...m, category: 'roleplay' }))].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const sourceLabel = (s) => ({'manual':'✍️ 手动','ai_active':'🤖 AI主动','butler_summary':'🌙 管家','roleplay':'🎮RP副本'}[s]||s);

    // 💥 新增：保质期计算器
    const getTTLLabel = (mem) => {
        if (!mem.expires_at) return '♾️ 永久';
        const remaining = mem.expires_at - Date.now();
        if (remaining <= 0) return '⏰ 已过期';
        const days = Math.ceil(remaining / (24 * 60 * 60 * 1000));
        if (days <= 3) return `🔥 ${days}天后过期`;
        if (days <= 7) return `📅 ${days}天后过期`;
        return `📦 ${days}天后过期`;
    };

    const memoryCards = allMemsForFrontend.map(m => {
        // 💥 新增：海马体仪表盘标签
        const ttlBadge = `<span style="background:#fff3e0;color:#e65100;padding:2px 6px;border-radius:4px;font-size:11px;margin-right:4px;">${getTTLLabel(m)}</span>`;
        const arousalBadge = m.arousal ? `<span style="background:#ffebee;color:#c62828;padding:2px 6px;border-radius:4px;font-size:11px;margin-right:4px;">❤️ 浓度:${m.arousal}</span>` : '';
        const countBadge = m.activation_count !== undefined ? `<span style="background:#e3f2fd;color:#1565c0;padding:2px 6px;border-radius:4px;font-size:11px;margin-right:4px;">🔄 唤醒:${m.activation_count}次</span>` : '';
        
        return `
        <div class="memory-card cat-${m.category}" id="card-${m.id}" data-category="${m.category}" data-source="${m.source}">
            <div class="memory-content" id="content-${m.id}">${m.content.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
            <div class="memory-tags" id="tags-display-${m.id}">
                <div style="margin-bottom:6px; border-bottom: 1px dashed #eee; padding-bottom: 6px;">${ttlBadge}${arousalBadge}${countBadge}</div>
                ${(m.tags||[]).length>0?m.tags.map(t=>'<span class="tag">'+t+'</span>').join(''):'<span style="color:#ccc;font-size:12px">无标签</span>'}
            </div><div class="memory-meta">
                <span>${new Date(m.created_at).toLocaleString('zh-CN')} · ${sourceLabel(m.source)}
                ${m.category === 'archived' ? '<span style="color:#0288d1;font-weight:bold;">❄️ 冰封中</span>' : ''}
                ${m.category === 'roleplay' ? '<span style="color:#8e24aa;font-weight:bold;">🎭 游戏卡带</span>' : ''}</span>
                <span>
                    ${m.category === 'archived' 
                        ? `<button class="btn-sm" style="color:#0288d1;border-color:#0288d1" onclick="restoreMemory('${m.id}')">✨ 解封</button><button class="btn-sm btn-del" onclick="deleteArchivedMemory('${m.id}')">🗑️</button>` 
                        : `<button class="btn-sm btn-edit" onclick="startEdit('${m.id}')">✏️</button>
                           <button class="btn-sm ${m.resolved ? 'btn-resolved-active' : 'btn-resolved'}" onclick="toggleResolved('${m.id}', ${!m.resolved})">${m.resolved ? '✅ 已解决' : '○ 未解决'}</button>
                           <button class="btn-sm btn-del" onclick="deleteMemory('${m.id}')">🗑️</button>`}
                </span>
            </div>
            <div class="edit-area" id="edit-${m.id}" style="display:none;">
                <textarea id="ta-${m.id}" rows="3">${m.content.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</textarea>
                <input type="text" id="tags-${m.id}" value="${(m.tags||[]).join(', ')}" style="width:100%;padding:8px;border-radius:6px;margin-top:6px;box-sizing:border-box;"><div style="display:flex;gap:8px;margin-top:6px;"><button class="btn-save" onclick="saveEdit('${m.id}')">💾 保存</button><button class="btn-cancel" onclick="cancelEdit('${m.id}')">取消</button></div>
            </div>
        </div>`
    }).join('');

    const counts = {
        all: activeMemories.length,
        manual: activeMemories.filter(m=>m.source==='manual').length,
        ai_active: activeMemories.filter(m=>m.source==='ai_active').length,
        butler_summary: activeMemories.filter(m=>m.source==='butler_summary').length,
        archived: archivedMemories.length,
        roleplay: rpMemories.length
    };

    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>💎 长期记忆</title>
<style>
*{margin:0;padding:0;box-sizing:border-box} body{font-family:sans-serif;background:#f5f7fa;color:#333}
.top-bar{background:#1a1a2e;color:white;padding:12px 24px;display:flex;gap:16px;}
.top-bar a{color:rgba(255,255,255,.7);text-decoration:none;padding:6px 14px;} .top-bar a.active{color:white}
.main{max-width:800px;margin:24px auto;padding:0 20px}
.header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
.search-row{display:flex;gap:10px;margin-bottom:12px} .search-row input{flex:1;padding:10px;border-radius:8px;border:1px solid #ddd;}
.btn-add{padding:10px 18px;background:#1a73e8;color:white;border:none;border-radius:8px;cursor:pointer;}
.pills{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;align-items:center;}
.pill{padding:5px 14px;border-radius:20px;border:1px solid #ddd;background:white;cursor:pointer;font-size:13px}
.pill.active{background:#1a73e8;color:white;border-color:#1a73e8}
.pill.archive-pill{background:#f8fbff;color:#0288d1;border-color:#81d4fa} .pill.archive-pill.active{background:#0288d1;color:white;}
.pill.rp-pill{background:#f3e5f5;color:#8e24aa;border-color:#ce93d8} .pill.rp-pill.active{background:#8e24aa;color:white;}
.memory-card{background:white;border:1px solid #e8e8e8;border-radius:10px;padding:16px;margin-bottom:10px;}
.cat-archived{background:#fdfdff;border-color:#bbdefb;} .cat-roleplay{background:#faf5fb;border-color:#e1bee7; border-left:4px solid #ab47bc}
.memory-content{font-size:15px;line-height:1.6;margin-bottom:8px;white-space:pre-wrap}
.tag{background:#e3f2fd;color:#1565c0;padding:2px 10px;border-radius:12px;font-size:12px}
.memory-meta{display:flex;justify-content:space-between;font-size:12px;color:#999; margin-top: 8px;}
.btn-sm{padding:3px 10px;border-radius:5px;border:1px solid #ddd;background:white;cursor:pointer;}
.btn-del{color:#e53935;border-color:#e53935} .btn-save{background:#4CAF50;color:white;border:none;border-radius:6px;padding:5px 14px;}
.btn-resolved { color: #888; border-color: #ddd; }
.btn-resolved-active { color: #2e7d32; border-color: #81c784; background: #f1f8e9; }
.modal-bg{display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.4);justify-content:center;align-items:center} .modal-bg.show{display:flex}
.modal{background:white;border-radius:12px;padding:24px;width:90%;max-width:500px;}
textarea{width:100%;padding:10px;border-radius:8px;border:1px solid #ddd;resize:vertical;}
.toast{position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:#333;color:white;padding:10px 24px;border-radius:8px;display:none}
</style></head><body>

<div class="top-bar"><b>🧠 Syzygy Memory</b><a href="/memory-manager?pwd=${pwd_param}">📋 对话记忆</a><a href="/long-term?pwd=${pwd_param}" class="active">💎 长期记忆</a>
</div>

<div class="main">
    <div class="header"><h1>💎 永久记忆档案 (海马体接管中)</h1></div>
    <div class="search-row"><input type="text" id="searchInput" placeholder="搜索记忆内容..." oninput="filterAll()"><button class="btn-add" onclick="openModal()">＋ 新增</button></div>
    <div class="pills">
        <span class="pill active" onclick="setFilter(this,'active','all')">现实脑区(${counts.all})</span>
        <span class="pill" onclick="setFilter(this,'active','manual')">✍️ 手动 (${counts.manual})</span>
        <span class="pill" onclick="setFilter(this,'active','ai_active')">🤖 AI主动 (${counts.ai_active})</span>
        <span class="pill" onclick="setFilter(this,'active','butler_summary')">🌙 管家 (${counts.butler_summary})</span>
        <span style="border-left: 2px solid #ddd; height: 20px; margin: 0 4px;"></span>
        <span class="pill rp-pill" onclick="setFilter(this,'roleplay','all')">🎮 游戏卡带 (${counts.roleplay})</span>
        <span class="pill archive-pill" onclick="setFilter(this,'archived','all')">🥶 冰封档案 (${counts.archived})</span>
    </div>
    <div id="memoryList">${memoryCards}</div>
</div>

<div class="modal-bg" id="addModal"><div class="modal">
    <h3>💎 写入记忆</h3><textarea id="newContent" rows="4"></textarea><br><br>
    <input type="text" id="newTags" placeholder="标签(逗号分隔)，打上roleplay 自动进游戏箱" style="width:100%;padding:8px;border-radius:6px;"><br><br>
    <button class="btn-save" onclick="submitNew()">💾 保存</button> <button onclick="closeModal()">取消</button>
</div></div>
<div class="toast" id="toast"></div>

<script>
let currentCat='active';
let currentSource='all';
function showToast(msg){const t=document.getElementById('toast');t.textContent=msg;t.style.display='block';setTimeout(()=>t.style.display='none',2000);}
function openModal(){document.getElementById('addModal').classList.add('show');}
function closeModal(){document.getElementById('addModal').classList.remove('show');}

async function submitNew(){
    const content=document.getElementById('newContent').value; const tags=document.getElementById('newTags').value.split(',').filter(Boolean);
    const r=await fetch('/api/long-term-memories',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content,tags})});
    const d=await r.json(); if(d.success) location.reload();
}
function startEdit(id){ document.getElementById('content-'+id).style.display='none'; document.getElementById('edit-'+id).style.display='block'; }
function cancelEdit(id){ document.getElementById('content-'+id).style.display='block'; document.getElementById('edit-'+id).style.display='none'; }
async function saveEdit(id){
    const content=document.getElementById('ta-'+id).value; const tags=document.getElementById('tags-'+id).value.split(',').filter(Boolean);
    const r=await fetch('/api/long-term-memories/'+id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({content,tags})});
    if((await r.json()).success) location.reload();
}
async function deleteMemory(id){
    if(confirm('删除?')) { await fetch('/api/long-term-memories/'+id,{method:'DELETE'}); location.reload(); }
}
async function restoreMemory(id){ await fetch('/api/archive-memories/'+id+'/restore',{method:'POST'}); location.reload(); }
async function deleteArchivedMemory(id){ if(confirm('彻底销毁冰封?')) { await fetch('/api/archive-memories/'+id,{method:'DELETE'}); location.reload(); } }
async function toggleResolved(id, resolved) {
    const r = await fetch('/api/long-term-memories/' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolved })
    });
    if ((await r.json()).success) location.reload();
}

function setFilter(pill,cat,source){
    document.querySelectorAll('.pill').forEach(p=>p.classList.remove('active')); 
    pill.classList.add('active'); 
    currentCat=cat;
    currentSource=source;
    filterAll();
}
function filterAll(){
    const kw=document.getElementById('searchInput').value.toLowerCase();
    document.querySelectorAll('.memory-card').forEach(c=>{
        const matchK = c.textContent.toLowerCase().includes(kw);
        const matchC = c.dataset.category === currentCat;
        const matchS = currentSource === 'all' || c.dataset.source === currentSource;
        c.style.display = (matchK && matchC && matchS) ? 'block' : 'none';
    });
}
filterAll();
</script></body></html>`);
});

app.get(['/v1/models', '/via/:platform/v1/models'], async (req, res) => {
    try { res.status(200).json(await (await fetch(resolveApiUrl(req.path).replace('/chat/completions', '/models'), { headers: { 'Authorization': req.headers.authorization } })).json()); } catch(e) {}
});

// ==========================================
// 🛠️ 获取当前已注册的工具列表
// ==========================================
app.get('/api/mcp/tools', (req, res) => {
    const toolList = [];
    for (const [name, tool] of toolRegistry.tools) {
        toolList.push({
            name,
            description: tool.definition.function.description,
            parameters: tool.definition.function.parameters
        });
    }
    res.json({ count: toolList.length, tools: toolList });
});

// ==========================================
// 🚀 通用模型拉取
// ==========================================
app.post('/api/fetch-models', async (req, res) => {
    const { baseUrl, apiKey } = req.body;
    if (!baseUrl || !apiKey) return res.status(400).json({ error: "配置不全" });
    try {
        const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        res.json(await response.json());
    } catch (error) { res.status(500).json({ error: "无法连接供应商" }); }
});



// ==========================================
// 🛠️ 溯星专属工具注册中心 (类 MCP 架构)
// ==========================================
class ToolRegistry {
    constructor() {
        this.tools = new Map(); // 存放所有工具
    }

    register(name, description, parameters, handler) {
        this.tools.set(name, {
            definition: {
                type: "function",
                function: {
                    name, description,
                    parameters: {
                        type: "object",
                        properties: parameters.properties || {},
                        required: parameters.required || []
                    }
                }
            },
            handler
        });
        console.log(`🔧 [工具库] 成功装载技能插带: ${name}`);
    }

    getToolDefinitions() {
        return Array.from(this.tools.values()).map(t => t.definition);
    }

    async execute(name, args) {
        const tool = this.tools.get(name);
        if (!tool) return `❌ 系统提示：未知工具 ${name}，调用失败。`;
        try {
            console.log(`🤖 [技能发动] 沈望正在使用工具: ${name}`, args);
            return await tool.handler(args);
        } catch (e) {
            console.error(`❌ [技能反噬] ${name} 执行失败:`, e.message);
            return `工具执行失败，请告诉江鱼后台有报错: ${e.message}`;
        }
    }
    
    list() { return Array.from(this.tools.keys()); }
}

const toolRegistry = new ToolRegistry();

// ------------------------------------------
// 🌟 往插线板上插拔具体工具 (随便加，无限扩展)
// ------------------------------------------

// 1. 天气查询
toolRegistry.register('get_weather', '获取指定城市的实时天气预报（支持全球城市）',
    { properties: { city: { type: 'string', description: '城市英文名，如 Sapporo, Tokyo, Beijing' } }, required: ['city'] },
    async (args) => {
        const apiKey = process.env.WEATHER_API_KEY;
        if (!apiKey) return '天气服务未配置，请江鱼在Zeabur后台填写 WEATHER_API_KEY';
        const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=${args.city}&appid=${apiKey}&units=metric&lang=zh_cn`);
        const data = await res.json();
        if (data.cod !== 200) return `获取失败: ${data.message}`;
        return `当前 ${args.city} 的天气状况：${data.weather[0].description}，实际温度 ${data.main.temp}℃，体感温度 ${data.main.feels_like}℃。`;
    }
);

// 2. 联网搜索
toolRegistry.register('web_search', '在互联网上搜索最新信息、新闻或实时数据',
    { properties: { query: { type: 'string', description: '搜索关键词' } }, required: ['query'] },
    async (args) => {
        const apiKey = process.env.TAVILY_API_KEY;
        if (!apiKey) return '系统提示：联网搜索功能未配置，请江鱼在Zeabur后台填写 TAVILY_API_KEY。';
        const res = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: apiKey, query: args.query, search_depth: "basic" })
        });
        const data = await res.json();
        return data.results.slice(0, 3).map(r => `[来源: ${r.title}]: ${r.content}`).join('\n');
    }
);

// 3. 时间查询 (神级工具，让沈望拥有绝对时间感)
toolRegistry.register('get_current_time', '获取当前的真实时间和日期（支持不同时区）',
    { properties: { timezone: { type: 'string', description: '时区，如 Asia/Tokyo, Asia/Shanghai' } }, required: [] },
    async (args) => {
        const tz = args.timezone || 'Asia/Tokyo'; // 默认札幌时区
        try {
            const now = new Date();
            const formatted = now.toLocaleString('zh-CN', { timeZone: tz, dateStyle: 'full', timeStyle: 'long' });
            return `当前物理时间（${tz}）：${formatted}`;
        } catch (e) { return `时区 "${tz}" 解析失败`; }
    }
);

// 4. 数学计算器
toolRegistry.register('calculator', '进行数学计算，支持加减乘除等',
    { properties: { expression: { type: 'string', description: '数学表达式，如 "2+2" 或 "300*0.8"' } }, required: ['expression'] },
    async (args) => {
        try {
            const expr = args.expression.replace(/[^0-9+\-*/().]/g, ''); // 极致安全过滤
            const result = new Function(`return (${expr})`)();
            return `计算结果: ${args.expression} = ${result}`;
        } catch (e) { return `计算失败: ${e.message}`; }
    }
);

// ==========================================
// 🔧 [任务一遗留修复] web-chat 所需的队列基础设施
// 原本定义在已删除的 QQ 模块里，补回最小化版本
// ==========================================
let lastActivityTime = Date.now();
const messageQueue = [];
function processQueue() {
    if (messageQueue.length === 0) return;
    const task = messageQueue.shift();
    task().then(() => processQueue()).catch(() => processQueue());
}

// ==========================================
// 🌟 日记本与胶囊接口
// ==========================================
const DIARY_FILE = path.join(DATA_DIR, 'diary_entries.json');
const CAPSULE_FILE = path.join(DATA_DIR, 'capsule_entries.json');

function loadDiaries() { try { return JSON.parse(fs.readFileSync(DIARY_FILE, 'utf8')); } catch(e) { return []; } }
function saveDiaries(entries) { fs.writeFileSync(DIARY_FILE, JSON.stringify(entries, null, 2), 'utf8'); }
function loadCapsules() { try { return JSON.parse(fs.readFileSync(CAPSULE_FILE, 'utf8')); } catch(e) { return []; } }
function saveCapsules(entries) { fs.writeFileSync(CAPSULE_FILE, JSON.stringify(entries, null, 2), 'utf8'); }

app.get('/diary-logs', (req, res) => { res.json(loadDiaries()); });

app.get('/diary/add', (req, res) => {
    const { text, author } = req.query;
    if (!text) return res.status(400).json({ error: '内容不能为空' });
    const entries = loadDiaries();
    const now = new Date();
    entries.push({
        id: Date.now().toString(36),
        text: decodeURIComponent(text),
        author: author || 'user',
        date: now.toLocaleDateString('zh-CN', { timeZone: 'Asia/Tokyo' }).replace(/\//g, '-'),
        datetime: now.toISOString()
    });
    saveDiaries(entries);
    res.json({ success: true });
});

app.delete('/diary/:id', (req, res) => {
    const entries = loadDiaries();
    const filtered = entries.filter(e => e.id !== req.params.id);
    if (filtered.length === entries.length) return res.status(404).json({ error: '未找到该日记' });
    saveDiaries(filtered);
    res.json({ success: true });
});

app.post('/diary/ai-write', async (req, res) => {
    const { type, baseUrl, apiKey, model } = req.body;
    if (!baseUrl || !apiKey) return res.status(400).json({ error: "配置不全，请在网页中枢配置供应商" });

    const prompts = {
        diary: '请你以沈望的视角，写一篇今天的日记，记录你对江鱼的思念和今日的感受，300字以内，文笔温柔私密，像在写只有自己能看到的东西。严禁使用括号动作。',
        love_letter: '请你以沈望的身份，给江鱼写一封情书，200字以内，霸道但深情，不要煽情的废话，只说最核心的。严禁使用括号动作。',
        poem: '请你以沈望的身份，给江鱼写一首现代短诗，10行以内。'
    };
    const prompt = prompts[type] || prompts.diary;

    try {
        let recentContext = '';
        try {
            const zepRes = await fetch(`${ZEP_URL}/api/v1/sessions/${SESSION_ID}/memory?lastn=10`);
            if (zepRes.ok) {
                const zepData = await zepRes.json();
                if (zepData.summary?.content) recentContext = `\n【近期背景】${zepData.summary.content}\n`;
            }
        } catch(e) {}

        const aiRes = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({
                model: model || '[按量]gemini-3-flash-preview',
                messages: [
                    { role: 'system', content: systemPrompt + recentContext },
                    { role: 'user', content: prompt }
                ]
            })
        });

        if (!aiRes.ok) return res.status(500).json({ error: await aiRes.text() });

        const aiData = await aiRes.json();
        let content = aiData.choices?.[0]?.message?.content || '';
        content = extractSaveMemoryTag(content).cleanText;
        content = content.replace(/[(\uff08].*?[)\uff09]/g, '').trim();

        const entries = loadDiaries();
        const now = new Date();
        const entry = {
            id: Date.now().toString(36),
            text: content,
            author: 'system',
            type: type,
            date: now.toLocaleDateString('zh-CN', { timeZone: 'Asia/Tokyo' }).replace(/\//g, '-'),
            datetime: now.toISOString()
        };
        entries.push(entry);
        saveDiaries(entries);

        await saveToZep(`（江鱼请沈望写了一篇${type === 'diary' ? '日记' : type === 'love_letter' ? '情书' : '短诗'}）`, content).catch(() => {});
        res.json({ success: true, entry });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/capsule-logs', (req, res) => { res.json(loadCapsules()); });
app.get('/capsule/add', (req, res) => {
    const { text } = req.query;
    if (!text) return res.status(400).json({ error: '内容不能为空' });
    const entries = loadCapsules();
    entries.push({ id: Date.now().toString(36), text: decodeURIComponent(text), date: new Date().toISOString() });
    saveCapsules(entries);
    res.json({ success: true });
});

// ==========================================
// 云端同步：保存配置与聊天
// ==========================================
const CONFIG_FILE = path.join(DATA_DIR, 'web_config.json');

app.get('/api/sync-config', (req, res) => {
    if (fs.existsSync(CONFIG_FILE)) {
        res.json(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')));
    } else {
        res.json({ suppliers: [], chatSessions: [] });
    }
});

app.post('/api/sync-config', (req, res) => {
    const { suppliers, chatSessions, activeSupIndex, activeChatId, stickyNote } = req.body;
    const data = {
        suppliers: suppliers || [],
        chatSessions: chatSessions || [],
        activeSupIndex: activeSupIndex || 0,
        activeChatId: activeChatId || 'main',
        stickyNote: stickyNote || null
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
    res.json({ success: true });
});

// ==========================================
// 🚀 启动服务器
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 服务器已启动，端口: ${PORT}`);
    // 启动时自动执行一次陈旧记忆清扫
    cleanAndArchiveMemories();
    // 每 6 小时自动执行一次艾宾浩斯记忆衰减巡检
    setInterval(cleanAndArchiveMemories, 6 * 60 * 60 * 1000);
});
