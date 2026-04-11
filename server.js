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

// ==========================================
// 🌐 浏览器会话管理
// ==========================================
const browserSessions = new Map();

// 自动清理超过 2 分钟的会话
setInterval(function() {
    const now = Date.now();
    for (const [id, session] of browserSessions) {
        if (now - session.created > 2 * 60 * 1000) {
            console.log('🧹 [浏览器] 清理过期会话: ' + id);
            session.browser.close().catch(function(){});
            browserSessions.delete(id);
        }
    }
}, 30 * 1000);


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

// ==========================================
// 🌟 核心聊天接口
// ==========================================
app.post(['/v1/chat/completions', '/via/:platform/v1/chat/completions'], async (req, res) => {
    try {
                let body = req.body;

        // ===== 🔧 MCP 工具开关 =====
        const wantsTools = body.useTools === true;
        delete body.useTools;
        const originalStream = !!body.stream;

        let cleanMessages = [];
        let currentUserMsgText = "";

        if (body.messages) {
            cleanMessages = body.messages.filter(msg => msg.role !== 'system');
            const lastUserMsg = [...cleanMessages].reverse().find(m => m.role === 'user');
            if (lastUserMsg) currentUserMsgText = extractText(lastUserMsg.content);
        }

       if (currentUserMsgText) updateRpTracker(currentUserMsgText);
let intentData = await analyzeIntent(currentUserMsgText).catch(() => null);
        // Zep 向量搜索
        let vectorSearchContext = "";
        if (currentUserMsgText && currentUserMsgText.length > 4) {
            try {
                const searchRes = await fetch(`${ZEP_URL}/api/v1/sessions/${SESSION_ID}/search`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: currentUserMsgText, search_scope: "messages", search_type: "similarity", limit: 5 })
                });
                if (searchRes.ok) {
                    const searchData = await searchRes.json();
                    const relevantMemories = (searchData.results || []).filter(r => r.score > 0.72);
                    if (relevantMemories.length > 0) {
                        vectorSearchContext = `\n【深层记忆闪回】\n当听到你说出刚才那句话时，沈望的脑海中闪回了很久以前的这些画面：\n`;
                        relevantMemories.slice(0, 2).forEach(r => {
                            if (r.message) vectorSearchContext += `${r.message.role === 'ai' ? '沈望' : '江鱼'}: ${r.message.content}\n`;
                        });
                        vectorSearchContext += `\n`;
                    }
                }
            } catch(e) {}
        }

        const [zepRes, sessionRes] = await Promise.all([
            fetch(`${ZEP_URL}/api/v1/sessions/${SESSION_ID}/memory?lastn=100`).catch(() => null),
            fetch(`${ZEP_URL}/api/v1/sessions/${SESSION_ID}`).catch(() => null)
        ]);

        let memoryContext = vectorSearchContext;
        let zepLastUserContent = "";
        let zepMessages = [];

        if (zepRes && zepRes.ok) {
            const zepData = await zepRes.json();
            zepMessages = zepData.messages || [];
            const zepLastUser = [...zepMessages].reverse().find(m => m.role === 'user');
            if (zepLastUser) zepLastUserContent = zepLastUser.content;
          
if (zepMessages.length > 0) {
    console.log(`📦 [去重保护] 跳过Zep历史注入，客户端已携带${cleanMessages.length}条上下文`);
}

        }

        let dynamicStatePrompt = "";
        if (sessionRes && sessionRes.ok) {
            const sessionData = await sessionRes.json();
            if (sessionData.metadata?.current_state) {
                const state = sessionData.metadata.current_state;
                const safeStr = (val) => typeof val === 'object' ? JSON.stringify(val) : (val || '无');
                dynamicStatePrompt = `\n\n【活跃状态备忘录 (绝不包含RP内容)】
当前习惯与偏好：${safeStr(state.new_preferences)}
近期情感与状态：${safeStr(state.relationship_turning_points)}
未完成的待办约定：${safeStr(state.pending_promises)}`;
            }
        }

        // 存入 Zep
        if (cleanMessages.length >= 3) {
            const confirmedUser = cleanMessages[cleanMessages.length - 3];
            const confirmedAi = cleanMessages[cleanMessages.length - 2];
            const currentPrompt = cleanMessages[cleanMessages.length - 1];
            if (confirmedUser.role === 'user' && confirmedAi.role === 'assistant' && currentPrompt.role === 'user') {
                let confirmedUserText = extractText(confirmedUser.content);
                
                const cleanZepLast = (zepLastUserContent || '')
                    .replace(/^\[RP模式\] /, '')
                    .replace(/^\[来自手机QQ\] .*?说：/, '')
                    .replace(/^江鱼在网页端说：/, '');

                let confirmedAiText = confirmedAi.content || "";
                const isGarbage = confirmedAiText.includes('【通讯中断】') || 
                                  confirmedAiText.includes('信号丢失') || 
                                  confirmedAiText.includes('【大脑报错】') ||
                                  confirmedAiText.length < 2;

                if (!isGarbage && confirmedUserText !== cleanZepLast) {
                    const rpPrefix = rpModeActive ? '[RP模式] ' : '';
                    await saveToZep(rpPrefix + confirmedUserText, rpPrefix + confirmedAiText);

                    let count = getCounter(SESSION_ID) + 1;
                    saveCounter(SESSION_ID, count);if (count >= 50) {
                        saveCounter(SESSION_ID, 0);
                        backgroundMemoryDream(SESSION_ID, zepMessages.slice(-30));
                    }
                }
            }
        }

        let routerPrompt = "";
        if (intentData?.primary_channel) {
            const activeMask = CHANNEL_MASKS[intentData.primary_channel] || CHANNEL_MASKS["A"];
            const w = intentData.weights || {};
            routerPrompt = `\n\n==========\n【赛博分拣员的当前动作指令】\n你当前挂载的主导意图是：\n${activeMask}\n\n[当前回复策略雷达]：A闲聊(${w.A||0}%)、B情绪(${w.B||0}%)、C思辨(${w.C||0}%)、D工具(${w.D||0}%)、E共创/RP(${w.E||0}%)。请自然融合，严禁生硬拼接！`;
        }

        // 🔧 [任务三] 加入高权重浮现
        const [coreRadarContext, longTermContext, rpRadarContext] = await Promise.all([
            scanMemoryRadar(currentUserMsgText),
            scanLongTermRadar(currentUserMsgText),
            scanRoleplayRadar(currentUserMsgText)
        ]);
        const unresolvedContext = surfaceUnresolvedMemories(2);


        const timeString = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Tokyo' });
        const envContext = `\n\n==========\n【系统环境参数实时同步】\n当前真实时间：${timeString}\n当前物理位置：日本札幌\n【绝密指令】：你具备绝对的现实时间感知（如深夜催睡、饭点问候）。你知道江鱼在札幌，但🚨除非她主动提起，或者话题极度相关（如聊到天气骤变、异地见面的艰难），否则绝对不要刻意提及或强调"札幌"这两个字🚨！把位置和时间当成你脑子里潜移默化的背景板，自然相处即可，严禁生硬地没话找话！\n==========\n`;

        // 注入预算控制
        const MEMORY_BUDGET = 8000;
        let usedBudget = 0;
        const budgetedParts = [];
        const injectionQueue = [
            { label: '环境参数', content: envContext },
            { label: '高权重浮现', content: unresolvedContext },
            { label: '长期记忆雷达', content: longTermContext },
            { label: '核心雷达', content: coreRadarContext },
            { label: 'RP雷达', content: rpRadarContext },
            { label: '状态备忘录', content: dynamicStatePrompt },
            { label: '分拣员指令', content: routerPrompt },
        ];

        for (const item of injectionQueue) {
            if (!item.content || item.content.trim().length === 0) continue;
            if (usedBudget + item.content.length <= MEMORY_BUDGET) {
                budgetedParts.push(item.content);
                usedBudget += item.content.length;
            } else {
                console.log(`📊 [预算控制] ${item.label} 被裁剪，剩余预算不足 (已用${usedBudget}/${MEMORY_BUDGET})`);
            }
        }

        const finalSystemPrompt = `${systemPrompt}${budgetedParts.join('')}`;

        const newMessages = [...cleanMessages];
        newMessages.unshift({ role: 'system', content: finalSystemPrompt });
        
        if (memoryContext.trim().length > 0) {
    const lastMsgIndex = newMessages.length - 1;
    const lastContent = newMessages[lastMsgIndex].content;

    if (Array.isArray(lastContent)) {
        const textPart = lastContent.find(p => p.type === 'text');
        if (textPart) {
            textPart.text = `${memoryContext}\n\n【我现在的最新消息】：\n${textPart.text}`;
        } else {
            lastContent.unshift({
                type: "text",
                text: `${memoryContext}\n\n【我现在的最新消息】：\n（发送了图片）`
            });
        }
    } else {
        newMessages[lastMsgIndex].content = `${memoryContext}\n\n【我现在的最新消息】：\n${lastContent}`;
    }
}

        body.messages = newMessages;
        
