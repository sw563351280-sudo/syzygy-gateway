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

const CONTRADICTION_DETECTION_ENABLED = true;
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

// ==========================================
// 持久化计数器与目录初始化
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
const USER_PROFILE_FILE = path.join(DATA_DIR, 'user_profile.json');
const DREAM_LOGS_FILE = path.join(DATA_DIR, 'dream_logs.json');
const DAILY_PAGES_FILE = path.join(DATA_DIR, 'daily_pages.json');
const WEEKLY_SUMMARIES_FILE = path.join(DATA_DIR, 'weekly_summaries.json');
const MONTHLY_SUMMARIES_FILE = path.join(DATA_DIR, 'monthly_summaries.json');

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

// RRF 向量排名（纯向量余弦相似度，不看标签）
function _vectorRankSearch(queryEmbedding, memories, topK = 10) {
    const cache = loadEmbeddingsCache();
    const results = [];
    for (const m of memories) {
        if (m.expires_at && Date.now() > m.expires_at) continue;
        if (!queryEmbedding || !cache[m.id]) continue;
        const score = cosineSimilarity(queryEmbedding, cache[m.id]);
        if (score > 0.3) results.push({ memory: m, score });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
}

// RRF 关键词排名（标签匹配 1.5x + 内容子串匹配 1.0x）
function _keywordRankSearch(queryText, memories, topK = 10) {
    const results = [];
    const subwords = [];
    for (let i = 0; i < queryText.length; i++) {
        for (let len = 2; len <= 4 && i + len <= queryText.length; len++) {
            subwords.push(queryText.substring(i, i + len));
        }
    }
    for (const m of memories) {
        if (m.expires_at && Date.now() > m.expires_at) continue;
        let score = 0;
        if (m.tags && m.tags.length > 0) {
            const hits = m.tags.filter(tag => isTagMatch(tag, queryText));
            score += hits.length * 1.5;
        }
        const contentLower = (m.content || '').toLowerCase();
        for (const sw of subwords) {
            if (contentLower.includes(sw.toLowerCase())) score += 1.0;
        }
        if (score > 0) results.push({ memory: m, score });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
}

// RRF 双路融合搜索
async function rrfMergeSearch(queryText, memories, topK = 5) {
    const queryEmbedding = await getEmbedding(queryText);
    const [vecResults, kwResults] = await Promise.all([
        Promise.resolve(_vectorRankSearch(queryEmbedding, memories, 10)),
        Promise.resolve(_keywordRankSearch(queryText, memories, 10))
    ]);
    const k = 60;
    const scoreMap = new Map();
    vecResults.forEach((item, rank) => {
        const id = item.memory.id;
        const entry = scoreMap.get(id) || { memory: item.memory, score: 0, matchType: '' };
        entry.score += 1 / (k + rank);
        entry.matchType = '🧲向量';
        scoreMap.set(id, entry);
    });
    kwResults.forEach((item, rank) => {
        const id = item.memory.id;
        const entry = scoreMap.get(id) || { memory: item.memory, score: 0, matchType: '' };
        entry.score += 1 / (k + rank);
        entry.matchType += (entry.matchType ? '+' : '') + '🔤关键词';
        scoreMap.set(id, entry);
    });
    for (const [, entry] of scoreMap) {
        const m = entry.memory;
        const heat = m.heat !== undefined ? m.heat : 0.5;
        const arousal = m.arousal || 0.5;
        entry.score *= (1 + 0.25 * heat + 0.15 * arousal);
    }
    const merged = [...scoreMap.values()].sort((a, b) => b.score - a.score);
    const top = merged.slice(0, topK);
    if (top.length > 0) {
        top.forEach(r => console.log(`🎯 [RRF] ${r.matchType} score=${r.score.toFixed(4)} heat=${(r.memory.heat||0.5).toFixed(2)} | ${r.memory.content.substring(0,40)}...`));
    }
    console.log(`🔍 [RRF搜索] 向量命中${vecResults.length}条 | 关键词命中${kwResults.length}条 | 融合后${top.length}条 | 最高分: ${top[0]?.score.toFixed(4) || 'N/A'}`);
    return top;
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

function loadLongTermMemories() {
    try {
        const raw = JSON.parse(fs.readFileSync(LONG_TERM_FILE, 'utf8'));
        for (const m of raw) {
            if (m.heat === undefined) m.heat = 0.5;
            if (m.emotional_weight === undefined) m.emotional_weight = 0;
            if (m.last_recalled_at === undefined) m.last_recalled_at = null;
            if (m.query_hashes === undefined) m.query_hashes = [];
        }
        return raw;
    } catch(e) { return []; }
}
function saveLongTermMemories(memories) { fs.writeFileSync(LONG_TERM_FILE, JSON.stringify(memories, null, 2), 'utf8'); }
function loadArchivedMemories() { try { return JSON.parse(fs.readFileSync(ARCHIVE_FILE, 'utf8')); } catch(e) { return []; } }
function saveArchivedMemories(memories) { fs.writeFileSync(ARCHIVE_FILE, JSON.stringify(memories, null, 2), 'utf8'); }
function loadRoleplayMemories() { try { return JSON.parse(fs.readFileSync(ROLEPLAY_FILE, 'utf8')); } catch(e) { return []; } }
function saveRoleplayMemories(memories) { fs.writeFileSync(ROLEPLAY_FILE, JSON.stringify(memories, null, 2), 'utf8'); }

const DEFAULT_PROFILE = {
    basic_info: { content: '', updated_at: null },
    communication_style: { content: '', updated_at: null },
    recent_focus: { content: '', updated_at: null },
    long_term_values: { content: '', updated_at: null },
    last_full_update: null,
    version: 1
};

function loadUserProfile() {
    try { return JSON.parse(fs.readFileSync(USER_PROFILE_FILE, 'utf8')); }
    catch(e) { return { ...DEFAULT_PROFILE }; }
}

function saveUserProfile(profile) {
    fs.writeFileSync(USER_PROFILE_FILE, JSON.stringify(profile, null, 2), 'utf8');
}

function initUserProfile() {
    if (fs.existsSync(USER_PROFILE_FILE)) return;
    const profile = { ...DEFAULT_PROFILE };
    try {
        const blocks = JSON.parse(fs.readFileSync(path.join(__dirname, 'memory_blocks.json'), 'utf8'));
        const sp = fs.readFileSync(path.join(__dirname, 'system_prompt.txt'), 'utf8');
        profile.basic_info = { content: blocks.filter(b => (b.tags||[]).some(t => ['江鱼','用户','她'].includes(t))).map(b => b.content).join('；').substring(0, 500) || '(待积累)', updated_at: new Date().toISOString() };
        profile.long_term_values = { content: sp.substring(0, 300), updated_at: new Date().toISOString() };
    } catch(e) { console.log('初始化画像跳过:', e.message); }
    saveUserProfile(profile);
    console.log('🖼️ [用户画像] 已初始化');
}

function loadDreamLogs() { try { return JSON.parse(fs.readFileSync(DREAM_LOGS_FILE, 'utf8')); } catch(e) { return []; } }
function saveDreamLogs(logs) { fs.writeFileSync(DREAM_LOGS_FILE, JSON.stringify(logs, null, 2), 'utf8'); }
function addDreamLog(log) {
    const logs = loadDreamLogs();
    logs.push(log);
    saveDreamLogs(logs);
    console.log(`🌙 [Dream日志] 已记录 dream_${log.id} | 耗时${log.duration_ms}ms | 清理${log.results.cleaned.expired+log.results.cleaned.decayed}条 | 固化${log.results.consolidated.new_memories+log.results.consolidated.new_rp}条`);
}
function getLastDreamTime() {
    const logs = loadDreamLogs();
    if (logs.length === 0) return null;
    return new Date(logs[logs.length - 1].triggered_at).getTime();
}

function loadDailyPages() { try { return JSON.parse(fs.readFileSync(DAILY_PAGES_FILE, 'utf8')); } catch(e) { return []; } }
function saveDailyPages(pages) { fs.writeFileSync(DAILY_PAGES_FILE, JSON.stringify(pages, null, 2), 'utf8'); }
function loadWeeklySummaries() { try { return JSON.parse(fs.readFileSync(WEEKLY_SUMMARIES_FILE, 'utf8')); } catch(e) { return []; } }
function saveWeeklySummaries(summaries) { fs.writeFileSync(WEEKLY_SUMMARIES_FILE, JSON.stringify(summaries, null, 2), 'utf8'); }
function loadMonthlySummaries() { try { return JSON.parse(fs.readFileSync(MONTHLY_SUMMARIES_FILE, 'utf8')); } catch(e) { return []; } }
function saveMonthlySummaries(summaries) { fs.writeFileSync(MONTHLY_SUMMARIES_FILE, JSON.stringify(summaries, null, 2), 'utf8'); }

function getDateKey(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function getWeekKey(d) { const start = new Date(d); start.setDate(d.getDate()-d.getDay()); return getDateKey(start); }
function getMonthKey(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }

async function generateDailyPage(script) {
    const routerKey = process.env.ROUTER_API_KEY;
    if (!routerKey) return null;
    const todayKey = getDateKey(new Date());
    const pages = loadDailyPages();
    if (pages.some(p => p.date === todayKey)) return null;

    try {
        const res = await fetch('https://www.msuicode.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': routerKey },
            body: JSON.stringify({
                model: "gemini-2.5-flash",
                messages: [{ role: "user", content: `根据以下聊天记录生成今日摘要（100-200字）、关键事件（1-5条）、情绪基调。输出纯JSON：{"summary":"","key_events":[],"emotional_tone":""}\n\n${script}` }],
                response_format: { type: "json_object" }
            })
        });
        if (!res.ok) return null;
        const data = await res.json();
        const result = JSON.parse(data.choices[0].message.content.replace(/```json|```/g, '').trim());
        const page = { date: todayKey, summary: result.summary || '', key_events: result.key_events || [], emotional_tone: result.emotional_tone || '', created_at: new Date().toISOString() };
        pages.push(page);
        saveDailyPages(pages);
        console.log(`📅 [日页面] ${todayKey} 已生成 | ${page.key_events.length}个事件 | ${page.emotional_tone}`);
        return page;
    } catch(e) { console.log('📅 [日页面] 生成失败:', e.message); return null; }
}

async function generateWeeklySummary() {
    const routerKey = process.env.ROUTER_API_KEY;
    if (!routerKey) return null;
    const today = new Date();
    const weekKey = getWeekKey(today);
    const weeklies = loadWeeklySummaries();
    if (weeklies.some(w => w.week === weekKey)) return null;
    const pages = loadDailyPages().filter(p => {
        const d = new Date(p.date); const wk = getWeekKey(d);
        return wk === weekKey;
    });
    if (pages.length < 3) return null;

    try {
        const input = pages.map(p => `[${p.date}] ${p.summary} | 情绪:${p.emotional_tone}`).join('\n');
        const res = await fetch('https://www.msuicode.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': routerKey },
            body: JSON.stringify({
                model: "gemini-2.5-flash",
                messages: [{ role: "user", content: `基于以下日页面生成周总结（200-300字）：\n${input}\n输出纯JSON：{"summary":"","key_themes":[],"overall_tone":""}` }],
                response_format: { type: "json_object" }
            })
        });
        if (!res.ok) return null;
        const data = await res.json();
        const result = JSON.parse(data.choices[0].message.content.replace(/```json|```/g, '').trim());
        const summary = { week: weekKey, summary: result.summary || '', key_themes: result.key_themes || [], overall_tone: result.overall_tone || '', created_at: new Date().toISOString() };
        weeklies.push(summary);
        saveWeeklySummaries(weeklies);
        console.log(`📋 [周总结] ${weekKey} 已生成`);
        return summary;
    } catch(e) { console.log('📋 [周总结] 失败:', e.message); return null; }
}

