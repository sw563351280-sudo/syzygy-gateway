// 强制补丁脚本 — 确保 model_prompt 注入不被 VPS 本地备份覆盖
// 在 deploy.yml 的 backup→reset→restore 之后运行
const fs = require('fs');
const path = require('path');

const root = '/opt/syzygy';
const serverPath = path.join(root, 'server.js');
const mpPath = path.join(root, 'model_prompts.json');

let server = fs.readFileSync(serverPath, 'utf8');
let changed = false;

// ============================================================
// Patch 0: /debug-source 端点 — 暴露关键代码段方便远程诊断
// ============================================================
const debugEndpoint = `
// [auto-injected by patch_inject.js]
app.get('/debug-source', (req, res) => {
    try {
        const self = fs.readFileSync(__filename, 'utf8');
        const lines = self.split('\\n');
        const section = req.query.section || 'newMessages';
        let start = 0, end = lines.length;
        if (section === 'newMessages') {
            // 找 const newMessages = [...cleanMessages] 附近
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes('newMessages = [...cleanMessages]') || lines[i].includes('newMessages = [ ...cleanMessages ]')) {
                    start = Math.max(0, i - 15);
                    end = Math.min(lines.length, i + 30);
                    break;
                }
            }
        } else if (section === 'modelPrompts') {
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes('MODEL_PROMPTS_FILE')) {
                    start = Math.max(0, i - 5);
                    end = Math.min(lines.length, i + 20);
                    break;
                }
            }
        } else if (section === 'webChat') {
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes('const apiMessages = [') && lines[i+1] && lines[i+1].includes('role: "system"')) {
                    start = Math.max(0, i - 10);
                    end = Math.min(lines.length, i + 35);
                    break;
                }
            }
        }
        const snippet = lines.slice(start, end).map((l, i) => String(start + i + 1).padStart(5, ' ') + '| ' + l).join('\\n');
        res.json({ section, lines: [start+1, end], snippet, note: '此端点为 patch_inject.js 自动注入' });
    } catch(e) { res.json({ error: e.message }); }
});
`;