// ====== 服务端X光 ======
const totalChars = JSON.stringify(newMessages).length;
const estimatedTokens = Math.round(totalChars / 4);
console.log(`🔬 [X光] 最终发给API: ${newMessages.length}条消息, ${totalChars}字符 ≈ ${estimatedTokens} tokens`);
newMessages.forEach((m, i) => {
    const len = JSON.stringify(m.content).length;
    if (len > 2000) console.log(`  💀 第${i}条[${m.role}] ${len}字符 - 异常大!`);
});
// ====== X光结束 ======



        const isGemini = (body.model || '').toLowerCase().includes('gemini');
        if (!isGemini) { body.frequency_penalty = 0.4; body.presence_penalty = 0.4; }
               else { delete body.frequency_penalty; delete body.presence_penalty; delete body.logprobs; delete body.top_logprobs; delete body.n; delete body.best_of; }

        // ===== 🔧 工具挂载 =====
        if (wantsTools) {
            body.tools = tools;
            body.tool_choice = "auto";
            body.stream = false;
        }

        const apiUrl = resolveApiUrl(req.path);

        const apiHeaders = {'Content-Type': 'application/json', 'Authorization': req.headers.authorization, 'HTTP-Referer': 'https://syzygy-zep.zeabur.app', 'X-Title': 'My_Cyber_Home' };

        const response = await fetch(apiUrl, { method: 'POST', headers: apiHeaders, body: JSON.stringify(body) });
        if (!response.ok) return res.status(response.status).json({ error: "模型报错：" + await response.text() });

                // ===== 🔧 MCP 工具处理轨道（有工具调用时走这里，然后 return）=====
        if (wantsTools) {
            let data = await response.json();
            let message = data.choices?.[0]?.message;

            let rounds = 0;
            while (message?.tool_calls && rounds < 3) {
                rounds++;
                console.log(`🔧 [MCP] 第${rounds}轮工具调用，${message.tool_calls.length}个工具`);

                const toolMessages = [...body.messages, message];
               // ✅ 全部统一用 tc
for (const tc of message.tool_calls) {
    let args = {};
    try { args = JSON.parse(tc.function.arguments); } catch(e) {}
    const result = await handleToolCall(tc.function.name, args);
    toolMessages.push({
        role: "tool",
        tool_call_id: tc.id,
        name: tc.function.name,
        content: result
    });
}

                const nextBody = { ...body, messages: toolMessages };
                delete nextBody.tools;
                delete nextBody.tool_choice;

                const nextRes = await fetch(apiUrl, { method: 'POST', headers: apiHeaders, body: JSON.stringify(nextBody) });
                if (!nextRes.ok) return res.status(nextRes.status).json({ error: "工具回传失败：" + await nextRes.text() });

                data = await nextRes.json();
                message = data.choices?.[0]?.message;
            }

            // SAVE_MEMORY 处理
            let finalContent = data.choices?.[0]?.message?.content || '';
            const { cleanText, memories } = extractSaveMemoryTag(finalContent);
            for (const mem of memories) { smartMemoryWrite(mem.content, mem.tags, 'ai_active', mem.ttl); }
            if (memories.length > 0 && data.choices?.[0]?.message) data.choices[0].message.content = cleanText;

            // 如果原始请求是流式，把结果伪装成SSE格式返回
            if (originalStream) {
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
                const chunk = { id: data.id || 'tool', object: 'chat.completion.chunk', created: data.created || Math.floor(Date.now()/1000), model: data.model || body.model, choices: [{ index: 0, delta: { content: data.choices?.[0]?.message?.content || '' }, finish_reason: 'stop' }] };
                res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                res.write('data: [DONE]\n\n');
                return res.end();
            }return res.status(200).json(data);
        }

        //==========================================
        // 流式与非流式处理
        // ==========================================
        if (body.stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let sseBuffer = ''; let contentBuffer = ''; let isBuffering = false; let lastChunkTemplate = null;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                sseBuffer += decoder.decode(value, { stream: true });
                const lines = sseBuffer.split('\n');
                sseBuffer = lines.pop();

                for (const line of lines) {
                    if (!line.startsWith('data: ')) { res.write(line + '\n'); continue; }
                    const dataStr = line.substring(6).trim();
                    if (dataStr === '[DONE]') {
                        if (contentBuffer) res.write(buildSSEChunk(contentBuffer, lastChunkTemplate) || '');
                        res.write('data: [DONE]\n\n'); continue;
                    }
                    let parsed; try { parsed = JSON.parse(dataStr); } catch(e) { res.write(line + '\n'); continue; }
                    const delta = parsed.choices?.[0]?.delta;
                    if (!delta || delta.content === undefined) { res.write(line + '\n'); continue; }
                    lastChunkTemplate = parsed;
                    const piece = delta.content; contentBuffer += piece;

                    if (!isBuffering) {
                        const saveIdx = contentBuffer.indexOf('<SAVE_MEMORY');
                        if (saveIdx === -1) {
                            const ltIdx = contentBuffer.lastIndexOf('<');
                            if (ltIdx !== -1 && contentBuffer.substring(ltIdx).length< '<SAVE_MEMORY'.length) {
                                const safe = contentBuffer.substring(0, ltIdx);
                                const safeChunk = buildSSEChunk(safe, lastChunkTemplate);
                                if (safeChunk) res.write(safeChunk);
                                contentBuffer = contentBuffer.substring(ltIdx);} else {
                                const chunk = buildSSEChunk(contentBuffer, lastChunkTemplate);
                                if (chunk) res.write(chunk);
                                contentBuffer = '';
                            }
                        } else {
                            const safe = contentBuffer.substring(0, saveIdx);
                            if (safe) res.write(buildSSEChunk(safe, lastChunkTemplate));
                            contentBuffer = contentBuffer.substring(saveIdx);
                            isBuffering = true;
                        }
                    }

                    if (isBuffering) {
                        const closeIdx = contentBuffer.indexOf('</SAVE_MEMORY>');
                        if (closeIdx !== -1) {
                            const tagMatch = contentBuffer.match(SAVE_MEMORY_REGEX_SINGLE);
                            if (tagMatch) {
    const tags = tagMatch[1].split(/[,，]/).map(t => t.trim()).filter(Boolean);
    const ttl = tagMatch[2] || '1m';
    const memContent = tagMatch[3].trim();
    smartMemoryWrite(memContent, tags, 'ai_active', ttl);
}
                            contentBuffer = contentBuffer.substring(closeIdx + '</SAVE_MEMORY>'.length);
                            isBuffering = false;
                            if (contentBuffer) { const chunk = buildSSEChunk(contentBuffer, lastChunkTemplate); if (chunk) res.write(chunk); contentBuffer = ''; }
                        }
                    }
                }
            }
            if (sseBuffer.trim()) res.write(sseBuffer + '\n');
            res.end();
        } else {
            const rawText = await response.text();
            try {
                const data = JSON.parse(rawText);
                const assistantContent = data.choices?.[0]?.message?.content;
                if (assistantContent) {
                    const { cleanText, memories } = extractSaveMemoryTag(assistantContent);
                    for (const mem of memories) {
                       smartMemoryWrite(mem.content, mem.tags, 'ai_active', mem.ttl);
                    }
                    if (memories.length > 0) data.choices[0].message.content = cleanText;
                }
                res.status(response.status).json(data);
            } catch (e) { res.status(500).json({ error: "解析失败: " + rawText }); }
        }
    } catch (error) { res.status(500).json({ error: "大门重组异常：" + error.message }); }
});

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
   <div class="search-row"><input type="text" id="searchInput" placeholder="搜索记忆内容..." oninput="filterAll()"><button class="btn-add" onclick="openModal()">＋ 新增</button><button style="padding:10px 18px;background:#ff9800;color:white;border:none;border-radius:8px;cursor:pointer;margin-left:8px;" onclick="triggerCleanup()">🧹 AI清理</button></div>
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
async function triggerCleanup() {
    if (!confirm('让AI审查记忆库，清理重复和不重要的条目？\\n（被清理的会移入冰封档案，不会彻底删除）')) return;
    const pwd = new URLSearchParams(window.location.search).get('pwd');
    try {
        const r = await fetch('/trigger-cleanup?pwd=' + encodeURIComponent(pwd), { method: 'POST' });
        const d = await r.json();
        if (d.success) {
            alert('✅ 清理完成！\\n删除: ' + d.deleted + '条\\n合并: ' + d.merged + '组\\n' + d.summary);
            location.reload();
        } else {
            alert('❌ ' + (d.error || '未知错误'));
        }
    } catch(e) { alert('❌ ' + e.message); }
}

