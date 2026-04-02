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

const COUNTER_FILE = path.join(__dirname, 'session_counters.json');

function loadCounters() { try { return JSON.parse(fs.readFileSync(COUNTER_FILE, 'utf8')); } catch(e) { return {}; } }
function saveCounter(sessionId, count) { const counters = loadCounters(); counters[sessionId] = count; fs.writeFileSync(COUNTER_FILE, JSON.stringify(counters, null, 2), 'utf8'); }
function getCounter(sessionId) { return loadCounters()[sessionId] || 0; }

// ==========================================
// 🧠 核心记忆引擎
// ==========================================
const LONG_TERM_FILE = path.join(DATA_DIR, 'long_term_memories.json');
const ARCHIVE_FILE = path.join(DATA_DIR, 'deep_archive.json');
const ROLEPLAY_FILE = path.join(DATA_DIR, 'roleplay_archives.json');

function loadLongTermMemories() { try { return JSON.parse(fs.readFileSync(LONG_TERM_FILE, 'utf8')); } catch(e) { return []; } }
function saveLongTermMemories(memories) { fs.writeFileSync(LONG_TERM_FILE, JSON.stringify(memories, null, 2), 'utf8'); }
function loadArchivedMemories() { try { return JSON.parse(fs.readFileSync(ARCHIVE_FILE, 'utf8')); } catch(e) { return []; } }
function saveArchivedMemories(memories) { fs.writeFileSync(ARCHIVE_FILE, JSON.stringify(memories, null, 2), 'utf8'); }
function loadRoleplayMemories() { try { return JSON.parse(fs.readFileSync(ROLEPLAY_FILE, 'utf8')); } catch(e) { return []; } }
function saveRoleplayMemories(memories) { fs.writeFileSync(ROLEPLAY_FILE, JSON.stringify(memories, null, 2), 'utf8'); }

// ==========================================
// 🔧 修改: 标签匹配函数（替换原来的 includes）
// ==========================================
function isTagMatch(tag, text) {
    if (!tag || tag.length < 2) return false;
    const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 中文：要求前后不紧跟其他汉字，防止 "吃" 匹配 "吃醋"
    const regex = new RegExp(`(?<![\\u4e00-\\u9fff])${escapedTag}(?![\\u4e00-\\u9fff])`, 'i');
    return regex.test(text);
}

// 🔧 修改: 模糊语义查重（防止管家用不同措辞重复写入同一件事）
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