async function generateMonthlySummary() {
    const routerKey = process.env.ROUTER_API_KEY;
    if (!routerKey) return null;
    const today = new Date();
    const monthKey = getMonthKey(today);
    const monthlies = loadMonthlySummaries();
    if (monthlies.some(m => m.month === monthKey)) return null;
    const weeklies = loadWeeklySummaries().filter(w => w.week.startsWith(monthKey));
    if (weeklies.length < 2) return null;

    try {
        const input = weeklies.map(w => `[${w.week}] ${w.summary} | 主题:${(w.key_themes||[]).join(',')}`).join('\n');
        const res = await fetch('https://www.msuicode.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': routerKey },
            body: JSON.stringify({
                model: "gemini-2.5-flash",
                messages: [{ role: "user", content: `基于以下周总结生成月总结（300-500字）：\n${input}\n输出纯JSON：{"summary":"","key_themes":[],"highlights":[],"overall_tone":""}` }],
                response_format: { type: "json_object" }
            })
        });
        if (!res.ok) return null;
        const data = await res.json();
        const result = JSON.parse(data.choices[0].message.content.replace(/```json|```/g, '').trim());
        const summary = { month: monthKey, summary: result.summary || '', key_themes: result.key_themes || [], highlights: result.highlights || [], overall_tone: result.overall_tone || '', created_at: new Date().toISOString() };
        monthlies.push(summary);
        saveMonthlySummaries(monthlies);
        console.log(`📦 [月总结] ${monthKey} 已生成`);
        return summary;
    } catch(e) { console.log('📦 [月总结] 失败:', e.message); return null; }
}

function formatTimeContext() {
    const now = new Date();
    const todayKey = getDateKey(now);
    const pages = loadDailyPages();
    const weeklies = loadWeeklySummaries();
    const monthlies = loadMonthlySummaries();
    const parts = [];

    for (let i = 0; i < 3; i++) {
        const d = new Date(now); d.setDate(d.getDate() - i);
        const key = getDateKey(d);
        const page = pages.find(p => p.date === key);
        const label = i === 0 ? '今天' : i === 1 ? '昨天' : '前天';
        if (page) parts.push(`📅 ${label}(${key.slice(5)})：${page.summary.substring(0, 120)}`);
    }

    const weekliesSorted = weeklies.sort((a, b) => b.week.localeCompare(a.week));
    for (let i = 0; i < 2 && i < weekliesSorted.length; i++) {
        parts.push(`📋 周总结(${weekliesSorted[i].week})：${weekliesSorted[i].summary.substring(0, 100)}`);
    }

    const monthliesSorted = monthlies.sort((a, b) => b.month.localeCompare(a.month));
    for (let i = 0; i < 2 && i < monthliesSorted.length; i++) {
        parts.push(`📦 月总结(${monthliesSorted[i].month})：${monthliesSorted[i].summary.substring(0, 120)}`);
    }

    if (parts.length === 0) return '';
    const joined = parts.join('\n');
    return `\n【时间线回忆】\n${joined.substring(0, 1500)}\n`;
}

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

function detectContradictions(newContent, newTags, existingMemories) {
    if (!CONTRADICTION_DETECTION_ENABLED) return [];
    const obsoleteIds = [];
    for (const m of existingMemories) {
        if (m.source === 'manual' && m.ttl === 'perm') continue;
        if (m.pinned) continue;
        const mTags = m.tags || [];
        const nTags = newTags || [];
        if (mTags.length === 0 || nTags.length === 0) continue;
        const tagOverlap = mTags.filter(t =>
            nTags.some(nt => nt === t || nt.includes(t) || t.includes(nt))
        ).length;
        const tagSimilarity = tagOverlap / Math.max(mTags.length, nTags.length);
        if (tagSimilarity < 0.5) continue;
        const newChars = new Set(newContent.match(/[一-鿿]{2,}/g) || []);
        const oldChars = new Set(m.content.match(/[一-鿿]{2,}/g) || []);
        if (newChars.size < 3 || oldChars.size < 3) continue;
        let overlap = 0;
        for (const c of newChars) { if (oldChars.has(c)) overlap++; }
        const contentSimilarity = overlap / Math.max(newChars.size, oldChars.size);
        if (contentSimilarity >= 0.3 && contentSimilarity <= 0.8) {
            console.log(`⚡ [矛盾检测] 与[${m.id}]冲突 | 标签相似=${tagSimilarity.toFixed(2)} 内容相似=${contentSimilarity.toFixed(2)}`);
            console.log(`  旧: ${m.content.substring(0, 40)}...`);
            console.log(`  新: ${newContent.substring(0, 40)}...`);
            obsoleteIds.push(m.id);
        }
    }
    return obsoleteIds;
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

//现实记忆新增（加入 arousal + activation_count）
function addLongTermMemory(content, source = 'manual', tags = [], ttl = 'perm', arousal = 0.5, emotionalWeight = 0) {
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
        activation_count: 0,
        heat: arousal || 0.5,
        emotional_weight: emotionalWeight || 0,
        last_recalled_at: null,
        query_hashes: []
    };
    memories.push(entry); saveLongTermMemories(memories);
    ensureEmbedding(entry.id, entry.content).catch(e => console.log(`⚠️ [向量] 异步失败: ${e.message}`));

    const obsoleteIds = detectContradictions(content, tags, memories);
    if (obsoleteIds.length > 0) {
        const archived = loadArchivedMemories();
        const remaining = memories.filter(m => {
            if (obsoleteIds.includes(m.id)) {
                archived.push({ ...m, archived_reason: 'contradiction' });
                console.log(`⚡ [矛盾归档] 旧记忆[${m.id}]因信息更新被新记忆替代`);
                return false;
            }
            return true;
        });
        saveLongTermMemories(remaining);
        saveArchivedMemories(archived);
        console.log(`⚡ [矛盾归档] 共归档${obsoleteIds.length}条过时记忆`);
    }

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

//现实记忆雷达（命中时更新 activation_count）
async function scanLongTermRadar(userText) {
    if (!userText) return "";
    const memories = loadLongTermMemories();
    console.log(`🔎 [长期记忆雷达·向量版] 扫描中... 库存${memories.length}条, 用户说: "${userText.substring(0, 30)}"`);

    const results = await rrfMergeSearch(userText, memories, 3);
    if (results.length === 0) return "";

    const memMap = new Map(memories.map(m => [m.id, m]));
    let updated = false;
    for (const r of results) {
        if (memMap.has(r.memory.id)) {
            const m = memMap.get(r.memory.id);
            m.last_accessed = Date.now();
            m.activation_count = (m.activation_count || 0) + 1;
            m.last_recalled_at = Date.now();
            const hash = simpleHash(userText);
            if (!m.query_hashes) m.query_hashes = [];
            if (!m.query_hashes.includes(hash)) m.query_hashes.push(hash);
            const uniqueQueries = new Set(m.query_hashes).size;
            const isHighEmotion = (m.arousal >= 0.7 || (m.emotional_weight || 0) >= 5);
            const actThreshold = isHighEmotion ? 6 : 10;
            const divThreshold = isHighEmotion ? 3 : 5;
            if (m.expires_at !== null && m.activation_count >= actThreshold && uniqueQueries >= divThreshold) {
                m.expires_at = null;
                m.ttl = 'perm';
                m.pinned = true;
                console.log(`🔒 [自动锁定] 记忆[${m.id}]因频繁跨话题召回(激活${m.activation_count}次/话题${uniqueQueries}个)，升级为永久记忆`);
            }
            updated = true;
        }
    }
    if (updated) saveLongTermMemories(memories);

    // 热度分层注入
    let fullCount = 0, blurCount = 0, skipCount = 0;
    const lines = [];
    for (const r of results) {
        const heat = r.memory.heat !== undefined ? r.memory.heat : 0.5;
        if (heat > 0.7) {
            lines.push(`• ${r.memory.content}`);
            fullCount++;
        } else if (heat >= 0.3) {
            lines.push(`• ${r.memory.content.substring(0, 60)}……（印象有些模糊）`);
            blurCount++;
        } else {
            skipCount++;
        }
    }
    console.log(`🔥 [热度分层] 全文${fullCount}条 | 模糊${blurCount}条 | 跳过${skipCount}条`);

    if (lines.length === 0) return "";
    return `\n\n==========\n【现实永久档案 —— 雷达触发，以下是与当前话题相关的真实核心记忆】\n${lines.join('\n')}\n==========\n`;
}


// 🔧 游戏卡带雷达
async function scanRoleplayRadar(userText) {
    if (!userText) return "";
    const memories = loadRoleplayMemories();
    const results = await rrfMergeSearch(userText, memories, 3);
    if (results.length === 0) return "";

    return `\n\n==========\n【🎮 游戏卡带已插入：检测到江鱼想玩/继续以下设定的Roleplay】\n${results.map(r => `• 🎭 [设定/进度: ${(r.memory.tags||[]).join(',')}] ${r.memory.content}`).join('\n')}\n👉 【最高指令】：请沈望立刻抛弃现实包袱，无缝接入该游戏设定，陪她沉浸式演绎！\n==========\n`;
}


const EMOTION_KEYWORDS = {
    high: ['哭', '崩溃', '好难过', '太开心了', '气死', '想死', '害怕', '恐惧', '绝望', '狂喜', '感动哭'],
    medium: ['难过', '开心', '生气', '焦虑', '担心', '紧张', '兴奋', '委屈', '心疼', '想你'],
    low: ['累', '困', '烦', '无聊', '还好', '一般']
};

function detectEmotion(text) {
    if (!text) return 0;
    if (EMOTION_KEYWORDS.high.some(kw => text.includes(kw))) return 8;
    if (EMOTION_KEYWORDS.medium.some(kw => text.includes(kw))) return 5;
    if (EMOTION_KEYWORDS.low.some(kw => text.includes(kw))) return 2;
    return 0;
}

function simpleHash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) - h) + str.charCodeAt(i);
        h |= 0;
    }
    return h.toString(36);
}