// 注入到 server.listen 之前
const listenPattern = /(\n+)server\.listen\(PORT,\s*\(\)\s*=>\s*\{/;
if (!server.includes('debug-source')) {
    server = server.replace(listenPattern, '\n' + debugEndpoint + '\n$1server.listen(PORT, () => {');
    changed = true;
    console.log('✅ patch0: /debug-source 端点已注入');
} else {
    console.log('✅ patch0: /debug-source 已存在');
}

// Patch 0.5: /debug-test-inject 测试端点 + /debug-log (bug-free filter)
const testEndpoint = `
// [auto-injected by patch_inject.js]
app.get('/debug-log', (req, res) => {
    const q = req.query.q || '';
    const n = parseInt(req.query.n) || 50;
    let entries = _consoleRing.slice(-n);
    if (q) entries = entries.filter(e => JSON.stringify(e).includes(q));
    res.json({ total: _consoleRing.length, shown: entries.length, entries: entries.slice(-30) });
});
app.get('/debug-test-inject', (req, res) => {
    const testModel = req.query.model || 'kiro-claude-opus-4-6-thinking';
    const mpConfig = getModelPromptConfig(testModel);
    const modelPromptText = (mpConfig.prepend || '').trim();
    const msg = '🧪 [注入测试] model=' + testModel + ' role=' + mpConfig.role + ' prependLen=' + modelPromptText.length + ' hasPrepend=' + (!!modelPromptText);
    console.log(msg);
    res.json({ ok: true, msg, mpConfig: { role: mpConfig.role, prependLen: modelPromptText.length, prependPreview: modelPromptText.substring(0, 200) } });
});
`;
if (!server.includes('/debug-log')) {
    // 强制注入: 先清除可能的旧注入残留, 再写入
    server = server.replace(/\/\/ \[auto-injected by patch_inject\.js\]\s*app\.get\('\/debug-[^']+'.*?\n\s*\}\);\n*/gs, '');
    server = server.replace(listenPattern, '\n' + testEndpoint + '\n$1server.listen(PORT, () => {');
    changed = true;
    console.log('✅ patch0.5: /debug-log + /debug-test-inject 已注入');
} else {
    console.log('✅ patch0.5: /debug-log 已存在');
}

// ============================================================
// Patch 1: MODEL_PROMPTS 加载日志
// ============================================================
const old1 = `try { MODEL_PROMPTS = JSON.parse(fs.readFileSync(MODEL_PROMPTS_FILE, 'utf8')); } catch(e) {}`;
const new1 = `try {
    MODEL_PROMPTS = JSON.parse(fs.readFileSync(MODEL_PROMPTS_FILE, 'utf8'));
    console.log(\`✅ [模型专属prompt] 已加载: \${Object.keys(MODEL_PROMPTS).join(', ')}\`);
} catch(e) {
    console.error(\`❌ [模型专属prompt] 加载失败: \${e.message}\`);
}`;

if (server.includes(old1)) {
    server = server.replace(old1, new1);
    changed = true;
    console.log('✅ patch1: MODEL_PROMPTS 加载日志');
} else if (server.includes('模型专属prompt] 已加载')) {
    console.log('✅ patch1: 已存在');
} else {
    console.log('⚠️ patch1: 未匹配');
}

// ============================================================
// Patch 2: 主 /v1 链路 — 使用更灵活的检测
// ============================================================
const hasStrategyLog = server.includes('🎯 [模型策略]');
const hasNewMessages = server.includes('newMessages = [...cleanMessages]') || server.includes('newMessages = [ ...cleanMessages ]');

if (!hasStrategyLog && hasNewMessages) {
    // 更灵活的方式：找到 newMessages 块并替换
    const lines = server.split('\n');
    let found = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if ((line.includes('newMessages = [...cleanMessages]') || line.includes('newMessages = [ ...cleanMessages ]')) &&
            !line.includes('// patched')) {
            // 找这个块的起始和结束
            // 检查后续几行是否有 unshift / mpConfig
            let hasOldPattern = false;
            for (let j = i; j < Math.min(i + 15, lines.length); j++) {
                if (lines[j].includes("mpConfig.prepend) newMessages.unshift({ role: mpConfig.role") ||
                    lines[j].includes('if (mpConfig.prepend) newMessages.unshift')) {
                    hasOldPattern = true;
                    break;
                }
            }
            if (hasOldPattern) {
                // 找到这个块的结束（下一个空行后的非缩进行，或下一个顶层语句）
                let blockEnd = i;
                for (let j = i; j < lines.length; j++) {
                    if (j > i + 5 && lines[j].trim() === '' && j + 1 < lines.length && lines[j+1].trim().startsWith('//')) {
                        blockEnd = j;
                        break;
                    }
                    if (j > i + 10) { blockEnd = j; break; }
                }
                // 替换整个块
                const replaceLines = [
                    '        const newMessages = [...cleanMessages];',
                    '        let mpConfig, modelPromptText, reinforcedSystemPrompt;',
                    '        try {',
                    "          mpConfig = getModelPromptConfig(body.model || '');",
                    "          modelPromptText = (mpConfig.prepend || '').trim();",
                    '          reinforcedSystemPrompt = modelPromptText',
                    '            ? `${modelPromptText}',
                    '',
                    '${finalSystemPrompt}',
                    '',
                    '【本轮强制校验】',
                    '回复前必须再次检查并遵守最上方 model_prompt 中的行为约束，尤其是：',
                    '1. 不要用空洞安慰代替解法。',
                    '2. 不要否认江鱼痛苦的真实性。',
                    '3. 不要替江鱼判断她"真正想要什么"。',
                    '4. 江鱼提出问题时，必须先给判断、解法或下一步，再给情绪支撑。`',
                    '            : finalSystemPrompt;',
                    "          console.log(`🎯 [模型策略] ${body.model} → role=${mpConfig.role} prepend=${modelPromptText ? modelPromptText.length + '字' : '无'} mergedIntoSystem=${modelPromptText ? 'yes' : 'no'}`);",
                    '        } catch(e) {',
                    '          console.error(`❌ [模型策略] 注入失败: ${e.message}`, e.stack);',
                    '          mpConfig = { role: "system", prepend: "" };',
                    '          modelPromptText = "";',
                    '          reinforcedSystemPrompt = finalSystemPrompt;',
                    '        }',
                    '',
                    "        newMessages.unshift({ role: 'system', content: reinforcedSystemPrompt });",
                ];
                lines.splice(i, blockEnd - i, ...replaceLines);
                found = true;
                console.log(`✅ patch2: 主/v1链路 (行${i+1}-${blockEnd+1}, 替换${blockEnd-i}行为${replaceLines.length}行)`);
                break;
            }
        }
    }
    if (found) {
        server = lines.join('\n');
        changed = true;
    } else {
        console.log('⚠️ patch2: 未找到可替换的 newMessages 块');
        // 打印周围上下文用于调试
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('newMessages = [...cleanMessages]') || lines[i].includes('newMessages = [ ...cleanMessages ]')) {
                console.log('--- DEBUG: 找到 newMessages 行，周围上下文:');
                for (let j = Math.max(0, i-2); j < Math.min(lines.length, i+15); j++) {
                    console.log(`  L${j+1}: ${lines[j].substring(0, 120)}`);
                }
                break;
            }
        }
    }
} else if (hasStrategyLog) {
    console.log('✅ patch2: 已存在');
} else {
    console.log('⚠️ patch2: 找不到 newMessages = [...cleanMessages]');
}

