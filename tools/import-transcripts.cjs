// 对话历史导入工具 — 支持多种格式，自动去重分 chunk + 向量生成
// 用法: node tools/import-transcripts.cjs <文件路径>
// 例:   node tools/import-transcripts.cjs backups/gemini_chat.html
//       node tools/import-transcripts.cjs backups/kelivo_data.json

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const DATA_DIR = path.join(__dirname, '..', 'data');
const TRANSCRIPTS_DIR = path.join(DATA_DIR, 'transcripts');
const EMBEDDINGS_CACHE_FILE = path.join(DATA_DIR, 'embeddings_cache.json');

// ========== 工具函数 ==========

function loadMonthFile(filePath) {
    try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) { return []; }
}

function saveMonthFile(filePath, chunks) {
    fs.writeFileSync(filePath, JSON.stringify(chunks, null, 2), 'utf8');
}

function loadEmbeddingsCache() {
    try { return JSON.parse(fs.readFileSync(EMBEDDINGS_CACHE_FILE, 'utf8')); } catch (e) { return {}; }
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
                body: JSON.stringify({ model: p.model, input: truncated, encoding_format: 'float' })
            });
            if (!res.ok) continue;
            const data = await res.json();
            const emb = data?.data?.[0]?.embedding;
            if (emb && Array.isArray(emb) && emb.length > 0) return emb;
        } catch (e) { continue; }
    }
    return null;
}

function ask(query) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question(query, a => { rl.close(); resolve(a); }));
}

// ========== 格式检测 ==========

function detectFormat(filePath, content) {
    const ext = path.extname(filePath).toLowerCase();
    const first2k = content.substring(0, 2000);

    if (ext === '.html' || ext === '.htm') {
        // Gemini Takeout HTML 特征：对话标题 + 消息列表
        if (first2k.includes('gemini') || first2k.includes('bard')) return 'gemini';
        if (first2k.includes('conversation') || first2k.includes('message')) return 'gemini';
        return 'html-generic';
    }

    if (ext === '.json') {
        try {
            const data = JSON.parse(content);
            // 检测常见格式
            if (Array.isArray(data)) {
                if (data.length === 0) return 'json-empty-array';
                const first = data[0];
                // [{title, messages: [{role, content}]}] — 预处理的对话数据
                if (first.title && first.messages && Array.isArray(first.messages) && first.messages.length > 0 && (first.messages[0].role || first.messages[0].sender)) {
                    return 'json-sessions';
                }
                // [{role, content}, ...] 或 [{sender, text}, ...]
                if (first.role || first.sender || first.author) return 'json-messages-array';
                return 'json-generic-array';
            }
            // Kelivo 格式: { version, conversations: [{ messageIds }], messages: [...] }
            if (data.conversations && Array.isArray(data.conversations) && data.messages && data.conversations[0]?.messageIds) {
                return 'kelivo';
            }
            if (data.messages || data.history || data.conversations || data.chats || data.conversation) return 'json-known-structure';
            return 'json-generic-object';
        } catch (e) {
            return 'json-invalid';
        }
    }

    if (ext === '.txt') return 'text';
    return 'unknown';
}

// ========== 解析器 ==========

// --- Gemini HTML ---
function parseGeminiHTML(content) {
    // 取标题
    const titleMatch = content.match(/<title>([^<]*)<\/title>/i)
        || content.match(/<h[12][^>]*>([^<]*)<\/h[12]>/i);
    const title = titleMatch ? titleMatch[1].trim() : 'Gemini 对话';

    // 提取消息块 — 尝试多种常见 Gemini HTML 结构
    const messages = [];

    // 方式1: div.message > div.sender + div.content + div.timestamp
    const blockRegex = /<div[^>]*class="[^"]*\bmessage\b[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;
    let match;
    while ((match = blockRegex.exec(content)) !== null) {
        const block = match[1];
        const sender = (block.match(/<div[^>]*class="[^"]*\bsender\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i) || [])[1]
            || (block.match(/<div[^>]*class="[^"]*\b(user|model|assistant)\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i) || [])[2];
        const text = (block.match(/<div[^>]*class="[^"]*\bcontent\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i) || [])[1]
            || block.replace(/<[^>]+>/g, '').trim();
        const time = (block.match(/<div[^>]*class="[^"]*\btime(?:stamp)?\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i) || [])[1];

        if (text && text.length > 0 && sender) {
            messages.push({
                role: sender.toLowerCase().includes('user') || sender.toLowerCase().includes('you') ? 'user' : 'assistant',
                content: stripHtml(text),
                time: time ? parseDateText(time) : null
            });
        }
    }

    // 方式2: 简单按段落分割（兜底）
    if (messages.length === 0) {
        const lines = content.split('\n')
            .map(l => l.replace(/<[^>]+>/g, '').trim())
            .filter(l => l.length > 10);
        let currentRole = 'user';
        for (const line of lines) {
            messages.push({ role: currentRole, content: line, time: null });
            currentRole = currentRole === 'user' ? 'assistant' : 'user';
        }
    }

    return { title, messages };
}