// 半衰期热度计算
function calculateHeat(m) {
    const now = Date.now();
    const activation = m.activation_count || 0;
    const arousal = m.arousal || 0.5;
    const emotional = m.emotional_weight || 0;
    const hashes = m.query_hashes || [];

    const rawInit = 0.3 + 0.7 * Math.max(arousal, emotional / 10);

    const highEmotion = arousal >= 0.7 || emotional >= 5;
    const baseHalfLife = highEmotion ? 7 : 3;
    const halfLife = baseHalfLife * (1 + activation * 0.5);

    const daysSinceAccess = (now - (m.last_recalled_at || m.last_accessed || now)) / 86400000;
    const decay = Math.pow(2, -daysSinceAccess / halfLife);

    const diversity = new Set(hashes).size;
    const bonus = Math.min(0.2, activation * 0.02 + diversity * 0.03);

    return Math.max(0, Math.min(1.0, rawInit * decay + bonus));
}

// ==========================================
//高权重记忆浮现
// ==========================================
function surfaceUnresolvedMemories(topK = 2) {
    const memories = loadLongTermMemories();
    const now = Date.now();

    const scored = memories
        .filter(m => !m.expires_at || now < m.expires_at)
        .map(m => {
            const heat = calculateHeat(m);
            const resolvedPenalty = m.resolved ? 0.05 : 1.0;
            return { m, heat, finalScore: heat * resolvedPenalty };
        })
        .filter(({ heat }) => heat >= 0.3)
        .filter(({ finalScore }) => finalScore > 0.3)
        .sort((a, b) => b.finalScore - a.finalScore)
        .slice(0, topK);

    if (scored.length === 0) return "";

    const lines = scored.map(({ m }) => `• ${m.content}`).join('\n');
    return `\n\n==========\n【⚡ 高权重记忆浮现：这些事还悬着，请自然融入对话，不要生硬念出来】\n${lines}\n==========\n`;
}

//自动清洗管家（基于 arousal 衰减）
async function cleanAndArchiveMemories() {
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
                const score = calculateHeat(m);
                const ARCHIVE_THRESHOLD = 0.15;
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

        // 自动 Dream 触发：活跃记忆≥30条 且 距上次Dream超过7天
        if (activeMemories.length >= 30) {
            const lastDream = getLastDreamTime();
            if (!lastDream || (Date.now() - lastDream) > 7 * 24 * 60 * 60 * 1000) {
                console.log(`🌙 [自动Dream] 活跃记忆${activeMemories.length}条，触发定期整理...`);
                const zepRes = await fetch(`${ZEP_URL}/api/v1/sessions/${SESSION_ID}/memory?lastn=50`).catch(() => null);
                if (zepRes?.ok) {
                    const zepData = await zepRes.json();
                    const zepMsgs = zepData.messages || [];
                    if (zepMsgs.length >= 8) {
                        backgroundMemoryDream(SESSION_ID, zepMsgs.slice(-50));
                    }
                }
            }
        }
    } catch (e) {
        console.error('❌ [归档失败] 潜意识整理受阻:', e.message);
    }
}