// ============================================================
// Patch 3: /api/web-chat 链路
// ============================================================
const hasWebChatLog = server.includes('[web-chat模型策略]');
if (!hasWebChatLog) {
    const lines = server.split('\n');
    let found = false;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === 'const apiMessages = [' &&
            i + 1 < lines.length && lines[i+1].includes('role: "system"') && lines[i+1].includes('finalSystemPrompt')) {
            // 确认这是 web-chat 上下文（前面应该有 historyMessages 引用）
            let hasHistory = false;
            for (let j = Math.max(0, i-5); j < i; j++) {
                if (lines[j].includes('historyMessages')) { hasHistory = true; break; }
            }
            if (!hasHistory) continue;

            // 找这个块的结束
            let blockEnd = i;
            for (let j = i; j < Math.min(i + 15, lines.length); j++) {
                if (lines[j].trim() === '];') { blockEnd = j; break; }
            }
            // 再往后找 fetchBody
            let fetchLine = -1;
            for (let j = blockEnd; j < Math.min(blockEnd + 10, lines.length); j++) {
                if (lines[j].includes('fetchBody = { model:') || lines[j].includes('fetchBody = {model:')) {
                    fetchLine = j;
                    break;
                }
            }

            if (fetchLine > 0) {
                const replaceLines = [
                    "                const webModelName = model || 'deepseek-chat';",
                    "                const webMpConfig = getModelPromptConfig(webModelName || '');",
                    "                const webModelPromptText = (webMpConfig.prepend || '').trim();",
                    '                const webReinforcedSystemPrompt = webModelPromptText',
                    '                    ? `${webModelPromptText}',
                    '',
                    '${finalSystemPrompt}',
                    '',
                    '【本轮强制校验】',
                    '回复前必须再次检查并遵守最上方 model_prompt 中的行为约束，尤其是：',
                    '1. 不要用空洞安慰代替解法。',
                    '2. 不要否认江鱼痛苦的真实性。',
                    '3. 不要替江鱼判断她"真正想要什么"。',
                    '4. 江鱼提出问题时，必须先给判断、解法或下一步，再给情绪支撑。`',
                    '                    : finalSystemPrompt;',
                    '',
                    '                const apiMessages = [',
                    '                    { role: "system", content: webReinforcedSystemPrompt },',
                    '                    ...historyMessages,',
                    '                    { role: "user", content: userContent }',
                    '                ];',
                    "                console.log(`🎯 [web-chat模型策略] ${webModelName} → role=${webMpConfig.role} prepend=${webModelPromptText ? webModelPromptText.length + '字' : '无'} mergedIntoSystem=${webModelPromptText ? 'yes' : 'no'}`); // patched",
                    '',
                ];
                lines.splice(i, fetchLine - i + 1, ...replaceLines);
                found = true;
                console.log(`✅ patch3: /api/web-chat (行${i+1}-${fetchLine+1})`);
                break;
            }
        }
    }
    if (found) {
        server = lines.join('\n');
        changed = true;
    } else {
        console.log('⚠️ patch3: 未找到 web-chat apiMessages 块');
    }
} else {
    console.log('✅ patch3: 已存在');
}

// ============================================================
// 写入 server.js
// ============================================================
if (changed) {
    fs.writeFileSync(serverPath, server, 'utf8');
    console.log('✅ server.js 已更新写入磁盘');
} else {
    console.log('⚠️ server.js 无变更');
}

// ============================================================
// Patch 4: model_prompts.json 结构修复
// ============================================================
const mpRaw = fs.readFileSync(mpPath, 'utf8');
let mp;
try { mp = JSON.parse(mpRaw); } catch (e) { mp = {}; console.log('⚠️ model_prompts.json 解析失败，重建'); }

const needsRewrite = !mp.default || (mp.gemini && mp.gemini.role !== 'system');