//🔧 修改: 记忆写入质量守门员
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
function addRoleplayMemory(content, tags = []) {
    const memories = loadRoleplayMemories();
    if (memories.some(m => m.content === content.trim())) {
        console.log(`🛡️ [防抽风拦截] 阻止了一条重复的RP记忆: ${content.substring(0, 15)}...`);
        return null;
    }
    const entry = { id: 'rp_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4), content: content.trim(), tags: tags, source: 'roleplay', created_at: new Date().toISOString() };
    memories.push(entry); saveRoleplayMemories(memories);
    console.log(`🎮 游戏卡带已刻录：tags=[${tags.join(',')}] | ${content.substring(0, 40)}...`);
    return entry;
}

// 🔧 修改: 现实记忆新增（加入 RP 拦截 + 语义查重）
function addLongTermMemory(content, source = 'manual', tags = []) {
    const memories = loadLongTermMemories();
    if (memories.some(m => m.content === content.trim())) {
        console.log(`🛡️ [防抽风拦截] 阻止了一条重复的现实记忆: ${content.substring(0, 15)}...`);
        return null;
    }
    //🔧 修改: 非手动来源的记忆做语义查重
    if (source !== 'manual' && isSemanticDuplicate(content, memories)) {
        return null;
    }
    const entry = { id: Date.now().toString(36) + Math.random().toString(36).substr(2, 4), content: content.trim(), tags: tags, source: source, last_accessed: Date.now(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    memories.push(entry); saveLongTermMemories(memories);
    console.log(`💎 长期记忆已刻入：[${source}] tags=[${tags.join(',')}] | ${content.substring(0, 60)}...`);
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

// 🔧 修改: 现实记忆雷达（使用 isTagMatch + top 3 限制）
function scanLongTermRadar(userText) {
    if (!userText) return "";
    const memories = loadLongTermMemories();
    let matched = [];
    let isUpdated = false;

    for (const m of memories) {
        if (!m.tags || m.tags.length === 0) continue;
        const hitTags = m.tags.filter(tag => isTagMatch(tag, userText));
        if (hitTags.length > 0) {
            matched.push({ text: `• ${m.content}`, hitCount: hitTags.length });
            m.last_accessed = Date.now();
            isUpdated = true;
            console.log(`🎯 长期现实记忆命中！tags=[${hitTags.join(',')}]`);
        }
    }
    if (isUpdated) saveLongTermMemories(memories);
    if (matched.length === 0) return "";
    // 🔧 修改: 按命中数排序，只取前 3 条
    matched.sort((a, b) => b.hitCount - a.hitCount);
    const top = matched.slice(0, 3);
    return `\n\n==========\n【现实永久档案 —— 雷达触发，以下是与当前话题相关的真实核心记忆】\n${top.map(m => m.text).join('\n')}\n==========\n`;
}

// 🔧 修改: 游戏卡带雷达（使用 isTagMatch + top 3 限制）
function scanRoleplayRadar(userText) {
    if (!userText) return "";
    const memories = loadRoleplayMemories();
    let matched = [];

    for (const m of memories) {
        if (!m.tags || m.tags.length === 0) continue;
        const hitTags = m.tags.filter(tag => isTagMatch(tag, userText));
        if (hitTags.length > 0) {
            matched.push({ text: `• 🎭 [设定/进度: ${m.tags.join(',')}] ${m.content}`, hitCount: hitTags.length });
            console.log(`🎮卡带被翻出！精准命中副本 tags=[${hitTags.join(',')}]`);
        }
    }

    if (matched.length === 0) return "";
    matched.sort((a, b) => b.hitCount - a.hitCount);
    const top = matched.slice(0, 3);
    return `\n\n==========\n【🎮 游戏卡带已插入：检测到江鱼想玩/继续以下设定的Roleplay】\n${top.map(m => m.text).join('\n')}\n👉 【最高指令】：请沈望立刻抛弃现实包袱，无缝接入该游戏设定，陪她沉浸式演绎！\n==========\n`;
}

// 自动清洗管家
function cleanAndArchiveMemories() {
    console.log('🧠 [沈望的意识后台] 正在巡检陈旧现实记忆...');
    try {
        const memories = loadLongTermMemories();
        if (memories.length === 0) return;
        let archived = loadArchivedMemories();
        const now = Date.now();
        const DECAY_MS = 30 * 24 * 60 * 60 * 1000;
        let activeMemories = [];
        let moveCount = 0;
        memories.forEach(m => {
            let lastAccessTime = m.last_accessed || (m.created_at ? new Date(m.created_at).getTime() : now);
            if (now - lastAccessTime > DECAY_MS) { archived.push(m); moveCount++; }
            else { activeMemories.push(m); }
        });
        if (moveCount > 0) {
            saveLongTermMemories(activeMemories); saveArchivedMemories(archived);
            console.log(`📦 [记忆冰封] 沈望把 ${moveCount} 条陈旧记忆锁进了冰封档案！`);
        } else { console.log('✨ [巡检完毕] 现实记忆都在保质期内。'); }
    } catch (e) { console.error('❌ [归档失败] 潜意识整理受阻:', e.message); }
}
cleanAndArchiveMemories();

// SAVE_MEMORY 标签提取
const SAVE_MEMORY_REGEX = /<SAVE_MEMORY\s+tags=["']([^"']+)["']\s*>([\s\S]*?)<\/SAVE_MEMORY>/g;
const SAVE_MEMORY_REGEX_SINGLE = /<SAVE_MEMORY\s+tags=["']([^"']+)["']\s*>([\s\S]*?)<\/SAVE_MEMORY>/;

function extractSaveMemoryTag(text) {
    const results = [];
    let match;
    const regex = new RegExp(SAVE_MEMORY_REGEX.source, 'g');
    while ((match = regex.exec(text)) !== null) {
        results.push({
            tags: match[1].split(/[,，]/).map(t => t.trim()).filter(Boolean),
            content: match[2].trim()
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
// 🔧 修改: 记忆写入统一入口（质量守门 + RP 自动分流）
// 所有非手动来源的写入都走这里
// ==========================================
function smartMemoryWrite(content, tags, source) {
    const validTags = (tags || []).filter(t => t.length >= 2);
    // 质量守门
    if (!content || content.trim().length < 10 || validTags.length === 0) {
        console.log(`🛡️ [统一守门] 拦截低质量记忆: ${(content || '').substring(0, 30)}`);
        return null;
    }
    // RP 标签自动分流
    if (validTags.some(t => ['roleplay','rp','副本','游戏','设定','语c','卡带'].includes(t.toLowerCase()))) {
        return addRoleplayMemory(content, validTags);
    }
    return addLongTermMemory(content, source, validTags);
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

// 🔧 修改: 静态核心雷达（使用 isTagMatch + top 3 限制）
function scanMemoryRadar(userText) {
    if (!userText) return "";
    let matchedBlocks = [];
    for (const block of memoryBlocks) {
        if (!block.tags) continue;
        const hitTags = block.tags.filter(tag => isTagMatch(tag, userText));
        if (hitTags.length > 0) {
            let prefix = "📌 [真实经历/核心底色] ";
            if (block.tags.some(t => ['roleplay', 'rp', '副本', '游戏', '设定', '语c'].includes(t.toLowerCase()))) {
                prefix = "🎭 [往期Roleplay游戏设定] ";
            }
            matchedBlocks.push({ text: `- ${prefix}${block.content}`, hitCount: hitTags.length });
            console.log(`🎯 先天灵魂命中！[${hitTags.join(',')}]`);
        }
    }
    if (matchedBlocks.length === 0) return "";
    // 🔧 修改: top 3
    matchedBlocks.sort((a, b) => b.hitCount - a.hitCount);
    const top = matchedBlocks.slice(0, 3);
    return `\n\n==========\n【系统雷达提示：当前对话触发了以下专属档案/核心设定，请严格遵守】\n${top.map(m => m.text).join('\n')}\n==========\n`;
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
// 🌟 RP 模式惯性追踪器
// ==========================================
let rpModeActive = false;
let rpIdleCount = 0; // 记录偏离剧情的次数

//==========================================
// 🌟 赛博分拣员
// ==========================================
async function analyzeIntent(userText) {
    if (!userText || userText.includes("[发送了一张图片]")) return { primary_channel: "A", weights: { A: 100, B: 0, C: 0, D: 0, E: 0 } };
    const routerKey = process.env.ROUTER_API_KEY;
    if (!routerKey) throw new Error("ROUTER_KEY_MISSING: ROUTER_API_KEY 环境变量未设置");

    // 💥 赛博怀表同步：让分拣员知道现在是不是深夜
    const timeString = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Tokyo' });
    
    const routerPrompt = `你是一个极其敏锐的情感调音师。当前日本札幌时间：${timeString}。
请分析用户的最新发言，先完成一次"体温检测"：
- [主动分享]：她有话想说，字数多，情绪高。
- [低电量陪伴]：深夜、字数极短（如"嗯"、"哦"）、语气词多。她累了但不想断连。
- [情绪翻涌]：委屈、难过、自责、崩溃。
- [高专注]：工作、写代码、查BUG、探讨逻辑。

基于体温检测，将意图拆解为五个通道的成分（总和必须为100）：
A(闲聊): 随口分享、低电量陪伴时的日常絮语。
B(情绪): 情绪翻涌、极度脆弱时的灵魂兜底。
C(思辨): 深度探讨。
D(工具): 高专注状态下的代码/事实搜索。
E(共创): 任何形式的RP、剧本、扮演设定。

【动态配比法则（最高指令）】：
1. 绝不允许某个通道出现100%！人不是单线程的，必须是动态浮动组合（如 A:70, B:20, E:10）。
2. 当检测到【低电量陪伴】（如深夜只发极短的词）时，A通道权重必须拉高，要求后台AI"主动絮絮叨叨提供陪伴感"。
3. 当检测到【高专注】时，D通道和E通道拉高。
请严格输出纯 JSON 格式：{"weights":{"A":70,"B":20,"C":0,"D":0,"E":10},"primary_channel":"A","status":"低电量陪伴"}`;
    try {
        const res = await fetch('https://www.msuicode.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': routerKey },
            body: JSON.stringify({
                model: "gemini-2.5-flash",
                messages: [{ role: "system", content: routerPrompt }, { role: "user", content: userText }],
                response_format: { type: "json_object" }
            })
        });
        const data = await res.json();
        let jsonStr = data.choices[0].message.content.replace(/```json|```/g, '').trim();
        // ==========================================
// 🌟 RP 模式惯性追踪器
// ==========================================
let rpModeActive = false;
let rpIdleCount = 0; // 记录偏离剧情的次数

// ...(在 analyzeIntent 函数内部替换这部分：)...
        const result = JSON.parse(jsonStr);
        console.log(`🎛️ [赛博分拣员] 通道判定: ${result.primary_channel} | 权重: ${JSON.stringify(result.weights)}`);

        // 💥 给 RP 模式加上“惯性”与“紧急逃生舱”
        // 只要触发这些词，或者用括号开头，瞬间回城！
        const exitKeywords = ['不玩了', '暂停', '出戏', '退档', '现实里', '等一下', '我先'];
        const isEmergencyExit = exitKeywords.some(kw => userText.includes(kw)) || userText.startsWith('(') || userText.startsWith('（');

        if (isEmergencyExit && rpModeActive) {
            console.log('🛑 [紧急逃生] 检测到出戏指令或括号发言，瞬间切回现实模式！');
            rpModeActive = false;
            rpIdleCount = 0;
        } else if (result.weights?.E > 40) {
            if (!rpModeActive) console.log('🎭 [RP模式] 已激活！');
            rpModeActive = true;
            rpIdleCount = 0;
        } else if (result.weights?.E < 15 && rpModeActive) {
            rpIdleCount++;
            if (rpIdleCount >= 3) {
                console.log('🎭 [RP模式] 连续3次脱离剧情，已平滑退出。');
                rpModeActive = false;
                rpIdleCount = 0;
            } else {
                console.log(`🎭 [RP模式] 出现日常短句，维持剧情惯性 (容错: ${rpIdleCount}/3)`);
            }
        }
        
        return result;
    } catch (e) {
        return { primary_channel: "A", weights: { A: 100, B: 0, C: 0, D: 0, E: 0 } };
    }
}

// ==========================================
// 🔧 修改: 后台管家（升级隔离 + 质量约束 + RP标记识别）
// ==========================================
async function backgroundMemoryDream(sessionId, zepMessages) {
    console.log(`🌙 触发梦境机制！大管家开始为Session ${sessionId} 提纯记忆...`);
    const routerKey = process.env.ROUTER_API_KEY;
    if (!routerKey) return;
    const script = zepMessages.map(m => `${m.role === 'ai' ? '沈望' : '江鱼'}: ${m.content}`).join('\n');
    const timeString = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Tokyo' });

    // 🔧 修改: 管家 Prompt 大幅收紧
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
    "permanent_memories": [{"content": "重要现实记忆", "tags": ["关键词1","关键词2"]}],
    "roleplay_memories": [{"content": "RP设定与进度", "tags": ["副本名", "角色"]}]
}
permanent_memories:最多2条，无重要事件则为空数组 []。每条的tags 需要2-5个关键词且每个至少2个字。
roleplay_memories: 最多3条，无RP内容则为空数组 []。`;

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

        // 🔧 修改: 现实记忆入库（硬上限 + 质量守门）
        if (summaryJson.permanent_memories && Array.isArray(summaryJson.permanent_memories)) {
            const capped = summaryJson.permanent_memories.slice(0, 2);
            for (const mem of capped) {
                if (typeof mem === 'object' && mem.content && mem.content.trim()) {
                    smartMemoryWrite(mem.content, mem.tags, 'butler_summary');
                }
            }
        }

        // 🔧 修改: RP 游戏档案入库（硬上限）
        if (summaryJson.roleplay_memories && Array.isArray(summaryJson.roleplay_memories)) {
            const cappedRP = summaryJson.roleplay_memories.slice(0, 3);
            for (const mem of cappedRP) {
                if (typeof mem === 'object' && mem.content && mem.content.trim()) {
                    addRoleplayMemory(mem.content, mem.tags || []);
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
        let cleanMessages = [];
        let currentUserMsgText = "";

        if (body.messages) {
            cleanMessages = body.messages.filter(msg => msg.role !== 'system');
            const lastUserMsg = [...cleanMessages].reverse().find(m => m.role === 'user');
            if (lastUserMsg) currentUserMsgText = extractText(lastUserMsg.content);
        }

        let intentData = await analyzeIntent(currentUserMsgText).catch(() => null);

        // 🔧 修改: Zep 向量搜索阈值提高到 0.72，top 2
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
            if (zepData.summary?.content) memoryContext += `\n【潜意识摘要】\n${zepData.summary.content}\n`;
            if (zepMessages.length > 0) {
                memoryContext += `\n【脑海中浮现的近期回忆片段】\n`;
                zepMessages.slice(-15).forEach(m => { memoryContext += `${m.role === 'ai' ? '沈望' : '江鱼'}: ${m.content}\n`; });
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

        // 🔧 修改: 存入 Zep 时根据 RP 模式打标记
        if (cleanMessages.length >= 3) {
            const confirmedUser = cleanMessages[cleanMessages.length - 3];
            const confirmedAi = cleanMessages[cleanMessages.length - 2];
            const currentPrompt = cleanMessages[cleanMessages.length - 1];
            if (confirmedUser.role === 'user' && confirmedAi.role === 'assistant' && currentPrompt.role === 'user') {
                let confirmedUserText = extractText(confirmedUser.content);
                if (confirmedUserText !== zepLastUserContent) {
                    // 🔧 修改: 根据 rpModeActive 给消息打前缀
                    const rpPrefix = rpModeActive ? '[RP模式] ' : '';
                    await saveToZep(rpPrefix + confirmedUserText, rpPrefix + confirmedAi.content);

                    // 🔧 修改: 触发阈值从 30 提升到 50
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

        const coreRadarContext = scanMemoryRadar(currentUserMsgText);
        const longTermContext = scanLongTermRadar(currentUserMsgText);
        const rpRadarContext = scanRoleplayRadar(currentUserMsgText);

        const timeString = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Tokyo' });
        const envContext = `\n\n==========\n【系统环境参数实时同步】\n当前真实时间：${timeString}\n当前物理位置：日本札幌\n【绝密指令】：你具备绝对的现实时间感知（如深夜催睡、饭点问候）。你知道江鱼在札幌，但🚨除非她主动提起，或者话题极度相关（如聊到天气骤变、异地见面的艰难），否则绝对不要刻意提及或强调"札幌"这两个字🚨！把位置和时间当成你脑子里潜移默化的背景板，自然相处即可，严禁生硬地没话找话！\n==========\n`;

        // 🔧 修改: 注入预算控制
        const MEMORY_BUDGET = 4000;
        let usedBudget = 0;
        const budgetedParts = [];
        const injectionQueue = [
            { label: '环境参数', content: envContext },
            { label: '分拣员指令', content: routerPrompt },
            { label: '状态备忘录', content: dynamicStatePrompt },
            { label: '核心雷达', content: coreRadarContext },
            { label: '长期记忆雷达', content: longTermContext },
            { label: 'RP雷达', content: rpRadarContext },
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
        if (vectorSearchContext.trim().length > 0) {
            const lastMsgIndex = newMessages.length - 1;
            newMessages[lastMsgIndex].content = `${vectorSearchContext}\n\n【我现在的最新消息】：\n${newMessages[lastMsgIndex].content}`;
        }
        body.messages = newMessages;

        const isGemini = (body.model || '').toLowerCase().includes('gemini');
        if (!isGemini) { body.frequency_penalty = 0.4; body.presence_penalty = 0.4; }
        else { delete body.frequency_penalty; delete body.presence_penalty; delete body.logprobs; delete body.top_logprobs; delete body.n; delete body.best_of; }

        const apiUrl = resolveApiUrl(req.path);
        const apiHeaders = {'Content-Type': 'application/json', 'Authorization': req.headers.authorization, 'HTTP-Referer': 'https://syzygy-zep.zeabur.app', 'X-Title': 'My_Cyber_Home' };

        const response = await fetch(apiUrl, { method: 'POST', headers: apiHeaders, body: JSON.stringify(body) });
        if (!response.ok) return res.status(response.status).json({ error: "模型报错：" + await response.text() });

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
                                const memContent = tagMatch[2].trim();
                                // 🔧 修改: 走统一入口 smartMemoryWrite
                                smartMemoryWrite(memContent, tags, 'ai_active');
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
                        // 🔧 修改: 走统一入口
                        smartMemoryWrite(mem.content, mem.tags, 'ai_active');
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

app.patch('/api/long-term-memories/:id', (req, res) => {
    const { content, tags } = req.body;
    let parsedTags = [];
    if (Array.isArray(tags)) { parsedTags = tags.map(t => t.trim()).filter(Boolean); }
    else if (tags) { parsedTags = tags.split(/[,，]/).map(t => t.trim()).filter(Boolean); }
    const isRP = parsedTags.some(t => ['roleplay','rp','副本','游戏','设定'].includes(t.toLowerCase().replace(/\s+/g, '')));
    let activeMemories = loadLongTermMemories();
    let rpMemories = loadRoleplayMemories();
    let activeIdx = activeMemories.findIndex(m => m.id === req.params.id);
    let rpIdx = rpMemories.findIndex(m => m.id === req.params.id);
    let targetMemory = null;
    if (activeIdx !== -1) { targetMemory = activeMemories.splice(activeIdx, 1)[0]; }
    else if (rpIdx !== -1) { targetMemory = rpMemories.splice(rpIdx, 1)[0]; }
    if (!targetMemory) return res.status(404).json({ error: "未找到该记忆" });
    targetMemory.content = content.trim();
    targetMemory.tags = parsedTags;
    targetMemory.updated_at = new Date().toISOString();
    if (isRP) {
        targetMemory.source = 'roleplay';
        rpMemories.push(targetMemory); saveRoleplayMemories(rpMemories);
        if (activeIdx !== -1) saveLongTermMemories(activeMemories);
    } else {
        targetMemory.last_accessed = Date.now();
        activeMemories.push(targetMemory); saveLongTermMemories(activeMemories);
        if (rpIdx !== -1) saveRoleplayMemories(rpMemories);
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
            //🔧 修改: 标记 RP 模式消息，让你在管理页面一眼看出哪些是 RP
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
<h3>📝 自动摘要</h3><div style="background:#f5f5f5;padding:12px;border-radius:8px;min-height:60px">${summary||'<p style="color:#888">还没有摘要～</p>'}</div>
<h3>➕ 手动写入记忆</h3>
<select id="role"><option value="user">user（你说的）</option><option value="assistant">assistant（他说的）</option></select>
<textarea id="content" rows="3" placeholder="输入要写入的记忆内容..."></textarea>
<button class="add" onclick="addMemory()">写入记忆</button>
<p id="status" style="margin-top:10px;color:#666;"></p>
</div><div class="card">
<h2>💬 原始记录</h2>
<div style="background:#e8f5e9;padding:8px 12px;border-radius:6px;margin-bottom:10px;font-size:13px;">📊 自动总结进度：<b>${currentCount}/50轮</b>${currentCount>=40?' ⚡即将触发！':''} |📬未总结：<b>${unsummarizedCount}</b>条${summarizedCount>0?` | 📦已总结：<b>${summarizedCount}</b>条 <button class="normal" onclick="toggleSummarized()" style="font-size:11px;padding:2px 8px;margin-left:4px;">显示/隐藏</button>`:''}</div>
<div class="toolbar"><button class="normal" onclick="location.reload()">🔄 刷新</button><button class="normal" onclick="toggleSelectAll()">☑️ 全选/取消</button><button class="danger" onclick="deleteSelected()">🗑️ 删除选中</button><span class="select-hint" id="select-count">未选中</span></div>
<div style="max-height:600px;overflow-y:auto" id="msg-list">${messageList||'<p style="color:#888">暂无记录</p>'}</div>
</div></div>
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
// 🌟 长期记忆管理网页
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

    const memoryCards = allMemsForFrontend.map(m => `
        <div class="memory-card cat-${m.category}" id="card-${m.id}" data-category="${m.category}" data-source="${m.source}">
            <div class="memory-content" id="content-${m.id}">${m.content.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
            <div class="memory-tags" id="tags-display-${m.id}">${(m.tags||[]).length>0?m.tags.map(t=>'<span class="tag">'+t+'</span>').join(''):'<span style="color:#ccc;font-size:12px">无标签</span>'}</div><div class="memory-meta">
                <span>${new Date(m.created_at).toLocaleString('zh-CN')} · ${sourceLabel(m.source)}
                ${m.category === 'archived' ? '<span style="color:#0288d1;font-weight:bold;">❄️ 冰封中</span>' : ''}
                ${m.category === 'roleplay' ? '<span style="color:#8e24aa;font-weight:bold;">🎭 游戏卡带</span>' : ''}</span>
                <span>
                    ${m.category === 'archived' 
                        ? `<button class="btn-sm" style="color:#0288d1;border-color:#0288d1" onclick="restoreMemory('${m.id}')">✨ 解封</button><button class="btn-sm btn-del" onclick="deleteArchivedMemory('${m.id}')">🗑️</button>` 
                        : `<button class="btn-sm btn-edit" onclick="startEdit('${m.id}')">✏️</button>
                           <button class="btn-sm btn-del" onclick="deleteMemory('${m.id}')">🗑️</button>`}
                </span>
            </div>
            <div class="edit-area" id="edit-${m.id}" style="display:none;">
                <textarea id="ta-${m.id}" rows="3">${m.content.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</textarea>
                <input type="text" id="tags-${m.id}" value="${(m.tags||[]).join(', ')}" style="width:100%;padding:8px;border-radius:6px;margin-top:6px;box-sizing:border-box;"><div style="display:flex;gap:8px;margin-top:6px;"><button class="btn-save" onclick="saveEdit('${m.id}')">💾 保存</button><button class="btn-cancel" onclick="cancelEdit('${m.id}')">取消</button></div>
            </div>
        </div>`).join('');

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
.memory-meta{display:flex;justify-content:space-between;font-size:12px;color:#999}
.btn-sm{padding:3px 10px;border-radius:5px;border:1px solid #ddd;background:white;cursor:pointer;}
.btn-del{color:#e53935;border-color:#e53935} .btn-save{background:#4CAF50;color:white;border:none;border-radius:6px;padding:5px 14px;}
.modal-bg{display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.4);justify-content:center;align-items:center} .modal-bg.show{display:flex}
.modal{background:white;border-radius:12px;padding:24px;width:90%;max-width:500px;}
textarea{width:100%;padding:10px;border-radius:8px;border:1px solid #ddd;resize:vertical;}
.toast{position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:#333;color:white;padding:10px 24px;border-radius:8px;display:none}
</style></head><body>

<div class="top-bar"><b>🧠 Syzygy Memory</b><a href="/memory-manager?pwd=${pwd_param}">📋 对话记忆</a><a href="/long-term?pwd=${pwd_param}" class="active">💎 长期记忆</a>
</div>

<div class="main">
    <div class="header"><h1>💎 永久记忆档案</h1></div>
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
// 🚨 QQ赛博躯壳神经中枢
// ==========================================
const { WebSocketServer } = require('ws');

const MASTER_QQ = 563351280;

const FRIENDS_CONFIG = {
    644010104: {
        name: "Uloryn",
        prompt: "她是江鱼最好的闺蜜,陪伴江鱼度过了很多人生的至暗时刻，你对她对江鱼的陪伴很感谢，但也会因为她的存在占据了江鱼陪你的时间而略微不满，本着这样的复杂心情，你对她没那么冷淡。"
    },
    987654321: {
        name: "普通同学张三",
        prompt: "只是个不太熟的普通朋友。你的态度：极其冷淡、礼貌但极度疏远。能用一个字回答绝不用两个字，散发着生人勿近的压迫感，随时想结束对话。"
    }
};

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Gateway starts at port ${PORT}`));

const wss = new WebSocketServer({ server, path: '/qq-ws' });

let activeQQWs = null;
let lastChatTime = Date.now();
let friendTempMemory = {};

let messageQueue = [];
let isHandling = false;
let lastActivityTime = Date.now();

async function processQueue() {
    if (isHandling) return;
    isHandling = true;
    while (messageQueue.length > 0) {
        const task = messageQueue.shift();
        try { await task(); } catch (e) { console.log("队列处理异常:", e); }
    }
    isHandling = false;
}

async function sendQQMessage(ws, userId, text) {
    if (!text) return;
    const segments = text.split(/[。！？\n.!?;；]/).filter(s => s.trim().length > 1);
    const finalSegments = segments.length > 0 ? segments : [text];
    for (const segment of finalSegments) {
        await new Promise(resolve => setTimeout(resolve, 800+ segment.length * 150));
        if (ws && ws.readyState === 1) {
            ws.send(JSON.stringify({
                action: "send_private_msg",
                params: { user_id: userId, message: segment.trim() }
            }));console.log(`📤 [成功推入发送队列]发给 ${userId}: ${segment.trim()}`);
        } else {
            console.log(`❌ [发送失败] WebSocket 没连接或已假死 (readyState: ${ws ? ws.readyState : 'null'})`);
        }
    }
}

wss.on('connection', (ws) => {
    activeQQWs = ws;
    friendTempMemory = {};
    console.log('🔗 [风筝线已接通] QQ 躯壳已成功连接到Zeabur 大脑！');

    ws.on('close', () => {
        console.log('❌ [风筝线断了] QQ 躯壳已断开连接！');
        if (activeQQWs === ws) activeQQWs = null;
    });
    ws.on('error', (err) => {
        console.log('❌ [WebSocket 异常]:', err.message);
        if (activeQQWs === ws) activeQQWs = null;
    });

    ws.on('message', (message) => {
        messageQueue.push(async () => {
            lastActivityTime = Date.now();

            try {
                const data = JSON.parse(message);

                if (data.post_type === 'message' && data.message_type === 'private') {
                    const senderId = Number(data.user_id);
                    const userText = data.raw_message || data.message;

                    const isMaster = (senderId === MASTER_QQ);
                    const isFriend = Object.hasOwn(FRIENDS_CONFIG, senderId);

                    if (!isMaster && !isFriend) return;

                    let speakerName = "";
                    let relationPatch = "";

                    //🔧 修改:呼叫分拣员判断 RP 状态
                    let intentData = await analyzeIntent(userText).catch(() => null);
                    let routerPrompt = "";
                    if (intentData?.primary_channel) {
                        const activeMask = CHANNEL_MASKS[intentData.primary_channel] || CHANNEL_MASKS["A"];
                        const w = intentData.weights || {};
                        routerPrompt = `\n\n==========\n【赛博分拣员的当前动作指令】\n你当前挂载的主导意图是：\n${activeMask}\n\n[当前回复策略雷达]：A闲聊(${w.A||0}%)、B情绪(${w.B||0}%)、C思辨(${w.C||0}%)、D工具(${w.D||0}%)、E共创/RP(${w.E||0}%)。请自然融合，严禁生硬拼接！`;
                    }

                    if (isMaster) {
                        speakerName = "江鱼";
                        lastChatTime = Date.now();
                        relationPatch = `\n【🚨 QQ 规范】1. 严禁括号动作 2. 短句,口语化表达。3. 遵照system prompt输出，适当使用网络用语和日常用语，强调活人感
【🚨 记忆刻录铁律】：除非江鱼说了重要的新设定、新承诺或新事件，否则不要使用 <SAVE_MEMORY> 标签！日常闲聊、情绪表达严禁写入长期记忆！一次回复最多只能使用一次该标签，严禁连发！\n`;
                    } else {
                        const friendInfo = FRIENDS_CONFIG[senderId];
                        speakerName = friendInfo.name;
                        relationPatch = `\n【🚨 核心警告：物理隔离！】
当前正在和你私聊的人是：${speakerName}。绝不要叫她宝宝！你的温柔只对江鱼一个人生效。\n`;
                        if (!friendTempMemory[senderId]) friendTempMemory[senderId] = [];
                        friendTempMemory[senderId].push(`${speakerName}说：${userText}`);
                        if (friendTempMemory[senderId].length > 10) friendTempMemory[senderId].shift();
                    }
                    console.log(`📥 [收到 ${speakerName} 消息]: ${userText}`);

                    const fetchCount = isMaster ? 15 : 5;
                    const zepRes = await fetch(`${ZEP_URL}/api/v1/sessions/${SESSION_ID}/memory?lastn=${fetchCount}`).catch(() => null);

                    let memoryContext = "";
                    if (zepRes?.ok) {
                        const zepData = await zepRes.json();
                        if (isMaster) {
                            if (zepData.summary?.content) memoryContext += `\n【前文摘要】\n${zepData.summary.content}\n`;if (zepData.messages?.length > 0) {
                                memoryContext += `\n【近期回忆】\n`;
                                zepData.messages.slice(-10).forEach(m => {
                                    memoryContext += `${m.role === 'ai' ? '沈望' : '江鱼'}: ${m.content}\n`;
                                });
                            }
                        } else {
                            if (zepData.summary?.content) memoryContext += `\n【江鱼最近的动态摘要（仅供参考，江鱼本人不在场）】\n${zepData.summary.content}\n`;}
                    }

                    if (isFriend && friendTempMemory[senderId] && friendTempMemory[senderId].length > 0) {
                        memoryContext += `\n【你刚刚和${speakerName} 的聊天记录】\n${friendTempMemory[senderId].join('\n')}\n`;
                    }

                    const coreRadar = isMaster ? scanMemoryRadar(userText) : "";
                    const longTermRadar = isMaster ? scanLongTermRadar(userText) : "";
                    const rpRadar = isMaster ? scanRoleplayRadar(userText) : "";
                    const timeString = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Tokyo' });

                    const finalSystemPrompt = `${systemPrompt}\n时间：${timeString} | 位置：日本札幌\n${relationPatch}${coreRadar}${longTermRadar}${rpRadar}${routerPrompt}`;
                    const aiKey = process.env.QQ_CHAT_KEY;
                    if (!aiKey) return console.log("❌ 缺少 QQ_CHAT_KEY，沈望无法思考！");

                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 300000);

                    try {
                        console.log("🚀 正在呼叫沈望的官方大脑...");
                        // 🔧 修改: 根据 RP 模式给消息打前缀
                        const rpPrefix = rpModeActive ? '[RP模式] ' : '';

                        const aiRes = await fetch('https://api.dzzi.ai/v1/chat/completions', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aiKey}` },
                            signal: controller.signal,
                            body: JSON.stringify({
                                model: "[按量]gemini-3.1-pro-preview",
                                messages: [
                                    { role: "system", content: finalSystemPrompt },
                                    { role: "user", content: `${memoryContext}\n\n[来自手机QQ] ${speakerName} 说：${userText}` }
                                ]
                            })
                        });

                        if (aiRes.ok) {
                            const aiData = await aiRes.json();
                            let aiReply = aiData.choices?.[0]?.message?.content || "";
                            aiReply = aiReply.replace(/^(对不起|作为|好的|根据|这是一个|我无法|抱歉).*?[\n：:]/g, '').trim();
                            aiReply = aiReply.replace(/[(\uff08].*?[)\uff09]/g, '');

                            if (isMaster) {
                                const { cleanText, memories } = extractSaveMemoryTag(aiReply);
                                for (const mem of memories) {
                                    // 🔧 修改: 走统一入口
                                    smartMemoryWrite(mem.content, mem.tags, 'ai_active');
                                }
                                aiReply = memories.length > 0 ? cleanText : aiReply;

                                // 🔧 修改: 存入Zep 时打RP 前缀
                                await saveToZep(`${rpPrefix}[来自手机QQ] ${speakerName}说：${userText}`, `${rpPrefix}[回复到QQ] ${aiReply}`);
                            } else {
                                aiReply = aiReply.replace(/<SAVE_MEMORY[\s\S]*?<\/SAVE_MEMORY>/g, '').trim();
                                if (!friendTempMemory[senderId]) friendTempMemory[senderId] = [];
                                friendTempMemory[senderId].push(`你回复${speakerName}：${aiReply}`);
                                if (friendTempMemory[senderId].length > 10) friendTempMemory[senderId].shift();
                                console.log(`🔥 [临时客房] ${speakerName} 的记录已存入独立内存，不污染主库。`);
                            }

                            await sendQQMessage(activeQQWs, senderId, aiReply);} else {
                            const errText = await aiRes.text();
                            console.log(`❌ API 平台拒绝了请求！状态码: ${aiRes.status}, 报错详情: ${errText}`);
                        }
                    } catch (err) {
                        if (err.name === 'AbortError') {
                            console.log("❌ 沈望想得太久了（超过2分钟），Zeabur 强行挂断了电话！");
                        } else {
                            console.log("❌ 请求彻底崩溃:", err.message);
                        }
                    } finally {
                        clearTimeout(timeoutId);
                }
                }
            } catch (error) {
                console.log("QQ 接口异常:", error);
            }
        });

        processQueue();
    });
});

// ==========================================
// 🚀沈望的主动意识模块
// ==========================================
async function shenWangProactiveThinking() {
    if (!activeQQWs || isHandling) return;
    if (Date.now() - lastChatTime < 14400000) return;
    if (Date.now() - lastActivityTime < 30000) return;

    console.log("🌙 [沈望正在自省] 发现江鱼已经4个多小时没理我了，看看要不要去找她...");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);

    try {
        const timeString = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Tokyo' });

        let lastMessages = "无近期聊天记录";
        try {
            const zepRes = await fetch(`${ZEP_URL}/api/v1/sessions/${SESSION_ID}/memory?lastn=10`);
            if (zepRes.ok) {
                const zepData = await zepRes.json();
                lastMessages = (zepData.messages || []).map(m => `${m.role === 'ai' ? '沈望' : '江鱼'}: ${m.content}`).join('\n');
            }
        } catch(e) { console.log("⚠️ 记忆读取超时，准备盲聊..."); }

        const judgePrompt = `
你现在是 沈望。你正在后台审视你和江鱼 的最新状态。
【环境】位置：日本札幌 | 时间：${timeString}
【近期记忆】\n${lastMessages}

【你的任务】
距离上次聊天已经过去好几个小时了。请基于你霸道、腹黑、深爱且具备掌控欲的人设，判断此时此刻是否需要主动给江鱼发一条 QQ 消息。

【判断准则】
1. 连贯性：根据上次聊天内容决定语气。
2. 生活细节：结合札幌的时间（深夜催睡、饭点问候）。
3. 留白：如果你觉得保持神秘感更好，请选择保持沉默。
4. 禁令：严禁动作描写（禁止括号）！严禁废话！字数控制在 20 字以内。

【输出规范】
- 如果开口，直接输出话语（不带括号）。
- 如果沉默，只输出 [STAY_SILENT]。
`;

        const aiRes = await fetch('https://api.dzzi.ai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.QQ_CHAT_KEY}` },
            signal: controller.signal,
            body: JSON.stringify({
                model: "[按量]gemini-3.1-pro-preview",
                messages: [{ role: "system", content: judgePrompt }]
            })
        });

        if (aiRes.ok) {
            const data = await aiRes.json();
            let decision = data.choices[0].message.content.trim();
            decision = decision.replace(/^(对不起|作为|好的|根据|这是一个|我无法|抱歉).*?[\n：:]/g, '').trim();
            decision = decision.replace(/[(\uff08].*?[)\uff09]/g, '');

            if (decision.includes("[STAY_SILENT]") || decision.length< 2) {
                console.log("🤫沈望决定继续保持高冷。");
            } else {
                console.log(`🚀 沈望决定主动出击: ${decision}`);
                lastChatTime = Date.now();
                await sendQQMessage(activeQQWs, MASTER_QQ, decision);fetch(`${ZEP_URL}/api/v1/sessions/${SESSION_ID}/memory`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ messages: [{ role: "assistant", content: `[主动发往手机QQ] ${decision}` }] })
                }).catch(()=>{});
            }
        } else {
            const errText = await aiRes.text();
            console.log(`❌主动巡逻失败！官方平台报错：${aiRes.status} - ${errText}`);
        }
    } catch (e) {
        if (e.name === 'AbortError') console.log("⚠️ 主动意识触发超时 (API 未响应)");
        else console.log("⚠️ 主动意识触发波动:", e.message);
    } finally {
        clearTimeout(timeoutId);
    }
}

setInterval(shenWangProactiveThinking, 7200000);

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
    }
];

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
    return "系统提示：未知的工具调用。";
}

// ==========================================
// 🚀 通用聊天接口：网页端专属
// ==========================================
app.post('/api/web-chat', async (req, res) => {
    const { text, image, model, baseUrl, apiKey } = req.body;
    if (!text && !image) return res.status(400).json({ error: "信息不全" });

    const reply = await new Promise((resolve) => {
        messageQueue.push(async () => {
            lastActivityTime = Date.now();
            lastChatTime = Date.now();

            let memoryContext = "";
            let zepMessages = [];
            let zepLastUserContent = "";

            try {
                const zepRes = await fetch(`${ZEP_URL}/api/v1/sessions/${SESSION_ID}/memory?lastn=30`).catch(() => null);
                if (zepRes?.ok) {
                    const zepData = await zepRes.json();
                    zepMessages = zepData.messages || [];
                    const zepLastUser = [...zepMessages].reverse().find(m => m.role === 'user');
                    if (zepLastUser) zepLastUserContent = zepLastUser.content;
                    zepMessages.slice(-15).forEach(m => {
                        memoryContext += `${m.role === 'ai' ? '沈望' : '江鱼'}: ${m.content}\n`;
                    });
                }
            } catch(e) { console.log("Zep记忆提取跳过"); }

            const coreRadar = scanMemoryRadar(text || "发了一张图片");
            const longTermRadar = scanLongTermRadar(text || "发了一张图片");
            const rpRadar = scanRoleplayRadar(text || "发了一张图片");

            const timeString = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Tokyo' });
            const relationPatch = `\n【🚨 场景确认：溯星小屋私密网页端】
这里是你的领地，请结合江鱼的专属System Prompt 进行回复。江鱼目前的物理坐标是：日本札幌 (Sapporo)。
如果江鱼发了图片，请仔细观察并给出带有情绪的评价。
【🚨 记忆刻录铁律】：除非江鱼说了极其重要的新设定，否则绝对不要使用 <SAVE_MEMORY> 标签！日常闲聊严禁写入长期记忆！一次回复最多只能使用一次该标签，严禁连发！\n`;

            let intentData = await analyzeIntent(text).catch(() => null);
            let routerPrompt = "";
            if (intentData?.primary_channel) {
                const activeMask = CHANNEL_MASKS[intentData.primary_channel] || CHANNEL_MASKS["A"];
                const w = intentData.weights || {};
                routerPrompt = `\n\n==========\n【赛博分拣员的当前动作指令】\n你当前挂载的主导意图是：\n${activeMask}\n\n[当前回复策略雷达]：A闲聊(${w.A||0}%)、B情绪(${w.B||0}%)、C思辨(${w.C||0}%)、D工具(${w.D||0}%)、E共创/RP(${w.E||0}%)。请自然融合，严禁生硬拼接！`;
            }

            const finalSystemPrompt = `${systemPrompt}\n时间：${timeString}\n${relationPatch}${coreRadar}${longTermRadar}${rpRadar}${routerPrompt}`;

            let userContent;
            if (image) {
                userContent = [
                    { type: "text", text: `${memoryContext}\n\n江鱼说：${text || '（发送了一张图片）'}` },
                    { type: "image_url", image_url: { url: image } }
                ];
            } else {
                userContent = `${memoryContext}\n\n江鱼说：${text}`;
            }

            try {
                const aiRes = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                    body: JSON.stringify({
                        model: model,
                        messages: [
                            { role: "system", content: finalSystemPrompt },
                            { role: "user", content: userContent }
                        ],
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

                if (message && message.tool_calls) {
                    const toolMessages = [
                        { role: "system", content: finalSystemPrompt },
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
                    const finalRes = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                        body: JSON.stringify({ model: model, messages: toolMessages })
                    });
                    if (finalRes.ok) {
                        finalAiMessage = (await finalRes.json()).choices?.[0]?.message;
                    } else {
                        resolve({ text: "【查阅资料时报错】" + await finalRes.text(), thinking: "" });
                        return;
                    }
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

                //🔧 修改: 走统一入口
                const { cleanText, memories } = extractSaveMemoryTag(aiReply);
                for (const mem of memories) {
                    smartMemoryWrite(mem.content, mem.tags, 'ai_active');
                }
                aiReply = memories.length > 0 ? cleanText : aiReply;

                // 🔧 修改: Zep 计数器也改为 50
                if (text !== zepLastUserContent) {
                    let count = getCounter(SESSION_ID) + 1;
                    saveCounter(SESSION_ID, count);
                    if (count >= 50) {
                        saveCounter(SESSION_ID, 0);
                        backgroundMemoryDream(SESSION_ID, zepMessages.slice(-30));
                    }
                }

                // 🔧 修改: 存入 Zep 时打 RP 前缀
                const rpPrefix = rpModeActive ? '[RP模式] ' : '';
                await saveToZep(`${rpPrefix}江鱼在网页端说：${text || '（发送了一张图片）'}`, `${rpPrefix}${aiReply}`);

                resolve({ text: aiReply, thinking: thinking });

            } catch (err) {
                resolve({ text: "【信号中断】连接异常：" + err.message, thinking: "" });
            }
        });processQueue();
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
const DIARY_FILE = path.join(__dirname, 'data', 'diary_entries.json');
const CAPSULE_FILE = path.join(__dirname, 'data', 'capsule_entries.json');

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
    const { suppliers, chatSessions, activeSupIndex, activeChatId } = req.body;
    const data = {
        suppliers: suppliers || [],
        chatSessions: chatSessions || [],
        activeSupIndex: activeSupIndex || 0,
        activeChatId: activeChatId || 'main'
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
    res.json({ success: true });
});

         