// --- HTML 通用 ---
function parseGenericHTML(content) {
    const text = content.replace(/<[^>]+>/g, '\n').replace(/\n{3,}/g, '\n').trim();
    const lines = text.split('\n').filter(l => l.trim().length > 5);
    const messages = [];
    let role = 'user';
    for (const line of lines.slice(0, 200)) {
        messages.push({ role, content: line.trim(), time: null });
        role = role === 'user' ? 'assistant' : 'user';
    }
    return { title: path.basename(content), messages };
}

// --- Kelivo JSON ({version, conversations, messages}) ---
function parseKelivoJSON(data) {
    const msgMap = {};
    const msgArray = Array.isArray(data.messages) ? data.messages : (data.messages ? Object.values(data.messages) : []);
    for (const m of msgArray) {
        if (m && m.id) msgMap[m.id] = m;
    }

    const sessions = [];
    for (const conv of data.conversations) {
        const title = conv.title || '未命名对话';
        const ids = conv.messageIds || [];
        const rawMsgs = ids.map(id => msgMap[id]).filter(Boolean);

        if (rawMsgs.length === 0) continue;

        const parsed = rawMsgs
            .map(m => {
                let role = m.role || m.sender || 'user';
                role = typeof role === 'string' ? role.toLowerCase() : 'user';
                if (['assistant', 'ai', 'model', 'bot', 'gpt', 'gemini', '沈望', 'shenwang'].includes(role)) {
                    role = 'assistant';
                } else {
                    role = 'user';
                }
                return {
                    role,
                    content: m.content || m.text || m.message || '',
                    time: m.time || m.timestamp || m.timestamp_ms || m.created || m.date || m.fullTime || null
                };
            })
            .filter(m => m.content && m.content.trim().length > 0);

        if (parsed.length > 0) {
            sessions.push({ title, messages: parsed });
        }
    }

    return sessions;
}

// --- JSON 通用解析 ---
function parseJSONMessages(data) {
    let messages = [];

    if (Array.isArray(data)) {
        messages = data;
    } else if (data.messages) {
        messages = data.messages;
    } else if (data.history) {
        messages = data.history;
    } else if (data.conversations) {
        // 多会话 — 取第一个
        messages = data.conversations[0]?.messages || data.conversations[0]?.history || data.conversations[0] || [];
    } else if (data.conversation) {
        messages = data.conversation.messages || data.conversation.history || data.conversation;
    } else if (data.chats) {
        messages = data.chats[0]?.messages || data.chats[0]?.history || data.chats[0] || [];
    } else {
        // 尝试取第一个数组字段
        for (const key of Object.keys(data)) {
            if (Array.isArray(data[key]) && data[key].length > 0 && typeof data[key][0] === 'object') {
                messages = data[key];
                console.log(`  ℹ️ 自动检测到消息字段: "${key}" (${messages.length} 条)`);
                break;
            }
        }
    }

    // 统一字段名映射
    return messages
        .filter(m => m && (m.content || m.text || m.message))
        .map(m => {
            let role = m.role || m.sender || m.author || m.from || 'user';
            role = (typeof role === 'string') && role.toLowerCase();
            if (['assistant', 'ai', 'model', 'bot', 'assistant', 'gpt', 'gemini', '沈望', 'shenwang'].includes(role)) {
                role = 'assistant';
            } else {
                role = 'user';
            }
            return {
                role,
                content: m.content || m.text || m.message || '',
                time: m.time || m.timestamp || m.timestamp_ms || m.created || m.date || m.fullTime || null
            };
        })
        .filter(m => m.content && m.content.trim().length > 0);
}

// --- 纯文本 ---
function parseTextFile(content) {
    const lines = content.split('\n').filter(l => l.trim().length > 5);
    const messages = [];
    let role = 'user';
    for (const line of lines.slice(0, 200)) {
        messages.push({ role, content: line.trim(), time: null });
        role = role === 'user' ? 'assistant' : 'user';
    }
    return { title: '文本对话', messages };
}