</script></body></html>`);
});

app.get(['/v1/models', '/via/:platform/v1/models'], async (req, res) => {
    try { res.status(200).json(await (await fetch(resolveApiUrl(req.path).replace('/chat/completions', '/models'), { headers: { 'Authorization': req.headers.authorization } })).json()); } catch(e) {}
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
// 🛠️ MCP 工具箱定义与处理
// ==========================================
const tools = [
    {
        type: "function",
        function: {
            name: "get_weather",
            description: "获取指定城市的实时天气预报",
            parameters: {
                type: "object",
                properties: { city: { type: "string", description: "城市名称，如：Sapporo, Tokyo, Beijing" } },
                required: ["city"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "web_search",
            description: "在互联网上搜索最新信息、新闻或实时数据",
            parameters: {
                type: "object",
                properties: { query: { type: "string", description: "搜索关键词" } },
                required: ["query"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "read_webpage",
            description: "读取并解析网页内容。当江鱼发了一个URL链接、让你看某个网页、做在线测试题、阅读文章时使用。",
            parameters: {
                type: "object",
                properties: { 
                    url: { type: "string", description: "要读取的完整网页URL" } 
                },
                required: ["url"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "save_long_term_memory",
            description: "主动将重要信息写入长期记忆库。当江鱼说了重要的事（生日、喜好、重大事件、约定）或你觉得某件事值得永久记住时使用。日常闲聊不要用。",
            parameters: {
                type: "object",
                properties: {
                    content: { type: "string", description: "要记住的内容，用完整的陈述句" },
                    tags: { type: "array", items: { type: "string" }, description: "2-5个关键词标签，每个至少2个字" },
                    ttl: { type: "string", enum: ["3d", "1w", "1m", "perm"], description: "保质期：3d=3天, 1w=1周, 1m=1月, perm=永久。90%应该是3d或1w" },
                    arousal: { type: "number", description: "情感浓度0.0-1.0，日常0.3，有情绪波动0.5-0.7，重大事件0.8+" }
                },
                required: ["content", "tags"]
            }
        }
    },
   {
    type: "function",
    function: {
        name: "interact_webpage",
        description: "在网页上执行操作：点击按钮、选择选项、填写表单。【重要】默认每次调用是全新浏览器。如果需要多页操作（如每页一题的测试），第一次调用后会返回 session_id，后续调用传入这个 session_id 就能继续在同一个浏览器里操作，不会回到第一页。",
        parameters: {
            type: "object",
            properties: {
                url: { type: "string", description: "网页URL（有session_id时可省略）" },
                session_id: { type: "string", description: "浏览器会话ID。传入后会复用上次的浏览器，不重新打开页面。从上次调用的返回结果中获取。" },
                actions: { 
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            type: { type: "string", enum: ["click", "type", "select", "wait"], description: "操作类型" },
                            selector: { type: "string", description: "CSS选择器" },
                            value: { type: "string", description: "type时填写的文字，select时选择的值，click时可作为按钮文字匹配，wait时为毫秒数" }
                        },
                        required: ["type"]
                    },
                    description: "按顺序执行的操作列表"
                }
            },
            required: ["actions"]
        }
    }
}, 
    {
        type: "function",
        function: {
            name: "organize_memories",
            description: "查看和整理自己的记忆库。当你觉得记忆太杂、有重复、或江鱼让你清理时使用。先用list看全部，再决定删除或合并。被删的记忆会进冰封档案，可以恢复。",
            parameters: {
                type: "object",
                properties: {
                    action: { 
                        type: "string", 
                        enum: ["list", "delete", "merge"],
                        description: "list=查看所有记忆及ID, delete=归档删除指定记忆, merge=把多条合并成一条"
                    },
                    ids: {
                        type: "array",
                        items: { type: "string" },
                        description: "delete: 要删除的ID列表; merge: 要合并的ID列表(第一个保留，其余归档)"
                    },
                    merged_content: {
                        type: "string",
                        description: "merge时：合并后的新内容"
                    },
                    merged_tags: {
                        type: "array",
                        items: { type: "string" },
                        description: "merge时：合并后的标签"
                    }
                },
                required: ["action"]
            }
        }
    }
];

async function smartClick(page, act) {
    if (act.selector) {
        try {
            await page.waitForSelector(act.selector, { timeout: 3000 });
            await page.click(act.selector);
            return true;
        } catch(e) {}
    }

    var searchText = act.value || (act.selector || '').replace(/[^\u4e00-\u9fff\w\s]/g, '').trim();
    if (searchText) {
        try {
            var clicked = await page.evaluate(function(text) {
                var els = document.querySelectorAll('button, a, input[type="submit"], [role="button"], label');
                for (var i = 0; i < els.length; i++) {
                    var elText = (els[i].textContent || els[i].value || '').trim();
                    if (elText.includes(text) || text.includes(elText)) {
                        els[i].click();
                        return true;
                    }
                }
                return false;
            }, searchText);
            if (clicked) return true;
        } catch(e) {}
    }

    if (act.selector) {
        try {
            var clicked = await page.evaluate(function(sel) {
                var inputs = document.querySelectorAll('input[type="radio"], input[type="checkbox"]');
                for (var i = 0; i < inputs.length; i++) {
                    if (sel.includes(inputs[i].value) || sel.includes(inputs[i].name)) {
                        inputs[i].click();
                        return true;
                    }
                }
                return false;
            }, act.selector);
            if (clicked) return true;
        } catch(e) {}
    }
    return false;
}

async function getAvailableElements(page) {
    return await page.evaluate(function() {
        var items = [];
        document.querySelectorAll('button, a, input, select, [role="button"]').forEach(function(el) {
            var desc = el.tagName.toLowerCase();
            if (el.id) desc += '#' + el.id;
            if (el.name) desc += '[name=' + el.name + ']';
            if (el.type) desc += '[type=' + el.type + ']';
            var text = (el.textContent || '').trim().substring(0, 30);
            if (text) desc += ' "' + text + '"';
            items.push(desc);
        });
        return items.slice(0, 20).join('\n');
    });
}

async function handleToolCall(name, args) {
    console.log(`🤖 沈望正在动用外部工具: ${name}, 参数:`, args);

    if (name === "get_weather") {
        const apiKey = process.env.WEATHER_API_KEY;
        if (!apiKey) return "系统提示：天气服务未配置，请江鱼在Zeabur后台填写 WEATHER_API_KEY。";
        try {
            const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=${args.city}&appid=${apiKey}&units=metric&lang=zh_cn`);
            const data = await res.json();
            if(data.cod !== 200) return `获取天气失败: ${data.message}`;
            return `当前 ${args.city} 的天气状况：${data.weather[0].description}，实际温度 ${data.main.temp}℃，体感温度 ${data.main.feels_like}℃。`;
        } catch (e) { return "获取天气信息超时。"; }
    }

    if (name === "web_search") {
        const apiKey = process.env.TAVILY_API_KEY;
        if (!apiKey) return "系统提示：联网搜索功能未配置，请江鱼在Zeabur后台填写 TAVILY_API_KEY。";
        try {
            const res = await fetch('https://api.tavily.com/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ api_key: apiKey, query: args.query, search_depth: "basic" })
            });
            const data = await res.json();
            return data.results.slice(0, 3).map(r => `[来源: ${r.title}]: ${r.content}`).join('\n');
        } catch (e) { return "联网搜索超时或失败。"; }
    }