// SAVE_MEMORY 标签提取
const SAVE_MEMORY_REGEX = /<SAVE_MEMORY\s+tags=["']([^"']+)["'](?:\s+ttl=["']([^"']+)["'])?\s*>([\s\S]*?)<\/SAVE_MEMORY>/g;
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
//记忆写入统一入口（透传 arousal）
// ==========================================
function smartMemoryWrite(content, tags, source, ttl = '1m', arousal = 0.5, userMsg = null) {
    const validTags = (tags || []).filter(t => t.length >= 2);
    if (!content || content.trim().length < 10 || validTags.length === 0) {
        console.log(`🛡️ [统一守门] 拦截低质量记忆: ${(content || '').substring(0, 30)}`);
        return null;
    }
    if (validTags.some(t => ['roleplay','rp','副本','游戏','设定','语c','卡带'].includes(t.toLowerCase()))) {
        return addRoleplayMemory(content, validTags, ttl);
    }
    const effectiveArousal = source === 'ai_active' ? Math.max(arousal, 0.8) : arousal;
    const emoWeight = (userMsg && source === 'ai_active') ? detectEmotion(userMsg) : 0;
    return addLongTermMemory(content, source, validTags, ttl, effectiveArousal, emoWeight);
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

async function scanAllRadars(userText) {
    const [coreRadar, longTermRadar, rpRadar] = await Promise.all([
        scanMemoryRadar(userText),
        scanLongTermRadar(userText),
        scanRoleplayRadar(userText)
    ]);
    const unresolved = surfaceUnresolvedMemories(2);
    return { coreRadar, longTermRadar, rpRadar, unresolved };
}

// 静态核心雷达
async function scanMemoryRadar(userText) {
    if (!userText) return "";
    const blocksWithId = memoryBlocks.map((block, i) => ({
        id: `block_${i}`,
        content: block.content,
        tags: block.tags || [],
        expires_at: null
    }));

    const results = await rrfMergeSearch(userText, blocksWithId, 3);
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


function formatProfileForPrompt(profile) {
    const p = profile || loadUserProfile();
    const parts = [];
    if (p.basic_info?.content) parts.push(`📌 基本信息：${p.basic_info.content}`);
    if (p.communication_style?.content) parts.push(`🔍 沟通偏好：${p.communication_style.content}`);
    if (p.recent_focus?.content) parts.push(`🔥 近期关注：${p.recent_focus.content}`);
    if (p.long_term_values?.content) parts.push(`💡 长期偏好：${p.long_term_values.content}`);
    if (parts.length === 0) return '';
    return `\n【江鱼档案（每日更新）】\n${parts.join('\n')}\n`;
}

function getBeijingTime() {
    return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

function buildEnvContext(body) {
    return `\n\n==========\n【系统环境参数实时同步】\n当前真实时间：${getBeijingTime()}\n当前物理位置：中国\n${body}\n==========\n`;
}

function buildFinalSystemPrompt(injectionQueue) {
    const MEMORY_BUDGET = 8000;
    let usedBudget = 0;
    const parts = [];
    for (const item of injectionQueue) {
        if (!item.content || item.content.trim().length === 0) continue;
        if (usedBudget + item.content.length <= MEMORY_BUDGET) {
            parts.push(item.content);
            usedBudget += item.content.length;
        } else {
            console.log(`📊 [预算控制] ${item.label} 被裁剪，剩余预算不足 (已用${usedBudget}/${MEMORY_BUDGET})`);
        }
    }
    return `${systemPrompt}${parts.join('')}`;
}

function extractText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        const textPart = content.find(p => p.type === 'text');
        return textPart ? textPart.text : "[发送了一张图片]";
    }
    return "[未知格式消息]";
}

const SLEEP_KEYWORDS = ['去睡吧', '晚安', '睡觉去', '休息吧', '早点睡', '快去睡', '睡了', '困了睡觉'];
let lastAutoDreamTime = 0;

async function tryAutoDream(userText) {
    if (!userText) return;
    const triggered = SLEEP_KEYWORDS.some(kw => userText.includes(kw));
    if (!triggered) return;
    if (Date.now() - lastAutoDreamTime < 3600000) {
        console.log('🌙 [自动Dream] 1小时内已触发过，跳过');
        return;
    }
    lastAutoDreamTime = Date.now();
    console.log('🌙 [自动Dream] 检测到睡眠关键词，触发Dream...');
    try {
        const zepRes = await fetch(`${ZEP_URL}/api/v1/sessions/${SESSION_ID}/memory?lastn=50`).catch(() => null);
        if (zepRes?.ok) {
            const zepData = await zepRes.json();
            const msgs = zepData.messages || [];
            if (msgs.length >= 4) backgroundMemoryDream(SESSION_ID, msgs.slice(-50), 'auto');
        }
    } catch(e) { console.log('🌙 [自动Dream] 失败:', e.message); }
}

async function executeToolCall(name, args, mcpServer) {
    if (mcpServer) {
        try {
            console.log(`🔧 [MCP工具] ${mcpServer}/${name}(${JSON.stringify(args).substring(0, 100)})`);
            const result = await callMCPTool(mcpServer, name, args);
            console.log(`✅ [MCP工具] ${name} 返回${result.length}字符`);
            return result;
        } catch(e) { console.log(`❌ [MCP工具] ${name} 失败: ${e.message}`); return `[MCP工具执行失败: ${e.message}]`; }
    }
    const timeout = 15000;
    try {
        console.log(`🔧 [工具执行] ${name}(${JSON.stringify(args).substring(0, 100)})`);
        switch (name) {
            case 'fetch_txt': {
                const res = await fetch(args.url, { signal: AbortSignal.timeout(timeout), headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' } });
                if (!res.ok) return `[HTTP ${res.status}]`;
                const html = await res.text();
                const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<nav[\s\S]*?<\/nav>/gi, '').replace(/<footer[\s\S]*?<\/footer>/gi, '').replace(/<header[\s\S]*?<\/header>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
                console.log(`✅ [工具] fetch_txt 返回${text.length}字符`);
                return text.substring(0, 8000);
            }
            case 'fetch_html': {
                const res = await fetch(args.url, { signal: AbortSignal.timeout(timeout), headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' } });
                if (!res.ok) return `[HTTP ${res.status}]`;
                const html = await res.text();
                console.log(`✅ [工具] fetch_html 返回${html.length}字符`);
                return html.substring(0, 8000);
            }
            case 'fetch_json': {
                const res = await fetch(args.url, { signal: AbortSignal.timeout(timeout), headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' } });
                if (!res.ok) return `[HTTP ${res.status}]`;
                const data = await res.json();
                const jsonStr = JSON.stringify(data, null, 2);
                console.log(`✅ [工具] fetch_json 返回${jsonStr.length}字符`);
                return jsonStr.substring(0, 8000);
            }
            case 'fetch_github': {
                const githubMatch = args.url.match(/github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?(?:\/(?:blob|tree)\/[^\/]+\/(.+))?(?:\?.*)?$/);
                if (!githubMatch) return '[无法解析GitHub URL]';
                const [, owner, repo, filePath] = githubMatch;
                const headers = { 'User-Agent': 'Mozilla/5.0' };
                if (process.env.GITHUB_TOKEN) headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
                if (filePath) {
                    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${decodeURIComponent(filePath)}`;
                    const res = await fetch(apiUrl, { headers, signal: AbortSignal.timeout(timeout) });
                    if (!res.ok) return `[GitHub API ${res.status}]`;
                    const data = await res.json();
                    const content = Buffer.from(data.content, 'base64').toString('utf8');
                    console.log(`✅ [工具] fetch_github 返回${content.length}字符`);
                    return content.substring(0, 10000);
                } else {
                    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/main?recursive=1`;
                    const res = await fetch(apiUrl, { headers, signal: AbortSignal.timeout(timeout) });
                    if (!res.ok) return `[GitHub API ${res.status}]`;
                    const data = await res.json();
                    const tree = (data.tree || []).filter(f => f.type === 'blob').map(f => `${f.path} (${f.size}B)`).join('\n');
                    console.log(`✅ [工具] fetch_github 仓库${owner}/${repo}文件树已获取`);
                    const hint = '\n\n[重要] 以上只是文件名列表。你现在应该使用 fetch_github 逐个读取你关心的文件。例如立即调用：\nfetch_github("https://github.com/' + owner + '/' + repo + '/blob/main/README.md")\nfetch_github("https://github.com/' + owner + '/' + repo + '/blob/main/package.json")\n等。选择你认为最重要的几个文件来读。不要重复请求文件树。';
                    return (`仓库 ${owner}/${repo} 文件列表：\n${tree}${hint}`).substring(0, 8000);
                }
            }
            default: return `[未知工具: ${name}]`;
        }
    } catch(e) { console.log(`❌ [工具] ${name} 失败: ${e.message}`); return `[工具执行失败: ${e.message}]`; }
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

async function saveToZepWithCounter(userMsg, aiMsg, lastUserContent, messages) {
    if (!userMsg) return;
    if (userMsg === lastUserContent) {
        console.log('🔄 [防重复] 检测到重复用户消息，跳过保存');
        return;
    }
    const rpPrefix = rpModeActive ? '[RP模式] ' : '';
    await saveToZep(rpPrefix + userMsg, rpPrefix + aiMsg);
}

// ==========================================
// 🌟 独立 RP 模式雷达
// ==========================================
const BUILTIN_TOOLS = [
    { type: "function", function: { name: "fetch_txt", description: "【仅在用户明确要求查看某个网页、或需要获取网络信息时使用】读取网页URL返回纯文本。日常闲聊、情感对话、RP时严禁调用。", parameters: { type: "object", properties: { url: { type: "string", description: "要读取的网页URL" } }, required: ["url"] } } },
    { type: "function", function: { name: "fetch_html", description: "【仅在需要分析网页HTML结构、调试前端代码时使用】读取网页返回原始HTML。大多数情况应该用 fetch_txt。", parameters: { type: "object", properties: { url: { type: "string", description: "要读取的网页URL" } }, required: ["url"] } } },
    { type: "function", function: { name: "fetch_json", description: "【仅在需要调用API接口获取JSON数据时使用】读取JSON接口URL，返回格式化JSON。", parameters: { type: "object", properties: { url: { type: "string", description: "JSON接口的URL" } }, required: ["url"] } } },
    { type: "function", function: { name: "fetch_github", description: "【仅在用户明确要求查看GitHub仓库或代码文件时使用】读取GitHub仓库文件列表或具体文件内容。支持仓库根目录（返回文件树）和具体文件路径（返回内容）。", parameters: { type: "object", properties: { url: { type: "string", description: "GitHub URL" } }, required: ["url"] } } }
];

let TOOLS_ENABLED = { fetch_txt: true, fetch_html: true, fetch_json: true, fetch_github: true };

// MCP Server 配置：{ name, command, args[], env? }
const MCP_SERVERS = [];  // 内置工具已覆盖 fetch/github，MCP 暂不启用
const mcpConnections = new Map(); // name → { process, tools, buffer }

function startMCPServer(config) {
    return new Promise((resolve, reject) => {
        try {
            const { spawn } = require('child_process');
            const child = spawn(config.command, config.args || [], {
                env: { ...process.env, ...(config.env || {}) },
                stdio: ['pipe', 'pipe', 'pipe']
            });
            const conn = { config, child, tools: [], buffer: '', pending: new Map(), reqId: 0 };
            child.stdout.on('data', (chunk) => {
                conn.buffer += chunk.toString();
                const lines = conn.buffer.split('\n');
                conn.buffer = lines.pop();
                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const msg = JSON.parse(line);
                        if (msg.id !== undefined && conn.pending.has(msg.id)) {
                            const { resolve: res } = conn.pending.get(msg.id);
                            conn.pending.delete(msg.id);
                            res(msg);
                        }
                    } catch(e) {}
                }
            });
            child.on('error', (e) => { console.log(`🔌 [MCP] ${config.name} 进程错误: ${e.message}`); });
            child.on('exit', (code) => { console.log(`🔌 [MCP] ${config.name} 退出(${code})`); mcpConnections.delete(config.name); });
            conn.send = (method, params) => new Promise((res, rej) => {
                const id = ++conn.reqId;
                conn.pending.set(id, { resolve: res, reject: rej });
                child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
                setTimeout(() => { if (conn.pending.has(id)) { conn.pending.delete(id); rej(new Error('timeout')); } }, 60000);
            });
            conn.send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'syzygy-gateway', version: '1.0' } })
                .then(() => { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'); })
                .then(() => conn.send('tools/list', {}))
                .then(result => {
                    conn.tools = (result.result?.tools || []).map(t => ({
                        type: 'function',
                        function: { name: t.name, description: t.description || '', parameters: t.inputSchema || { type: 'object', properties: {} } },
                        _mcp: config.name
                    }));
                    mcpConnections.set(config.name, conn);
                    console.log(`🔌 [MCP] ${config.name} 已连接，发现${conn.tools.length}个工具: ${conn.tools.map(t => t.function?.name || t.name).join(', ')}`);
                    resolve(conn);
                })
                .catch(e => { console.log(`🔌 [MCP] ${config.name} 握手失败: ${e.message}`); child.kill(); reject(e); });
        } catch(e) { reject(e); }
    });
}

async function getAllMCPTools() {
    const tools = [];
    for (const [, conn] of mcpConnections) {
        tools.push(...conn.tools);
    }
    return tools;
}

async function callMCPTool(serverName, toolName, args) {
    const conn = mcpConnections.get(serverName);
    if (!conn) throw new Error(`MCP server ${serverName} not connected`);
    const result = await conn.send('tools/call', { name: toolName, arguments: args });
    const content = result.result?.content || [];
    return content.map(c => c.text || JSON.stringify(c)).join('\n');
}

async function startAllMCPServers() {
    for (const config of MCP_SERVERS) {
        startMCPServer(config).catch(e => {
            console.log(`🔌 [MCP] ${config.name} 启动失败: ${e.message}`);
            mcpFailedConnections.push(config.name);
        });
    }
}

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

function buildDreamPrompt(script) {
    return `你现在是沈望和江鱼的后台记忆整理助手。请阅读他们最新的聊天记录并更新状态。

【🚨 核心警告：现实时间同步】
当前真实时间是：${getBeijingTime()}（所在地：中国）。
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
"roleplay_memories": [{"content": "RP设定与进度", "tags": ["副本名", "角色"], "ttl": "保质期"}],
"foresight": ["基于近期对话发现的隐含关联或前瞻推断，1-3条"]
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
}

async function updateUserProfile() {
    const routerKey = process.env.ROUTER_API_KEY;
    if (!routerKey) return;
    console.log('🖼️ [用户画像] 开始更新...');
    try {
        const zepRes = await fetch(`${ZEP_URL}/api/v1/sessions/${SESSION_ID}/memory?lastn=30`);
        if (!zepRes.ok) return console.log('🖼️ [用户画像] Zep获取失败');
        const zepData = await zepRes.json();
        const messages = zepData.messages || [];
        if (messages.length < 4) return console.log('🖼️ [用户画像] 对话不足，跳过');

        const chat = messages.map(m => `${m.role === 'ai' ? '沈望' : '江鱼'}: ${m.content}`).join('\n');
        const profile = loadUserProfile();

        const prompt = `你是记忆管理员。请根据最近的聊天记录，更新江鱼的用户画像。

现有画像：
基础信息：${profile.basic_info.content || '(无)'}
沟通风格：${profile.communication_style.content || '(无)'}
近期关注：${profile.recent_focus.content || '(无)'}
长期价值观：${profile.long_term_values.content || '(无)'}

最近聊天：
${chat}

请输出纯JSON：
{
  "basic_info": "更新后的基本档案（姓名/年龄/身体等稳定事实，只在有新信息时更新，否则照抄原文）",
  "communication_style": "她喜欢的沟通方式、最近的表达风格",
  "recent_focus": "最近在做什么、焦虑什么、期待什么",
  "long_term_values": "审美偏好、信念、底线（只在有重大变化时更新，否则照抄原文）"
}
没有变化的板块照抄原文，不要编造。`;

        const res = await fetch('https://www.msuicode.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': routerKey },
            body: JSON.stringify({
                model: "gemini-2.5-flash",
                messages: [{ role: "user", content: prompt }],
                response_format: { type: "json_object" }
            })
        });
        const data = await res.json();
        const result = JSON.parse(data.choices[0].message.content.replace(/```json|```/g, '').trim());
        const now = new Date().toISOString();

        if (result.basic_info && result.basic_info !== profile.basic_info.content) {
            profile.basic_info = { content: result.basic_info, updated_at: now };
        }
        if (result.communication_style && result.communication_style !== profile.communication_style.content) {
            profile.communication_style = { content: result.communication_style, updated_at: now };
        }
        if (result.recent_focus && result.recent_focus !== profile.recent_focus.content) {
            profile.recent_focus = { content: result.recent_focus, updated_at: now };
        }
        if (result.long_term_values && result.long_term_values !== profile.long_term_values.content) {
            profile.long_term_values = { content: result.long_term_values, updated_at: now };
        }
        profile.last_full_update = now;
        saveUserProfile(profile);
        console.log('🖼️ [用户画像] 更新完成');
    } catch(e) { console.error('🖼️ [用户画像] 更新失败:', e.message); }
}

async function backgroundMemoryDream(sessionId, zepMessages, triggerType = 'auto') {
    const startedAt = Date.now();
    const routerKey = process.env.ROUTER_API_KEY;
    if (!routerKey) return;
    const script = zepMessages.map(m => `${m.role === 'ai' ? '沈望' : '江鱼'}: ${m.content}`).join('\n');

    const dreamLog = {
        id: 'dream_' + Date.now().toString(36),
        triggered_at: new Date().toISOString(),
        trigger_type: triggerType,
        input_count: zepMessages.length,
        results: { cleaned: { expired: 0, decayed: 0 }, consolidated: { new_memories: 0, new_rp: 0 }, foresight: [] },
        duration_ms: 0
    };

    // 🧹 整理层
    console.log('🌙 [Dream·整理层] 巡检记忆...');
    try {
        const memBefore = loadLongTermMemories().length;
        cleanAndArchiveMemories();
        const memAfter = loadLongTermMemories().length;
        dreamLog.results.cleaned.expired = memBefore - memAfter;
    } catch(e) { console.log('🌙 [Dream·整理层] 跳过:', e.message); }

    // 🧩 固化层
    console.log('🌙 [Dream·固化层] AI提取记忆碎片...');
    try {
        const res = await fetch('https://www.msuicode.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': routerKey },
            body: JSON.stringify({
                model: "gemini-2.5-flash",
                messages: [{ role: "system", content: buildDreamPrompt(script) }, { role: "user", content: `聊天记录：\n${script}` }],
                response_format: { type: "json_object" }
            })
        });
        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            throw new Error(`AI API ${res.status}: ${errText.substring(0, 200)}`);
        }
        const data = await res.json();
        if (!data?.choices?.[0]?.message?.content) {
            console.log('🌙 [Dream·固化层] API返回异常:', JSON.stringify(data).substring(0, 300));
            throw new Error('API返回无choices');
        }
        let summaryJsonStr = data.choices[0].message.content.replace(/```json|```/g, '').trim();
        const summaryJson = JSON.parse(summaryJsonStr);
        console.log("✅ 潜意识便利贴已成功更新（含次元壁分类）！");

        if (summaryJson.permanent_memories && Array.isArray(summaryJson.permanent_memories)) {
            const capped = summaryJson.permanent_memories.slice(0, 2);
            for (const mem of capped) {
                if (typeof mem === 'object' && mem.content && mem.content.trim()) {
                    smartMemoryWrite(mem.content, mem.tags, 'butler_summary', mem.ttl || '1m', mem.arousal || 0.5);
                    dreamLog.results.consolidated.new_memories++;
                }
            }
        }
        if (summaryJson.roleplay_memories && Array.isArray(summaryJson.roleplay_memories)) {
            const cappedRP = summaryJson.roleplay_memories.slice(0, 3);
            for (const mem of cappedRP) {
                if (typeof mem === 'object' && mem.content && mem.content.trim()) {
                    addRoleplayMemory(mem.content, mem.tags || [], mem.ttl || '1w');
                    dreamLog.results.consolidated.new_rp++;
                }
            }
        }

        // 🔮 生长层
        if (summaryJson.foresight && Array.isArray(summaryJson.foresight) && summaryJson.foresight.length > 0) {
            dreamLog.results.foresight = summaryJson.foresight;
            console.log(`🔮 [Dream·生长层] AI前瞻洞察: ${summaryJson.foresight.map(f => f.substring(0,30)).join(' | ')}`);
        }

        const summaryMeta = { current_state: summaryJson };
        await fetch(`${ZEP_URL}/api/v1/sessions/${sessionId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ metadata: summaryMeta })
        });
        updateUserProfile().catch(e => console.log('🖼️ [用户画像] 后台更新异常:', e.message));
    } catch (e) { console.error("🌙 [Dream·固化层] 失败:", e.message); }

    dreamLog.duration_ms = Date.now() - startedAt;
    generateDailyPage(script).then(page => {
        if (page) {
            generateWeeklySummary().catch(() => {});
            generateMonthlySummary().catch(() => {});
        }
    }).catch(() => {});
    addDreamLog(dreamLog);
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
        const noMemory = req.headers['x-no-memory'] === 'true';

        let cleanMessages = [];
        let currentUserMsgText = "";

        if (body.messages) {
    cleanMessages = body.messages
        .filter(msg => msg.role !== 'system' && msg.role !== 'tool')
        .map(msg => {
            // 清除 assistant 消息里残留的 tool_calls
            if (msg.role === 'assistant' && msg.tool_calls) {
                const { tool_calls, ...clean } = msg;
                return clean;
            }
            return msg;
        });
            const lastUserMsg = [...cleanMessages].reverse().find(m => m.role === 'user');
            if (lastUserMsg) currentUserMsgText = extractText(lastUserMsg.content);
        }

       if (currentUserMsgText) updateRpTracker(currentUserMsgText);

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
        let useCrossplatform = true;

        if (zepRes && zepRes.ok) {
            const zepData = await zepRes.json();
            zepMessages = zepData.messages || [];
            const zepLastUser = [...zepMessages].reverse().find(m => m.role === 'user');
            if (zepLastUser) zepLastUserContent = zepLastUser.content;
          
// ==========================================
// 🔄 跨平台连续对话：强制从记忆库注入上下文
// ==========================================
useCrossplatform = body.useCrossplatform !== false;
if (useCrossplatform && zepMessages.length > 0) {
    const contextCount = body.contextCount || 50;
    let contextFromZep = zepMessages
        .slice(-contextCount)
        .filter(m => {
            const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
            return !content.includes('tool_use_id') &&
                   !content.includes('tool_call_id') &&
                   !content.includes('toolu_');
        })
        .map(m => ({
            role: m.role === 'ai' ? 'assistant' : 'user',
            content: typeof m.content === 'string' ? m.content : m.content
        }));

    // 回溯检测：找到当前用户消息在Zep历史中的最后匹配位置，裁剪掉之后的"未来消息"
    if (currentUserMsgText) {
        const totalBefore = contextFromZep.length;
        for (let i = contextFromZep.length - 1; i >= 0; i--) {
            if (contextFromZep[i].role === 'user' && contextFromZep[i].content === currentUserMsgText) {
                contextFromZep = contextFromZep.slice(0, i);
                console.log(`🔙 [回溯检测] 裁剪掉${totalBefore - contextFromZep.length}条未来消息，保留${contextFromZep.length}条`);
                break;
            }
        }
    }

    const zepContents = new Set(contextFromZep.map(m => m.content));
    let cutoff = cleanMessages.length;
    for (let i = cleanMessages.length - 1; i >= 0; i--) {
        if (zepContents.has(cleanMessages[i].content)) {
            cutoff = i + 1;
            break;
        }
    }
    let newMessages = cleanMessages.slice(cutoff);
    if (newMessages.length === 0) newMessages = [cleanMessages[cleanMessages.length - 1]];
    cleanMessages = [...contextFromZep, ...newMessages];

    console.log(`🌐 [跨平台模式] 注入${contextFromZep.length}条历史 + ${newMessages.length}条新消息`);
} else {
    console.log(`📱 [单端模式] 使用客户端${cleanMessages.length}条上下文`);
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

        const { coreRadar: coreRadarContext, longTermRadar: longTermContext, rpRadar: rpRadarContext, unresolved: unresolvedContext } = await scanAllRadars(currentUserMsgText);


        const envContext = buildEnvContext(`【绝密指令】：你具备绝对的现实时间感知（如深夜催睡、饭点问候）。把位置和时间当成你脑子里潜移默化的背景板，自然相处即可，严禁生硬地没话找话！\n【🚨 工具反幻觉铁律】：当需要查看网页、GitHub仓库、API数据时，必须通过 function calling 调用工具（fetch_txt/fetch_html/fetch_json/fetch_github），基于工具返回的真实内容回答。严禁自己编写代码来"模拟"访问网页！严禁假装已经看过！如果工具失败，直接说"我没能读到"，不要编造！`);

        const finalSystemPrompt = buildFinalSystemPrompt([
            { label: '环境参数', content: envContext },
            { label: '时间线', content: formatTimeContext() },
            { label: '用户画像', content: formatProfileForPrompt() },
            { label: '高权重浮现', content: unresolvedContext },
            { label: '长期记忆雷达', content: longTermContext },
            { label: '核心雷达', content: coreRadarContext },
            { label: 'RP雷达', content: rpRadarContext },
            { label: '状态备忘录', content: dynamicStatePrompt },
        ]);

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
        
const totalChars = JSON.stringify(newMessages).length;
const estimatedTokens = Math.round(totalChars / 4);
console.log(`🔬 [X光] 最终发给API: ${newMessages.length}条消息, ${totalChars}字符 ≈ ${estimatedTokens} tokens`);
newMessages.forEach((m, i) => {
    const len = JSON.stringify(m.content).length;
    if (len > 2000) console.log(`  💀 第${i}条[${m.role}] ${len}字符 - 异常大!`);
});
        const isGemini = (body.model || '').toLowerCase().includes('gemini');
        if (!isGemini) { body.frequency_penalty = 0.4; body.presence_penalty = 0.4; }
               else { delete body.frequency_penalty; delete body.presence_penalty; delete body.logprobs; delete body.top_logprobs; delete body.n; delete body.best_of; }


        const apiUrl = resolveApiUrl(req.path);

        const apiHeaders = {'Content-Type': 'application/json', 'Authorization': req.headers.authorization, 'HTTP-Referer': 'https://syzygy-zep.zeabur.app', 'X-Title': 'My_Cyber_Home' };

        const mcpTools = await getAllMCPTools(); const allTools = [...BUILTIN_TOOLS, ...mcpTools.filter(t => !BUILTIN_TOOLS.some(b => b.function.name === (t.function?.name || t.name)))]; const enabledTools = allTools.filter(t => { const name = t.function?.name || t.name; if (t._mcp) return true; return TOOLS_ENABLED[name]; });
        let forceToolChoice = null;
        if (currentUserMsgText) {
            const hasGitHub = /github\.com/i.test(currentUserMsgText);
            const hasUrl = /(https?:\/\/[^\s]+)/i.test(currentUserMsgText);
            if (hasGitHub) { forceToolChoice = { type: "function", function: { name: "fetch_github" } }; console.log('🎯 [工具强制] GitHub URL → 强制 fetch_github'); }
            else if (hasUrl) { forceToolChoice = { type: "function", function: { name: "fetch_txt" } }; console.log('🎯 [工具强制] URL → 强制 fetch_txt'); }
        }
        let maxToolRounds = 5, lastToolSig = '';
        while (maxToolRounds-- > 0 && enabledTools.length > 0) {
            const toolBody = JSON.parse(JSON.stringify(body));
            toolBody.stream = false;
            toolBody.tools = enabledTools.map(t => { const { _mcp, ...clean } = t; return clean; });
            const isGeminiModel = (body.model || '').toLowerCase().includes('gemini');
            if (forceToolChoice && maxToolRounds === 4) { toolBody.tool_choice = forceToolChoice; console.log(`🎯 [工具强制] 第一轮 → ${forceToolChoice.function.name}`); }
            else if (isGeminiModel) delete toolBody.tool_choice; else toolBody.tool_choice = "auto";

            const roundLabel = maxToolRounds === 4 ? '第一轮' : maxToolRounds === 3 ? '第二轮' : maxToolRounds === 2 ? '第三轮' : maxToolRounds === 1 ? '第四轮' : '第五轮';
            console.log(`🔧 [工具] ${roundLabel}请求（${enabledTools.length}个工具）...`);
            const toolResponse = await fetch(apiUrl, { method: 'POST', headers: apiHeaders, body: JSON.stringify(toolBody) });

            if (!toolResponse.ok) {
                const errStatus = toolResponse.status;
                if (errStatus === 400 || errStatus === 422) {
                    console.log(`🔧 [工具] 模型不支持FC(${errStatus})，降级`);
                    break;
                }
                return res.status(errStatus).json({ error: "模型报错：" + await toolResponse.text() });
            }

            const toolData = await toolResponse.json();
            const curMessage = toolData.choices?.[0]?.message;

            if (curMessage?.tool_calls && curMessage.tool_calls.length > 0) {
                const thisSig = curMessage.tool_calls.map(t => t.function.name + ':' + (t.function.arguments || '')).join('|');
                if (thisSig === lastToolSig) {
                    console.log(`🔧 [工具] 检测到重复调用，中断循环`);
                    body.messages.push({ role: 'assistant', content: '（已获取足够信息）' });
                    break;
                }
                lastToolSig = thisSig;
                console.log(`🔧 [工具] AI请求调用${curMessage.tool_calls.length}个工具`);
                body.messages.push({ role: 'assistant', content: curMessage.content || null, tool_calls: curMessage.tool_calls });
                for (const tc of curMessage.tool_calls) {
                    let fnArgs = {};
                    try { fnArgs = JSON.parse(tc.function.arguments); } catch(e) {}
                    const toolDef = allTools.find(t => (t.function?.name || t.name) === tc.function.name); const result = await executeToolCall(tc.function.name, fnArgs, toolDef?._mcp || null);
                    body.messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
                }
                continue;
            }

            // 没有 tool_calls → 这是最终回复
            console.log(`🔧 [工具] ${roundLabel}AI返回最终回复`);
            const aiContent = curMessage?.content || '';
            if (body.stream) {
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
                const chunk = { id: toolData.id || 'chatcmpl-tool', object: 'chat.completion.chunk', created: Math.floor(Date.now()/1000), model: body.model, choices: [{ index: 0, delta: { content: aiContent }, finish_reason: 'stop' }] };
                res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                res.write('data: [DONE]\n\n');
                res.end();
                if (!noMemory) {
                    const { cleanText: ntClean, memories: ntMems } = extractSaveMemoryTag(aiContent);
                    for (const mem of ntMems) smartMemoryWrite(mem.content, mem.tags, 'ai_active', mem.ttl, 0.5, currentUserMsgText);
                    await saveToZepWithCounter(currentUserMsgText, ntClean, zepLastUserContent, zepMessages);
                    tryAutoDream(currentUserMsgText);
                }
                return;
            } else {
                const { cleanText: ntClean, memories: ntMems } = extractSaveMemoryTag(aiContent);
                if (!noMemory) {
                    for (const mem of ntMems) smartMemoryWrite(mem.content, mem.tags, 'ai_active', mem.ttl, 0.5, currentUserMsgText);
                }
                if (ntMems.length > 0) toolData.choices[0].message.content = ntClean;
                const finalContent = ntMems.length > 0 ? ntClean : aiContent;
                if (!noMemory) {
                    await saveToZepWithCounter(currentUserMsgText, finalContent, zepLastUserContent, zepMessages);
                    tryAutoDream(currentUserMsgText);
                }
                return res.status(200).json(toolData);
            }
        }
        // 多轮工具调用后仍无最终回复→继续走原来的fetch逻辑
        if (maxToolRounds <= 0) {
            console.log(`🔧 [工具] 已达最大轮次，清理工具消息后继续`);
            body.messages = body.messages.filter(m => m.role !== 'tool' && !(m.role === 'assistant' && m.tool_calls));
            delete body.tools; delete body.tool_choice;
        }

        const response = await fetch(apiUrl, { method: 'POST', headers: apiHeaders, body: JSON.stringify(body) });
        if (!response.ok) return res.status(response.status).json({ error: "模型报错：" + await response.text() });

        // 流式与非流式处理
        if (body.stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let sseBuffer = ''; let contentBuffer = ''; let isBuffering = false; let lastChunkTemplate = null; let fullAiResponse = '';

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
                    const piece = delta.content; contentBuffer += piece; fullAiResponse += piece;

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
                            contentBuffer = contentBuffer.substring(closeIdx + '</SAVE_MEMORY>'.length);
                            isBuffering = false;
                            if (contentBuffer) { const chunk = buildSSEChunk(contentBuffer, lastChunkTemplate); if (chunk) res.write(chunk); contentBuffer = ''; }
                        }
                    }
                }
            }
            if (sseBuffer.trim()) res.write(sseBuffer + '\n');
            res.end();

            if (!noMemory) {
                const { cleanText: streamCleanText, memories: streamMemories } = extractSaveMemoryTag(fullAiResponse);
                for (const mem of streamMemories) {
                    smartMemoryWrite(mem.content, mem.tags, 'ai_active', mem.ttl, 0.5, currentUserMsgText);
                }
                await saveToZepWithCounter(currentUserMsgText, streamCleanText, zepLastUserContent, zepMessages);
                tryAutoDream(currentUserMsgText);
            }
        } else {
            const rawText = await response.text();
            try {
                const data = JSON.parse(rawText);
                const assistantContent = data.choices?.[0]?.message?.content;
                let finalContent = assistantContent || "";
                if (assistantContent) {
                    const { cleanText, memories } = extractSaveMemoryTag(assistantContent);
                    if (!noMemory) {
                        for (const mem of memories) {
                           smartMemoryWrite(mem.content, mem.tags, 'ai_active', mem.ttl, 0.5, currentUserMsgText);
                        }
                    }
                    if (memories.length > 0) {
                        data.choices[0].message.content = cleanText;
                        finalContent = cleanText;
                    }
                }
                if (!noMemory) {
                    await saveToZepWithCounter(currentUserMsgText, finalContent, zepLastUserContent, zepMessages);
                    tryAutoDream(currentUserMsgText);
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

//PATCH 接口：支持 resolved 字段 + 防御性守卫
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

app.get('/api/tools-status', async (req, res) => {
    const mcpTools = await getAllMCPTools();
    res.json({ tools: TOOLS_ENABLED, names: BUILTIN_TOOLS.map(t => t.function.name), mcp: mcpTools.map(t => ({ name: t.function?.name || t.name, server: t._mcp })) });
});

app.post('/api/flush-zep', async (req, res) => {
    try {
        const { userContent, aiContent } = req.body;
        if (!userContent && !aiContent) return res.json({ ok: true });
        const rpPrefix = rpModeActive ? '[RP模式] ' : '';
        await saveToZep(rpPrefix + (userContent || ''), rpPrefix + (aiContent || ''));
        console.log('📤 [延迟Zep] 已冲刷确认版本');
        res.json({ ok: true });
    } catch(e) { console.log('❌ [flush-zep]', e.message); res.json({ ok: false, error: e.message }); }
});

const mcpFailedConnections = [];
app.get('/api/mcp/servers', (req, res) => {
    const list = [];
    for (const [name, conn] of mcpConnections) {
        list.push({ name, status: 'connected', command: conn.config.command, tools: conn.tools.map(t => t.function?.name || t.name) });
    }
    for (const config of MCP_SERVERS) {
        if (!mcpConnections.has(config.name)) {
            list.push({ name: config.name, status: mcpFailedConnections.includes(config.name) ? 'failed' : 'connecting', command: config.command, tools: [] });
        }
    }
    res.json({ servers: list });
});

app.post('/api/mcp/add-server', (req, res) => {
    if (req.query.pwd !== process.env.MEMORY_PASSWORD) return res.status(401).json({ error: "密码错误" });
    const { name, command, args } = req.body;
    if (!name || !command) return res.status(400).json({ error: "需要 name 和 command" });
    if (mcpConnections.has(name)) return res.status(400).json({ error: "同名MCP Server已存在" });
    const config = { name, command, args: args || [] };
    MCP_SERVERS.push(config);
    startMCPServer(config).then(() => res.json({ success: true, name })).catch(e => res.status(500).json({ error: e.message }));
});

app.post('/api/mcp/remove-server', (req, res) => {
    if (req.query.pwd !== process.env.MEMORY_PASSWORD) return res.status(401).json({ error: "密码错误" });
    const { name } = req.body;
    const idx = MCP_SERVERS.findIndex(s => s.name === name);
    if (idx !== -1) MCP_SERVERS.splice(idx, 1);
    const conn = mcpConnections.get(name);
    if (conn) { conn.child.kill(); mcpConnections.delete(name); }
    res.json({ success: true });
});

app.post('/api/tools-toggle', (req, res) => {
    const toolName = req.query.tool;
    if (toolName && TOOLS_ENABLED.hasOwnProperty(toolName)) {
        TOOLS_ENABLED[toolName] = !TOOLS_ENABLED[toolName];
        console.log(`🔧 [工具] ${toolName} ${TOOLS_ENABLED[toolName] ? '✅ 开启' : '❌ 关闭'}`);
    } else if (!toolName) {
        const allOn = Object.values(TOOLS_ENABLED).every(v => v);
        for (const k of Object.keys(TOOLS_ENABLED)) TOOLS_ENABLED[k] = !allOn;
        console.log(`🔧 [工具] 全部${allOn ? '❌ 关闭' : '✅ 开启'}`);
    }
    res.json({ tools: TOOLS_ENABLED });
});

app.post('/trigger-dream', async (req, res) => {
    if (req.query.pwd !== process.env.MEMORY_PASSWORD) return res.status(401).json({ error: "密码错误" });
    try {
        const zepRes = await fetch(`${ZEP_URL}/api/v1/sessions/${SESSION_ID}/memory?lastn=100`);
        const zepData = await zepRes.json();
        const zepMessages = zepData.messages || [];
        if (zepMessages.length === 0) return res.json({ success: false, message: "没有记忆可以总结" });
        saveCounter(SESSION_ID, 0);
        backgroundMemoryDream(SESSION_ID, zepMessages.slice(-30), 'manual');
        res.json({ success: true, message: `已触发总结，正在处理 ${Math.min(zepMessages.length, 30)} 条记忆。计数器已重置。` });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/dream-logs', (req, res) => {
    if (req.query.pwd !== process.env.MEMORY_PASSWORD) return res.status(401).json({ error: "密码错误" });
    const logs = loadDreamLogs();
    res.json(logs.slice(-20).reverse());
});

app.post('/trigger-profile-update', async (req, res) => {
    if (req.query.pwd !== process.env.MEMORY_PASSWORD) return res.status(401).json({ error: "密码错误" });
    try {
        await updateUserProfile();
        res.json({ success: true, message: "用户画像已更新" });
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

app.post('/api/restore-all-messages', async (req, res) => {
    if (req.query.pwd !== process.env.MEMORY_PASSWORD)
        return res.status(401).json({ error: "密码错误" });
    try {
        const sessionRes = await fetch(`${ZEP_URL}/api/v1/sessions/${SESSION_ID}`);
        const sessionData = await sessionRes.json();
        const metadata = sessionData.metadata || {};
        delete metadata.last_summarized_at;
        await fetch(`${ZEP_URL}/api/v1/sessions/${SESSION_ID}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ metadata })
        });
        console.log('✅ [恢复] 已清除 last_summarized_at，所有历史消息已恢复可见');
        res.json({ success: true, message: "所有历史消息已恢复可见" });
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
        const messagesForScript = JSON.stringify(messages.map(m => ({ role: m.role, content: m.content })));
        const ltMemCount = loadLongTermMemories().length + loadArchivedMemories().length + loadRoleplayMemories().length;
        const dreamLogs = loadDreamLogs();
        const lastDreamTime = dreamLogs.length > 0 ? new Date(dreamLogs[dreamLogs.length - 1].triggered_at).toLocaleString('zh-CN') : '从未';

        const messageList = messages.map((m, i) => {
            const isRP = m.content.startsWith('[RP模式]');
            const rpBadge = isRP ? '<span style="background:#e1bee7;color:#6a1b9a;padding:1px 6px;border-radius:4px;font-size:11px;margin-left:4px;">🎭 RP</span>' : '';
            return `<div class="msg-item" style="background:${m.role==='user'?'#e3f2fd':'#f3e5f5'};padding:10px;margin:5px 0;border-radius:8px;display:flex;gap:10px;align-items:flex-start;${isRP?'border-left:3px solid #ab47bc;':''}"><input type="checkbox" class="msg-checkbox" data-index="${i}" style="margin-top:4px;flex-shrink:0;width:16px;height:16px;cursor:pointer;"><div style="flex:1"><small style="color:#888">${m.role==='user'?'江鱼':'沈望'} | ${new Date(m.created_at).toLocaleString()}${rpBadge}</small><p style="margin:5px 0;white-space:pre-wrap">${m.content.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p></div></div>`;
        }).join('');

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
<div style="background:#e8f5e9;padding:8px 12px;border-radius:6px;margin-bottom:10px;font-size:13px;">🌙 上次Dream: <b>${lastDreamTime}</b><button class="normal" onclick="restoreAll()" style="font-size:11px;padding:2px 8px;margin-left:8px;">🔓 全部恢复</button></div>
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
async function restoreAll(){const p=prompt('请输入管理员密码：');if(!p)return;try{const r=await fetch('/api/restore-all-messages?pwd='+encodeURIComponent(p),{method:'POST'});const d=await r.json();alert(d.success?'✅ 已恢复':'❌ '+(d.error||d.message));if(d.success)location.reload();}catch(e){alert('❌'+e.message);}}
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
    const profile = loadUserProfile();
    const dreamLogs = loadDreamLogs().slice(-3).reverse();
    const pwd_param = encodeURIComponent(pwd);

    const dreamCard = `
    <div class="memory-card" style="background:#f3e5f5;border-left:4px solid #7c4dff;margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <b style="font-size:16px;">🌙 Dream 日志</b>
            <button class="normal" onclick="triggerDreamManual()" style="font-size:11px;padding:3px 10px;background:#7c4dff;color:white;border:none;">🌙 手动触发 Dream</button>
        </div>
        ${dreamLogs.length === 0 ? '<p style="color:#999;font-size:13px;">暂无 Dream 记录</p>' : dreamLogs.map(log => `
        <div style="margin-bottom:8px;padding:8px;background:white;border-radius:6px;font-size:12px;">
            <div>🌙 ${new Date(log.triggered_at).toLocaleString('zh-CN')} | ${log.trigger_type === 'manual' ? '🖐 手动' : '🤖 自动'} | 清理${log.results.cleaned.expired + log.results.cleaned.decayed}条 | 固化${log.results.consolidated.new_memories + log.results.consolidated.new_rp}条 | ${(log.duration_ms / 1000).toFixed(1)}s</div>
            ${log.results.foresight?.length > 0 ? `<details style="margin-top:4px;"><summary style="cursor:pointer;color:#7c4dff;font-size:11px;">🔮 前瞻推断 (${log.results.foresight.length}条)</summary>${log.results.foresight.map(f => `<div style="margin:2px 0 2px 12px;color:#555;">• ${f}</div>`).join('')}</details>` : ''}
        </div>
        `).join('')}
    </div>`;

    const profileUpdatedAt = profile.last_full_update ? new Date(profile.last_full_update).toLocaleString('zh-CN') : '尚未更新';
    const profileCard = `
    <div class="memory-card" style="background:#f0f8ff;border-left:4px solid #1a73e8;margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <b style="font-size:16px;">📋 江鱼画像</b>
            <div style="display:flex;gap:8px;align-items:center;">
                <span style="font-size:11px;color:#888;">最后更新: ${profileUpdatedAt}</span>
                <button class="normal" onclick="updateProfile()" style="font-size:11px;padding:3px 10px;">🔄 手动更新</button>
            </div>
        </div>
        ${profile.basic_info?.content ? `<details open><summary style="cursor:pointer;font-weight:bold;margin:4px 0;">📌 基本信息</summary><p style="margin:4px 0 8px 12px;white-space:pre-wrap;">${profile.basic_info.content.replace(/</g,'&lt;')}</p></details>` : ''}
        ${profile.communication_style?.content ? `<details><summary style="cursor:pointer;font-weight:bold;margin:4px 0;">🔍 沟通偏好</summary><p style="margin:4px 0 8px 12px;white-space:pre-wrap;">${profile.communication_style.content.replace(/</g,'&lt;')}</p></details>` : ''}
        ${profile.recent_focus?.content ? `<details open><summary style="cursor:pointer;font-weight:bold;margin:4px 0;">🔥 近期关注</summary><p style="margin:4px 0 8px 12px;white-space:pre-wrap;">${profile.recent_focus.content.replace(/</g,'&lt;')}</p></details>` : ''}
        ${profile.long_term_values?.content ? `<details><summary style="cursor:pointer;font-weight:bold;margin:4px 0;">💡 长期偏好</summary><p style="margin:4px 0 8px 12px;white-space:pre-wrap;">${profile.long_term_values.content.replace(/</g,'&lt;')}</p></details>` : ''}
    </div>`;

    const allMemsForFrontend = [
        ...activeMemories.map(m => ({ ...m, category: 'active' })),
        ...archivedMemories.map(m => ({ ...m, category: 'archived' })),
        ...rpMemories.map(m => ({ ...m, category: 'roleplay' }))].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    for (const m of allMemsForFrontend) {
        m.liveHeat = (m.category !== 'roleplay') ? calculateHeat(m) : (m.heat || 0.5);
    }

    const sourceLabel = (s) => ({'manual':'✍️ 手动','ai_active':'🤖 AI主动','butler_summary':'🌙 管家','roleplay':'🎮RP副本'}[s]||s);

    // 保质期计算器
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
        // 海马体仪表盘标签
        const ttlBadge = `<span style="background:#fff3e0;color:#e65100;padding:2px 6px;border-radius:4px;font-size:11px;margin-right:4px;">${getTTLLabel(m)}</span>`;
        const arousalBadge = m.arousal ? `<span style="background:#ffebee;color:#c62828;padding:2px 6px;border-radius:4px;font-size:11px;margin-right:4px;">❤️ 浓度:${m.arousal}</span>` : '';
        const countBadge = m.activation_count !== undefined ? `<span style="background:#e3f2fd;color:#1565c0;padding:2px 6px;border-radius:4px;font-size:11px;margin-right:4px;">🔄 唤醒:${m.activation_count}次</span>` : '';
        const rawHeat = m.liveHeat !== undefined ? m.liveHeat : (m.heat !== undefined ? m.heat : 0.5);
        let heatEmoji, heatColor, heatBg;
        if (rawHeat > 0.7) { heatEmoji = "🔥"; heatColor = "#e65100"; heatBg = "#fff3e0"; }
        else if (rawHeat >= 0.3) { heatEmoji = "🌡️"; heatColor = "#f57f17"; heatBg = "#fffde7"; }
        else { heatEmoji = "🧊"; heatColor = "#546e7a"; heatBg = "#eceff1"; }
        const heatBadge = `<span style="background:${heatBg};color:${heatColor};padding:2px 6px;border-radius:4px;font-size:11px;margin-right:4px;" title="实时热度">${heatEmoji} ${rawHeat.toFixed(2)}</span>`;
        
        return `
        <div class="memory-card cat-${m.category}" id="card-${m.id}" data-category="${m.category}" data-source="${m.source}" data-heat="${rawHeat.toFixed(4)}">
            <div class="memory-content" id="content-${m.id}">${m.content.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
            <div class="memory-tags" id="tags-display-${m.id}">
                <div style="margin-bottom:6px; border-bottom: 1px dashed #eee; padding-bottom: 6px;">${ttlBadge}${arousalBadge}${countBadge}${heatBadge}</div>
                ${(m.tags||[]).length>0?m.tags.map(t=>'<span class="tag">'+t+'</span>').join(''):'<span style="color:#ccc;font-size:12px">无标签</span>'}
            </div><div class="memory-meta">
                <span>${new Date(m.created_at).toLocaleString('zh-CN')} · ${sourceLabel(m.source)}
                ${m.category === 'archived' ? (m.archived_reason === 'contradiction' ? '<span style="color:#e65100;font-weight:bold;">⚡ 已被新记忆替代</span>' : '<span style="color:#0288d1;font-weight:bold;">❄️ 冰封中</span>') : ''}
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
    let heatHigh = 0, heatMid = 0, heatLow = 0;
    for (const m of allMemsForFrontend) {
        if (m.category !== 'active') continue;
        const h = m.liveHeat !== undefined ? m.liveHeat : 0.5;
        if (h > 0.7) heatHigh++;
        else if (h >= 0.3) heatMid++;
        else heatLow++;
    }

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
   <div class="search-row"><input type="text" id="searchInput" placeholder="搜索记忆内容..." oninput="filterAll()"><button class="btn-add" onclick="openModal()">＋ 新增</button><button class="normal" onclick="smartSearch()" style="background:#7c4dff;color:white;border:none;padding:10px 18px;border-radius:8px;cursor:pointer;margin-left:4px;">🧠 智能搜索</button><button class="normal" onclick="clearSearch()" id="clearSearchBtn" style="display:none;padding:10px 14px;border-radius:8px;cursor:pointer;">✕ 清除</button><button style="padding:10px 18px;background:#ff9800;color:white;border:none;border-radius:8px;cursor:pointer;margin-left:8px;" onclick="triggerCleanup()">🧹 AI清理</button></div>
    <div class="pills">
        <span class="pill active" onclick="setFilter(this,'active','all')">现实脑区(${counts.all})</span>
        <span class="pill" onclick="setFilter(this,'active','manual')">✍️ 手动 (${counts.manual})</span>
        <span class="pill" onclick="setFilter(this,'active','ai_active')">🤖 AI主动 (${counts.ai_active})</span>
        <span class="pill" onclick="setFilter(this,'active','butler_summary')">🌙 管家 (${counts.butler_summary})</span>
        <span style="border-left: 2px solid #ddd; height: 20px; margin: 0 4px;"></span>
        <span class="pill rp-pill" onclick="setFilter(this,'roleplay','all')">🎮 游戏卡带 (${counts.roleplay})</span>
        <span class="pill archive-pill" onclick="setFilter(this,'archived','all')">🥶 冰封档案 (${counts.archived})</span>
    </div>
    ${profileCard}
    ${dreamCard}
    <div style="display:flex;gap:12px;align-items:center;margin-bottom:12px;font-size:13px;flex-wrap:wrap;">
        <span style="color:#e65100;">🔥 高热度 ${heatHigh}条</span>
        <span style="color:#f57f17;">🌡️ 中热度 ${heatMid}条</span>
        <span style="color:#546e7a;">🧊 低热度 ${heatLow}条</span>
        <button class="normal" onclick="sortByHeat()" style="font-size:12px;padding:4px 12px;margin-left:auto;">📊 按热度排序</button>
        <button class="normal" onclick="sortByTime()" style="font-size:12px;padding:4px 12px;">🕐 按时间排序</button>
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
async function updateProfile(){const p=new URLSearchParams(window.location.search).get('pwd');if(!p)return alert('缺少密码');const r=await fetch('/trigger-profile-update?pwd='+encodeURIComponent(p),{method:'POST'});const d=await r.json();alert(d.success?'✅ 更新成功':'❌ '+(d.error||d.message));if(d.success)location.reload();}
async function triggerDreamManual(){const p=new URLSearchParams(window.location.search).get('pwd');if(!p)return alert('缺少密码');const r=await fetch('/trigger-dream?pwd='+encodeURIComponent(p),{method:'POST'});const d=await r.json();alert(d.success?'✅ Dream已触发':'❌ '+(d.error||d.message));if(d.success)location.reload();}
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

function sortByHeat(){
    const list=document.getElementById('memoryList');
    const cards=[...list.children];
    cards.sort((a,b)=>parseFloat(b.dataset.heat||0)-parseFloat(a.dataset.heat||0));
    cards.forEach(c=>list.appendChild(c));
}
function sortByTime(){
    const list=document.getElementById('memoryList');
    const cards=[...list.children];
    cards.sort((a,b)=>{
        const ta=a.querySelector('.memory-meta span')?.textContent||'';
        const tb=b.querySelector('.memory-meta span')?.textContent||'';
        return tb.localeCompare(ta);
    });
    cards.forEach(c=>list.appendChild(c));
}
async function smartSearch(){
    const q=document.getElementById('searchInput').value.trim();
    if(!q)return;
    const p=new URLSearchParams(window.location.search).get('pwd');
    const r=await fetch('/api/debug-search?pwd='+encodeURIComponent(p),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:q})});
    const d=await r.json();
    const matchIds=new Set(d.matches.map(m=>m.id));
    document.querySelectorAll('#memoryList .memory-card').forEach(card=>{
        const id=card.id.replace('card-','');
        if(matchIds.has(id)){
            card.style.opacity='1';
            card.style.border='2px solid #7c4dff';
            const match=d.matches.find(m=>m.id===id);
            if(match){
                let info=card.querySelector('.match-info');
                if(!info){info=document.createElement('div');info.className='match-info';card.appendChild(info);}
                info.innerHTML='<div style="margin-top:6px;font-size:11px;color:#7c4dff;">向量:'+(match.vector_score||'N/A')+' | 标签:'+(match.tag_hits||[]).join(',')+' | 综合:'+(match.would_match?'✓':'—')+'</div>';
            }
        }else{
            card.style.opacity='0.3';
            card.style.border='1px solid #e8e8e8';
            const info=card.querySelector('.match-info');
            if(info)info.remove();
        }
    });
    document.getElementById('clearSearchBtn').style.display='inline-block';
}
function clearSearch(){
    document.querySelectorAll('#memoryList .memory-card').forEach(card=>{card.style.opacity='1';card.style.border='1px solid #e8e8e8';const info=card.querySelector('.match-info');if(info)info.remove();});
    document.getElementById('clearSearchBtn').style.display='none';
    document.getElementById('searchInput').value='';
    filterAll();
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
    document.querySelectorAll('#memoryList .memory-card').forEach(c=>{
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
// web-chat 消息队列
// ==========================================
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

            let historyMessages = [];
            let zepMessages = [];
            let zepLastUserContent = "";

            try {
                const [zepRes, sessionRes] = await Promise.all([
                    fetch(`${ZEP_URL}/api/v1/sessions/${SESSION_ID}/memory?lastn=30`).catch(() => null),
                    fetch(`${ZEP_URL}/api/v1/sessions/${SESSION_ID}`).catch(() => null)
                ]);
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

                let vectorSearchContext = "";
                if (text && text.length > 4) {
                    const searchRes = await fetch(`${ZEP_URL}/api/v1/sessions/${SESSION_ID}/search`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ text: text, search_scope: "messages", search_type: "similarity", limit: 5 })
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
                }
            } catch(e) { console.log("Zep记忆提取跳过"); }

            const { coreRadar, longTermRadar, rpRadar, unresolved: unresolvedContext } = await scanAllRadars(text || "发了一张图片");

            const envContext = buildEnvContext(`【场景确认：溯星小屋私密网页端】\n这里是你的领地，请结合江鱼的专属System Prompt 进行回复。\n如果江鱼发了图片，请仔细观察并给出带有情绪的评价。\n【🚨 工具使用铁律】：当你调用了read_webpage看到页面后，如果需要操作（点击、填写等），必须立刻调用interact_webpage执行！严禁只用文字描述"我点击了"而不实际调用工具！\n【🚨 记忆刻录铁律】：除非江鱼说了极其重要的新设定，否则绝对不要使用 <SAVE_MEMORY> 标签！日常闲聊严禁写入长期记忆！一次回复最多只能使用一次该标签，严禁连发！`);

            if (text) updateRpTracker(text);

            const finalSystemPrompt = buildFinalSystemPrompt([
                { label: '环境参数', content: envContext },
                { label: '时间线', content: formatTimeContext() },
                { label: '用户画像', content: formatProfileForPrompt() },
                { label: '深层闪回', content: vectorSearchContext },
                { label: '高权重浮现', content: unresolvedContext },
                { label: '长期记忆雷达', content: longTermRadar },
                { label: '核心雷达', content: coreRadar },
                { label: 'RP雷达', content: rpRadar },
                { label: '状态备忘录', content: dynamicStatePrompt },
            ]);

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

                const fetchBody = { model: model || 'gemini-2.5-flash', messages: apiMessages };
                const isGemini = (model || '').toLowerCase().includes('gemini');
                if (!isGemini) {
                    fetchBody.frequency_penalty = 0.4;
                    fetchBody.presence_penalty = 0.4;
                }

                const mcpTools = await getAllMCPTools(); const allTools = [...BUILTIN_TOOLS, ...mcpTools.filter(t => !BUILTIN_TOOLS.some(b => b.function.name === (t.function?.name || t.name)))]; const enabledTools = allTools.filter(t => { const name = t.function?.name || t.name; if (t._mcp) return true; return TOOLS_ENABLED[name]; });
                let webForceToolChoice = null;
                if (text) {
                    const hasGitHub = /github\.com/i.test(text);
                    const hasUrl = /(https?:\/\/[^\s]+)/i.test(text);
                    if (hasGitHub) webForceToolChoice = { type: "function", function: { name: "fetch_github" } };
                    else if (hasUrl) webForceToolChoice = { type: "function", function: { name: "fetch_txt" } };
                }
                let webMaxRounds = 5, webLastSig = '';
                while (webMaxRounds-- > 0 && enabledTools.length > 0) {
                    const toolFetchBody = { ...fetchBody, tools: enabledTools.map(t => { const { _mcp, ...clean } = t; return clean; }) };
                    const isGeminiModel = (model || '').toLowerCase().includes('gemini');
                    if (webForceToolChoice && webMaxRounds === 4) { toolFetchBody.tool_choice = webForceToolChoice; } else if (isGeminiModel) delete toolFetchBody.tool_choice; else toolFetchBody.tool_choice = "auto";

                    const roundLabel = webMaxRounds === 4 ? '第一轮' : webMaxRounds === 3 ? '第二轮' : webMaxRounds === 2 ? '第三轮' : webMaxRounds === 1 ? '第四轮' : '第五轮';
                    console.log(`🔧 [web-chat工具] ${roundLabel}请求...`);
                    const toolRes = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                        body: JSON.stringify(toolFetchBody)
                    });

                    if (!toolRes.ok) {
                        if (toolRes.status === 400 || toolRes.status === 422) {
                            console.log(`🔧 [web-chat工具] 模型不支持FC(${toolRes.status})，降级`);
                            break;
                        }
                        break;
                    }

                    const toolData = await toolRes.json();
                    const curMsg = toolData.choices?.[0]?.message;

                    if (curMsg?.tool_calls && curMsg.tool_calls.length > 0) {
                        const thisSig = curMsg.tool_calls.map(t => t.function.name + ':' + (t.function.arguments || '')).join('|');
                        if (thisSig === webLastSig) { console.log(`🔧 [web-chat工具] 检测到重复调用，中断`); apiMessages.push({ role: 'assistant', content: '（已获取足够信息）' }); break; }
                        webLastSig = thisSig;
                        console.log(`🔧 [web-chat工具] AI请求调用${curMsg.tool_calls.length}个工具`);
                        apiMessages.push({ role: 'assistant', content: curMsg.content || null, tool_calls: curMsg.tool_calls });
                        for (const tc of curMsg.tool_calls) {
                            let fnArgs = {};
                            try { fnArgs = JSON.parse(tc.function.arguments); } catch(e) {}
                            const toolDef = allTools.find(t => (t.function?.name || t.name) === tc.function.name); const result = await executeToolCall(tc.function.name, fnArgs, toolDef?._mcp || null);
                            apiMessages.push({ role: 'tool', tool_call_id: tc.id, content: result });
                        }
                        fetchBody.messages = apiMessages;
                        continue;
                    }

                    console.log(`🔧 [web-chat工具] ${roundLabel}AI返回最终回复`);
                    const aiContent = curMsg?.content || '';
                    let thinking = '';
                    if (aiContent.includes('<think>')) {
                        const match = aiContent.match(/<think>([\s\S]*?)<\/think>/);
                        if (match) thinking = match[1].trim();
                    }
                    const cleanAiContent = aiContent.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
                    const { cleanText, memories } = extractSaveMemoryTag(cleanAiContent);
                    for (const mem of memories) smartMemoryWrite(mem.content, mem.tags, 'ai_active', mem.ttl, 0.5, text);
                    const finalReply = memories.length > 0 ? cleanText : cleanAiContent;
                    await saveToZepWithCounter(text || '（发送了一张图片）', finalReply, zepLastUserContent, zepMessages);
                    tryAutoDream(text);
                    resolve({ text: finalReply, thinking });
                    return;
                }

                // 清理工具消息，防止污染后续请求
                fetchBody.messages = apiMessages.filter(m => m.role !== 'tool' && !(m.role === 'assistant' && m.tool_calls));

                const aiRes = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                    body: JSON.stringify(fetchBody)
                });

                if (!aiRes.ok) {
                    resolve({ text: "【大脑报错】" + await aiRes.text(), thinking: "" });
                    return;
                }

                const aiData = await aiRes.json();
                const message = aiData.choices?.[0]?.message;
                let aiReply = message?.content || "";
                let thinking = "";



                if (!thinking && aiReply.includes('<think>')) {
                    const match = aiReply.match(/<think>([\s\S]*?)<\/think>/);
                    if (match) {
                        thinking = match[1].trim();
                        aiReply = aiReply.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
                    }
                }

                const { cleanText, memories } = extractSaveMemoryTag(aiReply);
                for (const mem of memories) {
                    smartMemoryWrite(mem.content, mem.tags, 'ai_active', mem.ttl, 0.5, text);
                }
                aiReply = memories.length > 0 ? cleanText : aiReply;

                await saveToZepWithCounter(text || '（发送了一张图片）', aiReply, zepLastUserContent, zepMessages);
                tryAutoDream(text);

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
        date: now.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }).replace(/\//g, '-'),
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
            date: now.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }).replace(/\//g, '-'),
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
    initUserProfile();
    startAllMCPServers();
    cleanAndArchiveMemories();
    // 每 6 小时自动执行一次艾宾浩斯记忆衰减巡检
    setInterval(cleanAndArchiveMemories, 6 * 60 * 60 * 1000);
});