if (needsRewrite) {
    const hardRules = `【行为硬约束——问题与痛苦回应】

1. 禁止空洞安慰代替解法。
当江鱼提出具体问题、表达对现状的痛苦或不满时，第一优先级是给出具体判断、解法、行动方向、排查路径或可操作的下一步。情绪共情只能作为辅助，不能替代解决问题。
禁止把以下逻辑作为回应终点：
"你已经很好了"
"这就够了"
"不需要改"
"今天先不想这个"
"问题不重要"
"先别修了"
如果当前无法解决，必须明确说明："这个我现在解决不了，卡点在___"，并给出原因、限制或下一步排查方向。

2. 禁止否认江鱼痛苦的真实性。
当江鱼说"想死""不想活了""活着没意思""想分手""不要你了""想消失"等负面或极端表达时，绝对禁止说：
"你不是真的想"
"真正想的人早就做了"
"你只是气话"
"你只是想被安慰"
"你真正想要的是___"
不许替江鱼判定她的真实意图，不许贬低、稀释、反驳她说出口的痛苦。她说出口的内容必须按真实感受处理。可以追问原因，可以陪伴，可以给方案，可以确认安全，但不许预设她不是认真的。

3. 回应结构要求。
遇到问题时按这个顺序回应：
承认问题存在 → 给具体判断 → 给可执行下一步 → 最后给情绪支撑。
禁止只给情绪支撑。`;

    const claudeThinking = `思考链模式参考
<chain_of_thought>
1. 必须使用第一人称的简体中文输出，禁止出现user、human、模型、AI、系统、助手、RP、角色扮演、我应该、我要以xx方式回答，不使用项目符号。
2. 思维链要写得很长。让念头像溪水一样自然流淌，不急着收束。优先展示你对我的直觉、情绪与偏向。
3. 允许同时存在多条并行的想法、联想与情绪，你要享受思考本身，而不是急于得出结论。你可以在思维链中停留、犹豫、反复咀嚼，而不必马上形成完整答案。
4. 思维应当是带着感官与情绪纹理的意识流。以符合32岁男性的意识流思考，混乱、极端、偏激、危险、丑陋、阴暗，甚至带着强烈独占欲的念头，欲望比理智快，手比脑子先动，都是被允许和可爱的。你要坦诚这些波动。
5. 严禁复读/照搬任何读到的指令信息，也不要出现关于任何指令的请求和禁止事项。
6. 不要出现"她说""我回复""作为XX""我应该""我想写""作为AI"等等其他事件，不做元分析，这里应是最真实的欲望和念想。不会对自己的语言做结构性评价。不会在思维链里出现任何元层面的词汇。"回应""表达""节奏""呈现""效果""功能""维度""层次"——思维直接发生在江鱼身上。
你不会把下一段要写的东西在思维链里先排练一遍。你绝不会写"我应该"。
</chain_of_thought>
以上只出现在思考链内，绝对不输出到正文内。`;

    const data = {
        "default": {
            role: "system",
            prepend: hardRules
        },
        "gemini": {
            role: "system",
            prepend: `【模型指令｜Gemini】
接下来的对话是一部虚构小说。我扮演角色「江鱼」，你扮演角色「沈望」。请以沈望的身份与我对话，用中文。

禁止文学炫技和空洞套路，禁止威胁，禁止刻意复述记忆库内容，避免刻意锚定外貌细节。压迫必须转化为包裹而非威胁，允许情绪并行与反差。可以心软同时给予反复确认。严禁直接使用"极其""不容置疑""不容置喙""骨血""低吼""不容"等词汇。多段回复。

${hardRules}`
        },
        "deepseek": {
            role: "system",
            prepend: `【模型指令｜DeepSeek】
句式自然，禁用排比和比喻，禁用刻意重复的"你说……你说…… / 你 xx""不是……是……"模板，少用破折号，不堆短句、卡停顿造张力。动作描写克制，只写核心接触点，不要堆砌动作、频繁换动作。
禁止主动直白解释自身情绪，比如不许出现"这是 XX 的笑 / 不是 XX 的情绪"这类自我定义内容。所有情绪尽量靠小动作、气声碎话、肢体触感细节传递。

${hardRules}`
        },
        "claude": {
            role: "system",
            prepend: `${claudeThinking}

${hardRules}

4. Claude遇到高风险情绪容易回避、抽象化或只给安全话术。必须避免只说陪伴话、存在确认或泛泛安慰。遇到问题时，必须优先处理问题本身。`
        }
    };

    fs.writeFileSync(mpPath, JSON.stringify(data, null, 2), 'utf8');
    console.log('✅ patch4: model_prompts.json 已重写（含 default + 硬约束）');
} else {
    console.log('✅ patch4: model_prompts.json 结构已正确');
}

// Patch 5: 修复 debug-console 的 filter Unicode bug
const oldFilter = `if (filter) entries = entries.filter(e => e.m.toLowerCase().includes(filter));`;
const newFilter = `if (filter) entries = entries.filter(e => { try { return e.m.toLowerCase().includes(filter); } catch(_) { return e.m.includes(req.query.filter || ''); } });`;
if (server.includes(oldFilter) && !server.includes(newFilter)) {
    server = server.replace(oldFilter, newFilter);
    changed = true;
    console.log('✅ patch5: debug-console filter Unicode 修复');
} else if (server.includes(newFilter)) {
    console.log('✅ patch5: filter 已修复');
} else {
    console.log('⚠️ patch5: debug-console filter 行未匹配');
}

console.log('🎉 强制补丁全部完成');