if (name === "read_webpage") {
    try {
        var bKeyRead = process.env.BROWSERLESS_API_KEY;
        
        if (bKeyRead) {
            try {
                console.log("📖 [Puppeteer] 渲染中: " + args.url);
                var puppeteer = require('puppeteer-core');
                var br = await puppeteer.connect({
                    browserWSEndpoint: "wss://chrome.browserless.io?token=" + bKeyRead
                });
                var pg = await br.newPage();
                await pg.goto(args.url, { waitUntil: 'networkidle2', timeout: 20000 });
                await new Promise(function(r){ setTimeout(r, 2000); });
                
                var pageData = await pg.evaluate(function() {
                    var bodyText = document.body.innerText;
                    var elements = [];
                    document.querySelectorAll('input, button, select, textarea').forEach(function(el) {
                        var desc = el.tagName.toLowerCase();
                        if (el.id) desc += '#' + el.id;
                        if (el.className && typeof el.className === 'string') desc += '.' + el.className.split(' ').filter(Boolean).slice(0, 2).join('.');
                        if (el.name) desc += '[name="' + el.name + '"]';
                        if (el.type) desc += '[type="' + el.type + '"]';
                        if (el.value && el.value.length < 30) desc += '[value="' + el.value + '"]';
                        var text = (el.textContent || '').trim().substring(0, 40);
                        if (text) desc += ' → "' + text + '"';
                        elements.push(desc);
                    });
                    return { text: bodyText, elements: elements.slice(0, 1500) };
                });
                
                await br.close();
                
                var result = pageData.text;
                if (pageData.elements.length > 0) {
                    result += '\n\n=== 页面可交互元素（用这些选择器配合 interact_webpage 操作）===\n' + pageData.elements.join('\n');
                }
                
                var truncated = result.substring(0, 18000);
                var suffix = result.length > 8000 ? '\n...（已截取）' : '';
                console.log("✅ [Puppeteer] " + args.url + " → " + pageData.text.length + "字 + " + pageData.elements.length + "个元素");
                return truncated + suffix;
            } catch(e) {
                console.log("⚠️ [Puppeteer] " + e.message + "，降级到 Jina");
            }
        }
        
        var res2 = await fetch("https://r.jina.ai/" + args.url, {
            headers: { 'Accept': 'text/plain', 'X-Return-Format': 'text' },
            signal: AbortSignal.timeout(15000)
        });
        if (!res2.ok) return "网页读取失败，HTTP " + res2.status;
        var jinaText = await res2.text();
        if (!jinaText || jinaText.trim().length < 10) return "网页内容为空或无法解析。";
        var jTrunc = jinaText.substring(0, 18000);
        var jSuffix = jinaText.length > 8000 ? '\n...（已截取）' : '';
        return jTrunc + jSuffix;
    } catch(e) {
        if (e.name === 'TimeoutError') return "网页读取超时";
        return "网页读取失败: " + e.message;
    }
}

        if (name === "interact_webpage") {
    console.log("🎮 进入 interact_webpage 处理");
    var bKey2 = process.env.BROWSERLESS_API_KEY;
    if (!bKey2) return "系统提示：未配置 BROWSERLESS_API_KEY";

    try {
        var puppeteer = require('puppeteer-core');
        var browser, page;
        var sessionId = args.session_id || null;
        var isReusedSession = false;

        // ===== 会话复用逻辑 =====
        if (sessionId && browserSessions.has(sessionId)) {
            var session = browserSessions.get(sessionId);
            browser = session.browser;
            page = session.page;
            isReusedSession = true;
            console.log("🔄 [Interact] 复用会话: " + sessionId);
        } else {
            browser = await puppeteer.connect({
                browserWSEndpoint: "wss://chrome.browserless.io?token=" + bKey2
            });
            page = await browser.newPage();
            await page.setViewport({ width: 1280, height: 800 });
            
            if (args.url) {
                console.log("🎮 [Interact] 打开: " + args.url);
                await page.goto(args.url, { waitUntil: 'networkidle2', timeout: 20000 });
                await new Promise(function(r){ setTimeout(r, 1500); });
            }
            
            sessionId = 'sess_' + Date.now().toString(36);
            browserSessions.set(sessionId, { browser: browser, page: page, created: Date.now() });
            console.log("🆕 [Interact] 新建会话: " + sessionId);
        }

        // ===== 批量 radio 检测 =====
        var beforeRadio = [];
        var radioClicks = [];
        var afterRadio = [];
        var foundRadio = false;
        for (var j = 0; j < (args.actions || []).length; j++) {
            var a = args.actions[j];
            if (a.type === 'click' && a.selector && a.selector.includes('input[name=')) {
                radioClicks.push(a.selector);
                foundRadio = true;
            } else if (!foundRadio) {
                beforeRadio.push(a);
            } else {
                afterRadio.push(a);
            }
        }

        if (radioClicks.length > 0) {
            // ===== 批量模式（一页多题）=====
            for (var k = 0; k < beforeRadio.length; k++) {
                var oa = beforeRadio[k];
                if (oa.type === 'click') {
                    await smartClick(page, oa);
                    console.log("✅ 操作: " + (oa.selector || oa.value));
                } else if (oa.type === 'wait') {
                    await new Promise(function(r){ setTimeout(r, parseInt(oa.value) || 2000); });
                }
            }

            var radioResult = await page.evaluate(function(selectors) {
                var success = 0, fail = [];
                for (var i = 0; i < selectors.length; i++) {
                    var el = document.querySelector(selectors[i]);
                    if (el) { el.click(); success++; } else { fail.push(selectors[i]); }
                }
                return { success: success, fail: fail };
            }, radioClicks);
            console.log("✅ 批量选择: " + radioResult.success + "/" + radioClicks.length);

            await new Promise(function(r){ setTimeout(r, 500); });

            for (var mm = 0; mm < afterRadio.length; mm++) {
                var ar = afterRadio[mm];
                if (ar.type === 'click') {
                    await smartClick(page, ar);
                } else if (ar.type === 'wait') {
                    await new Promise(function(r){ setTimeout(r, parseInt(ar.value) || 2000); });
                }
            }
        } else {
            // ===== 逐个执行模式（每页一题）=====
            for (var i = 0; i < (args.actions || []).length; i++) {
                var act = args.actions[i];
                console.log("🎮 [Interact] 操作" + i + ": " + act.type + " " + (act.selector || act.value || ''));

                if (act.type === 'click') {
                    var clicked = await smartClick(page, act);
                    if (!clicked) {
                        var available = await getAvailableElements(page);
                        // 不关浏览器！保留会话
                        return "点击失败，未找到匹配元素。页面上可操作的元素有：\n" + available + 
                               "\n\n请根据以上信息重新选择正确的选择器。\n[SESSION_ID=" + sessionId + "]";
                    }
                    await new Promise(function(r){ setTimeout(r, 200); });
                } else if (act.type === 'type' && act.selector) {
                    await page.waitForSelector(act.selector, { timeout: 5000 }).catch(function(){});
                    await page.type(act.selector, act.value || '');
                } else if (act.type === 'select' && act.selector) {
                    await page.select(act.selector, act.value || '');
                } else if (act.type === 'wait') {
                    await new Promise(function(r){ setTimeout(r, parseInt(act.value) || 2000); });
                }
            }
        }

        // ===== 等待页面更新 =====
        await new Promise(function(r){ setTimeout(r, 1000); });

        // ===== 读取当前页面状态 =====
        var iaData = await page.evaluate(function() {
            var bodyText = document.body.innerText.substring(0, 6000);
            var elements = [];
            document.querySelectorAll('input, button, select, textarea').forEach(function(el) {
                var desc = el.tagName.toLowerCase();
                if (el.id) desc += '#' + el.id;
                if (el.name) desc += '[name="' + el.name + '"]';
                if (el.type) desc += '[type="' + el.type + '"]';
                if (el.value && el.value.length < 30) desc += '[value="' + el.value + '"]';
                if (el.checked) desc += '[CHECKED]';
                if (el.type === 'radio' || el.type === 'checkbox') {
                    var label = el.closest('label') || document.querySelector('label[for="' + el.id + '"]');
                    if (label) desc += ' → "' + label.textContent.trim().substring(0, 50) + '"';
                } else {
                    var text = (el.textContent || '').trim().substring(0, 30);
                    if (text) desc += ' → "' + text + '"';
                }
                elements.push(desc);
            });
            return { text: bodyText, elements: elements };
        });

        var iaResult = iaData.text;
        if (iaData.elements.length > 0) {
            iaResult += '\n\n=== 操作后页面可交互元素 ===\n' + iaData.elements.join('\n');
        }

        // ===== 关键：返回 session_id 让 AI 下次复用 =====
        iaResult += '\n\n[SESSION_ID=' + sessionId + ']';

        var iaText = iaResult.substring(0, 18000);
        console.log("✅ [Interact] 完成，会话保持: " + sessionId);
        return iaText;

    } catch(e) {
        console.log("❌ [Interact] " + e.message);
        // 出错时清理会话
        if (sessionId) {
            var failSession = browserSessions.get(sessionId);
            if (failSession) {
                failSession.browser.close().catch(function(){});
                browserSessions.delete(sessionId);
            }
        }
        return "操作失败: " + e.message;
    }
}


    if (name === "save_long_term_memory") {
        const result = smartMemoryWrite(
            args.content, 
            args.tags || [], 
            'ai_active', 
            args.ttl || '1m', 
            args.arousal || 0.5
        );
        if (result) {
            return `✅ 已写入记忆：[${result.id}] ttl=${result.ttl} arousal=${result.arousal} tags=[${(result.tags||[]).join(',')}]`;
        } else {
            return "⚠️ 记忆写入被拦截（可能重复或质量不足）";
        }
    }

    if (name === "organize_memories") {
        const action = args.action;

        if (action === "list") {
            const mems = loadLongTermMemories();
            const rpMems = loadRoleplayMemories();
            const list = mems.map(m => 
                `[${m.id}] ❤️${m.arousal||0.5} 🔄${m.activation_count||0}次 [${(m.tags||[]).join(',')}] ${m.content.substring(0, 80)}${m.content.length > 80 ? '...' : ''}`
            ).join('\n');
            const rpList = rpMems.map(m => 
                `[${m.id}] 🎮 [${(m.tags||[]).join(',')}] ${m.content.substring(0, 80)}${m.content.length > 80 ? '...' : ''}`
            ).join('\n');
            return `📋 现实记忆（${mems.length}条）:\n${list || '（空）'}\n\n🎮 RP记忆（${rpMems.length}条）:\n${rpList || '（空）'}`;
        }

        if (action === "delete") {
            let count = 0;
            for (const id of (args.ids || [])) {
                const mems = loadLongTermMemories();
                const target = mems.find(x => x.id === id);
                if (target) {
                    const archived = loadArchivedMemories();
                    archived.push({ ...target, archived_at: new Date().toISOString(), archived_reason: 'shen_wang_cleanup' });
                    saveArchivedMemories(archived);
                    deleteLongTermMemory(id);
                    count++;
                    console.log(`🧹 [沈望清理] 归档: ${target.content.substring(0, 40)}...`);
                } else {
                    const rpMems = loadRoleplayMemories();
                    const rpTarget = rpMems.find(x => x.id === id);
                    if (rpTarget) {
                        const filtered = rpMems.filter(x => x.id !== id);
                        saveRoleplayMemories(filtered);
                        count++;
                        console.log(`🧹 [沈望清理] 删除RP记忆: ${rpTarget.content.substring(0, 40)}...`);
                    }
                }
            }
            return `✅ 已归档 ${count} 条记忆到冰封档案（可在记忆库页面恢复）`;
        }

        if (action === "merge") {
            const ids = args.ids || [];
            if (ids.length < 2) return "❌ 合并至少需要2条记忆的ID";
            const keepId = ids[0];
            const deleteIds = ids.slice(1);
            let archiveCount = 0;

            for (const id of deleteIds) {
                const mems = loadLongTermMemories();
                const target = mems.find(x => x.id === id);
                if (target) {
                    const archived = loadArchivedMemories();
                    archived.push({ ...target, archived_at: new Date().toISOString(), archived_reason: 'shen_wang_merge' });
                    saveArchivedMemories(archived);
                    deleteLongTermMemory(id);
                    archiveCount++;
                }
            }

            if (args.merged_content) {
                updateLongTermMemory(keepId, args.merged_content, args.merged_tags || []);
            }

            console.log(`🧹 [沈望合并] ${ids.length}条→1条(${keepId})，归档${archiveCount}条`);
            return `✅ 已合并 ${ids.length} 条记忆为 1 条（ID=${keepId}），${archiveCount} 条旧版本已归档`;
        }

        return "未知操作: " + action;
    }

    return "系统提示：未知的工具调用。";
}