// ========== 辅助 ==========

function stripHtml(html) {
    return html.replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
}

function parseDateText(text) {
    try {
        const d = new Date(text);
        if (!isNaN(d.getTime())) return d.toISOString();
    } catch (e) { }
    return null;
}

function getMonthKey(time) {
    if (!time) return new Date().toISOString().substring(0, 7);
    const d = new Date(time);
    if (isNaN(d.getTime())) return new Date().toISOString().substring(0, 7);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ========== 主流程 ==========

async function main() {
    const filePath = process.argv[2];
    if (!filePath) {
        console.log('用法: node tools/import-transcripts.cjs <文件路径>');
        console.log('');
        console.log('支持格式:');
        console.log('  .html   — Gemini Takeout HTML 导出');
        console.log('  .json   — 多种 JSON 结构 (自动检测)');
        console.log('  .txt    — 纯文本(交替行=用户/AI)');
        console.log('');
        console.log('示例:');
        console.log('  node tools/import-transcripts.cjs ~/Downloads/Gemini/Chat.html');
        process.exit(1);
    }

    if (!fs.existsSync(filePath)) {
        console.error(`❌ 文件不存在: ${filePath}`);
        process.exit(1);
    }

    // ---- 读取 + 检测格式 ----
    const content = fs.readFileSync(filePath, 'utf8');
    const format = detectFormat(filePath, content);
    console.log(`📂 ${path.basename(filePath)} → 检测为: ${format}`);

    // ---- 解析 ----
    let results = [];
    try {
        switch (format) {
            case 'gemini':
                results = [{ ...parseGeminiHTML(content) }];
                break;
            case 'html-generic':
                results = [{ ...parseGenericHTML(content) }];
                break;
            case 'kelivo':
                results = parseKelivoJSON(JSON.parse(content));
                break;
            case 'json-sessions':
                results = JSON.parse(content).map(s => ({
                    ...s,
                    messages: (s.messages || []).map(m => ({
                        role: m.role || 'user',
                        content: m.content || '',
                        time: m.time || m.timestamp || m.created_at || null
                    })).filter(m => m.content && m.content.trim().length > 0)
                })).filter(s => s.messages.length > 0);
                break;
            case 'json-messages-array':
            case 'json-known-structure':
                results = [{ title: path.basename(filePath), messages: parseJSONMessages(JSON.parse(content)) }];
                break;
            case 'json-generic-array':
            case 'json-generic-object':
                results = [{ title: path.basename(filePath), messages: parseJSONMessages(JSON.parse(content)) }];
                break;
            case 'text':
                results = [{ ...parseTextFile(content) }];
                break;
            default:
                console.error('❌ 无法识别的格式，请手动转换或提供更多信息');
                process.exit(1);
        }
    } catch (e) {
        console.error(`❌ 解析失败: ${e.message}`);
        process.exit(1);
    }

    results = results.filter(r => r.messages && r.messages.length > 0);
    if (results.length === 0) {
        console.error('❌ 未提取到任何消息');
        process.exit(1);
    }

    if (results.length > 1) {
        console.log(`📂 检测到 ${results.length} 个会话:`);
        for (const r of results) {
            const users = r.messages.filter(m => m.role === 'user').length;
            const ais = r.messages.filter(m => m.role === 'assistant').length;
            console.log(`  📁 ${r.title} — ${users}条用户 + ${ais}条AI`);
        }
    }

    const result = results[0];
    console.log(`📝 标题: ${result.title}`);
    console.log(`📝 提取到 ${result.messages.length} 条消息`);
    console.log(`  👤 用户: ${result.messages.filter(m => m.role === 'user').length} 条`);
    console.log(`  🤖 AI:   ${result.messages.filter(m => m.role === 'assistant').length} 条`);

    // 按时间范围显示
    const times = result.messages.map(m => m.time).filter(Boolean).sort();
    if (times.length > 0) {
        console.log(`  📅 ${new Date(times[0]).toLocaleDateString('zh-CN')} ~ ${new Date(times[times.length - 1]).toLocaleDateString('zh-CN')}`);
    }

    // 预览前几条
    console.log('\n📋 预览(前3轮):');
    let previewCount = 0;
    for (const m of result.messages) {
        const prefix = m.role === 'user' ? '👤' : '🤖';
        console.log(`  ${prefix} ${(m.content || '').substring(0, 80)}`);
        if (m.role === 'assistant') previewCount++;
        if (previewCount >= 3) break;
    }

    // 确认
    const ok = await ask('\n确认导入? (Y/n) ');
    if (ok.toLowerCase() === 'n') {
        console.log('已取消');
        process.exit(0);
    }

    // ---- 按月份 + 15轮一组分 chunk ----
    if (!fs.existsSync(TRANSCRIPTS_DIR)) fs.mkdirSync(TRANSCRIPTS_DIR, { recursive: true });

    let totalNew = 0;
    const EMBEDDING_API_KEY = process.env.EMBEDDING_API_KEY;

    for (const session of results) {
        console.log(`\n📦 处理会话: ${session.title}`);

        const monthBuckets = {};
        let currentChunk = null;

        // 先把消息排成 (user, assistant) 对
        const rounds = [];
        for (let i = 0; i < session.messages.length; i++) {
            if (session.messages[i].role === 'user') {
                const user = session.messages[i];
                let assistant = null;
                for (let j = i + 1; j < session.messages.length; j++) {
                    if (session.messages[j].role === 'assistant') {
                        assistant = session.messages[j];
                        break;
                    }
                    if (session.messages[j].role === 'user') break;
                }
                rounds.push({ user, assistant: assistant || { role: 'assistant', content: '（无回复）', time: null } });
            }
        }

        for (let r = 0; r < rounds.length; r++) {
            const rd = rounds[r];
            const mk = getMonthKey(rd.user.time);

            if (!currentChunk || currentChunk.monthKey !== mk || currentChunk.messages.length >= 30) {
                if (currentChunk) {
                    if (!monthBuckets[currentChunk.monthKey]) monthBuckets[currentChunk.monthKey] = [];
                    monthBuckets[currentChunk.monthKey].push(currentChunk);
                }
                currentChunk = {
                    id: 'tx_import_' + Date.now().toString(36) + '_' + r,
                    timestamp: rd.user.time || new Date().toISOString(),
                    messages: [],
                    monthKey: mk
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

        // 写入 + 去重
        const months = Object.keys(monthBuckets).sort();
        let sessionNew = 0;
        for (const month of months) {
            const fp = path.join(TRANSCRIPTS_DIR, month + '.json');
            const existing = loadMonthFile(fp);

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
                return {
                    id: c.id,
                    timestamp: c.timestamp,
                    end_time: c.end_time || c.timestamp,
                    platform: 'import',
                    topic_boundary: c.messages.length >= 30,
                    messages: c.messages,
                    chunk_summary: (firstUser.substring(0, 30) + ' → ' + firstAi.substring(0, 30)).trim(),
                    content: content.substring(0, 2000),
                    tags: [],
                    expires_at: null
                };
            });

            const all = [...existing, ...processed];
            saveMonthFile(fp, all);
            sessionNew += processed.length;
            totalNew += processed.length;
            if (processed.length > 0) {
                console.log(`  📁 ${month}: 新增 ${processed.length} 个`);
            }
        }
        if (sessionNew > 0) console.log(`  ✅ 会话完成: 新增 ${sessionNew} 个 chunk`);
    }

    console.log(`\n✅ 全部导入完成，共新增 ${totalNew} 个对话 chunk`);

    // ---- 向量 ----
    if (EMBEDDING_API_KEY && totalNew > 0) {
        console.log('🧲 生成向量...');
        const embCache = loadEmbeddingsCache();
        let embNew = 0;
        for (let y = 2025; y <= 2026; y++) {
            for (let m = 1; m <= 12; m++) {
                const month = `${y}-${String(m).padStart(2, '0')}`;
                const fp = path.join(TRANSCRIPTS_DIR, month + '.json');
                if (!fs.existsSync(fp)) continue;
                const chunks = loadMonthFile(fp);
                for (const c of chunks) {
                    if (embCache[c.id]) continue;
                    const text = (c.chunk_summary || '') + ' ' + (c.content || '').substring(0, 400);
                    if (!text.trim() || text.trim().length < 5) continue;
                    const emb = await getEmbedding(text, EMBEDDING_API_KEY).catch(() => null);
                    if (emb) { embCache[c.id] = emb; embNew++; }
                    if (embNew > 0 && embNew % 5 === 0) await new Promise(r => setTimeout(r, 500));
                }
            }
        }
        saveEmbeddingsCache(embCache);
        console.log(`✅ 向量: 新增 ${embNew} 条`);
    } else if (!EMBEDDING_API_KEY) {
        console.log('⚠️ 跳过向量（设 EMBEDDING_API_KEY 以启用）');
    }

    console.log('\n🎉 全部完成！');
}

main();