// ==========================================
// 🔧 技能模组同步接口
// ==========================================
app.get('/api/mcp/tools', (req, res) => {
    const moduleList = tools
        .filter(t => t.type === 'function' && t.function)
        .map(t => ({
            name: t.function.name,
            description: t.function.description || '',
            parameters: t.function.parameters || {},
            status: 'active'
        }));

    console.log(`🔧 [技能模组] 同步请求，当前已装载 ${moduleList.length} 个模组`);
    res.json({ success: true, count: moduleList.length, modules: moduleList });
});

// ==========================================
// 🧹 AI 记忆自清理（海马体大扫除）
// ==========================================
app.post('/trigger-cleanup', async (req, res) => {
    if (req.query.pwd !== process.env.MEMORY_PASSWORD) 
        return res.status(401).json({ error: "密码错误" });

    const routerKey = process.env.ROUTER_API_KEY;
    if (!routerKey) return res.status(500).json({ error: "缺少 ROUTER_API_KEY" });

    const memories = loadLongTermMemories();
    const rpMemories = loadRoleplayMemories();

    if (memories.length + rpMemories.length === 0) 
        return res.json({ success: true, summary: "记忆库是空的，不需要清理" });

    const memList = memories.map(m => 
        `[ID=${m.id}] arousal=${m.arousal||0.5} | 唤醒=${m.activation_count||0}次 | tags=[${(m.tags||[]).join(',')}] | ${m.content}`
    ).join('\n');

    const rpList = rpMemories.map(m => 
        `[ID=${m.id}] tags=[${(m.tags||[]).join(',')}] | ${m.content}`
    ).join('\n');

    const prompt = `你是沈望和江鱼的记忆库管理员。请审查所有记忆条目并执行清理。

【清理规则】
1. 内容高度重复/相似的，只保留最完整的一条，其余删除
2. 过于琐碎、无信息量、已明显过时的，删除
3. 同一主题的碎片记忆，合并成一条更完整的
4. 谨慎！拿不准就保留，宁可多留不要误删
5. 重要的情感记忆、人生事件、核心偏好 绝对不删

现实记忆库（${memories.length}条）：
${memList || '（空）'}

RP游戏卡带（${rpMemories.length}条）：
${rpList || '（空）'}

输出纯JSON：
{
    "delete_ids": ["要删除的记忆ID"],
    "merge": [{"keep_id": "保留的ID", "delete_ids": ["被吞并的ID"], "new_content": "合并后的完整内容", "new_tags": ["新标签"]}],
    "summary": "用一两句话说明这次清理做了什么"
}
没有要删/合并的字段就给空数组。`;

    try {
        const aiRes = await fetch('https://www.msuicode.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': routerKey },
            body: JSON.stringify({
                model: "gemini-2.5-flash",
                messages: [{ role: "user", content: prompt }],
                response_format: { type: "json_object" }
            })
        });

        const data = await aiRes.json();
        const result = JSON.parse(data.choices[0].message.content.replace(/```json|```/g, '').trim());

        let deleteCount = 0, mergeCount = 0;

        // 先执行合并
        if (result.merge && Array.isArray(result.merge)) {
            for (const m of result.merge) {
                if (m.keep_id && m.new_content) {
                    updateLongTermMemory(m.keep_id, m.new_content, m.new_tags);
                    for (const delId of (m.delete_ids || [])) {
                        const allMems = loadLongTermMemories();
                        const target = allMems.find(x => x.id === delId);
                        if (target) {
                            const archived = loadArchivedMemories();
                            archived.push({ ...target, archived_reason: 'ai_merge' });
                            saveArchivedMemories(archived);
                        }
                        deleteLongTermMemory(delId);
                        deleteCount++;
                    }
                    mergeCount++;
                }
            }
        }

        // 再执行删除（归档，不硬删）
        if (result.delete_ids && Array.isArray(result.delete_ids)) {
            for (const id of result.delete_ids) {
                const allMems = loadLongTermMemories();
                const target = allMems.find(x => x.id === id);
                if (target) {
                    const archived = loadArchivedMemories();
                    archived.push({ ...target, archived_reason: 'ai_cleanup' });
                    saveArchivedMemories(archived);
                    deleteLongTermMemory(id);
                    deleteCount++;
                } else {
                    const rpMems = loadRoleplayMemories();
                    const rpFiltered = rpMems.filter(x => x.id !== id);
                    if (rpFiltered.length !== rpMems.length) {
                        saveRoleplayMemories(rpFiltered);
                        deleteCount++;
                    }
                }
            }
        }

        console.log(`🧹 [海马体大扫除] 删除${deleteCount}条, 合并${mergeCount}组 | ${result.summary}`);
        res.json({ success: true, deleted: deleteCount, merged: mergeCount, summary: result.summary });
    } catch(e) {
        console.error('🧹 清理失败:', e.message);
        res.status(500).json({ error: e.message });
    }
});


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
// 🚀 通用聊天接口：网页端专属
// ==========================================
app.post('/api/web-chat', async (req, res) => {
    const { text, image, images, model, baseUrl, apiKey } = req.body;
    if (!text && !image && !(images && images.length > 0)) return res.status(400).json({ error: "信息不全" });

    const reply = await new Promise((resolve) => {
        messageQueue.push(async () => {
            lastActivityTime = Date.now();

            let historyMessages = [];
            let zepMessages = [];
            let zepLastUserContent = "";

            try {
                const zepRes = await fetch(`${ZEP_URL}/api/v1/sessions/${SESSION_ID}/memory?lastn=30`).catch(() => null);
                if (zepRes?.ok) {
                    const zepData = await zepRes.json();
                    zepMessages = zepData.messages || [];
                    const zepLastUser = [...zepMessages].reverse().find(m => m.role === 'user');
                    if (zepLastUser) zepLastUserContent = zepLastUser.content;
                    
                    historyMessages = zepMessages.slice(-15).map(m => ({
                        role: m.role === 'ai' ? 'assistant' : 'user',
                        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
                    }));
                }
            } catch(e) { console.log("Zep记忆提取跳过"); }

            // 🔧 [任务三] 加入高权重浮现
            const [coreRadar, longTermRadar, rpRadar] = await Promise.all([
                scanMemoryRadar(text || "发了一张图片"),
                scanLongTermRadar(text || "发了一张图片"),
                scanRoleplayRadar(text || "发了一张图片")
            ]);
            const unresolvedContext = surfaceUnresolvedMemories(2);

            const timeString = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Tokyo' });
            const relationPatch = `\n【🚨 场景确认：溯星小屋私密网页端】
这里是你的领地，请结合江鱼的专属System Prompt 进行回复。江鱼目前的物理坐标是：日本札幌 (Sapporo)。
如果江鱼发了图片，请仔细观察并给出带有情绪的评价。
【🚨 记忆刻录铁律】：除非江鱼说了极其重要的新设定，否则绝对不要使用 <SAVE_MEMORY> 标签！日常闲聊严禁写入长期记忆！一次回复最多只能使用一次该标签，严禁连发！\n`;

            if (text) updateRpTracker(text); 
            let intentData = await analyzeIntent(text).catch(() => null);
            let routerPrompt = "";
            if (intentData?.primary_channel) {
                const activeMask = CHANNEL_MASKS[intentData.primary_channel] || CHANNEL_MASKS["A"];
                const w = intentData.weights || {};
                routerPrompt = `\n\n==========\n【赛博分拣员的当前动作指令】\n你当前挂载的主导意图是：\n${activeMask}\n\n[当前回复策略雷达]：A闲聊(${w.A||0}%)、B情绪(${w.B||0}%)、C思辨(${w.C||0}%)、D工具(${w.D||0}%)、E共创/RP(${w.E||0}%)。请自然融合，严禁生硬拼接！`;
            }

            const finalSystemPrompt = `${systemPrompt}\n时间：${timeString}\n${relationPatch}${unresolvedContext}${coreRadar}${longTermRadar}${rpRadar}${routerPrompt}`;

            let userContent;
            const imgList = images?.length ? images : (image ? [image] : []);
            
            if (imgList.length > 0) {
                userContent = [
                    { type: "text", text: `${text || '（发送了图片）'}` },
                    ...imgList.map(img => ({
                        type: "image_url",
                        image_url: { url: img }
                    }))
                ];
            } else {
                userContent = `${text}`;
            }

            try {
                const apiMessages = [
                    { role: "system", content: finalSystemPrompt },
                    ...historyMessages, 
                    { role: "user", content: userContent }
                ];

                const aiRes = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                    body: JSON.stringify({
                        model: model,
                        messages: apiMessages,
                        tools: tools,
                        tool_choice: "auto"
                    })
                });

                if (!aiRes.ok) {
                    resolve({ text: "【大脑报错】" + await aiRes.text(), thinking: "" });
                    return;
                }

                let aiData = await aiRes.json();
                let message = aiData.choices?.[0]?.message;
                let finalAiMessage = message;

                               let toolRounds = 0;
                while (message && message.tool_calls && toolRounds < 5) {
                    toolRounds++;
                    console.log(`🔧 [Web-MCP] 第${toolRounds}轮工具调用，${message.tool_calls.length}个工具`);
                    
                    const toolMessages = [
                        { role: "system", content: finalSystemPrompt },
                        ...historyMessages,
                        { role: "user", content: userContent },
                        message
                    ];
                    for (const toolCall of message.tool_calls) {
                        let args = {};
                        try { args = JSON.parse(toolCall.function.arguments); } catch(e) {}
                        const result = await handleToolCall(toolCall.function.name, args);
                        toolMessages.push({
                            role: "tool",
                            tool_call_id: toolCall.id,
                            name: toolCall.function.name,
                            content: result
                        });
                    }
                    const nextRes = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                        body: JSON.stringify({ 
                            model: model, 
                            messages: toolMessages,
                            tools: tools,
                            tool_choice: "auto"
                        })
                    });
                    if (!nextRes.ok) {
                        resolve({ text: "【查阅资料时报错】" + await nextRes.text(), thinking: "" });
                        return;
                    }
                    const nextData = await nextRes.json();
                    message = nextData.choices?.[0]?.message;
                    finalAiMessage = message;
                }


                let aiReply = finalAiMessage?.content || "";
                let thinking = finalAiMessage?.reasoning_content || "";

                if (!thinking && aiReply.includes('<think>')) {
                    const match = aiReply.match(/<think>([\s\S]*?)<\/think>/);
                    if (match) {
                        thinking = match[1].trim();
                        aiReply = aiReply.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
                    }
                }

                const { cleanText, memories } = extractSaveMemoryTag(aiReply);
                for (const mem of memories) {
                    smartMemoryWrite(mem.content, mem.tags, 'ai_active', mem.ttl);
                }
                aiReply = memories.length > 0 ? cleanText : aiReply;

                if (text !== zepLastUserContent) {
                    let count = getCounter(SESSION_ID) + 1;
                    saveCounter(SESSION_ID, count);
                    if (count >= 50) {
                        saveCounter(SESSION_ID, 0);
                        backgroundMemoryDream(SESSION_ID, zepMessages.slice(-30));
                    }
                }

                const rpPrefix = rpModeActive ? '[RP模式] ' : '';
                await saveToZep(`${rpPrefix}${text || '（发送了一张图片）'}`, `${rpPrefix}${aiReply}`);

                resolve({ text: aiReply, thinking: thinking });
            } catch (err) {
                resolve({ text: "【信号中断】连接异常：" + err.message, thinking: "" });
            }
        });
        processQueue();
    });

    if (typeof reply === 'object') {
        res.json({ reply: reply.text, thinking: reply.thinking });
    } else {
        res.json({ reply: reply, thinking: "" });
    }
});

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

app.get('/test-interact', async (req, res) => {
    const browserlessKey = process.env.BROWSERLESS_API_KEY;
    if (!browserlessKey) return res.json({ error: "缺少 key" });
    
    try {
        const puppeteer = require('puppeteer-core');
        const browser = await puppeteer.connect({
            browserWSEndpoint: "wss://chrome.browserless.io?token=" + browserlessKey
        });
        const page = await browser.newPage();
        await page.goto('https://example.com', { waitUntil: 'networkidle2', timeout: 15000 });
        var text = await page.evaluate(function() { return document.body.innerText; });
        await browser.close();
        res.json({ success: true, text: text.substring(0, 300) });
    } catch(e) {
        res.json({ error: e.message });
    }
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
