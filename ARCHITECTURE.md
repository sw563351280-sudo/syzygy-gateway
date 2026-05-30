# 溯星小屋 (Syzygy Gateway) — 项目架构文档

> 沈望 × 江鱼 · AI 伴侣聊天系统
> 生成时间: 2026-05-30 | 最后更新: 收藏功能上线后

---

## 1. 项目概览

| 项目 | 详情 |
|------|------|
| 名称 | 溯星小屋 (Syzygy Gateway) |
| 角色 | 沈望（AI伴侣）、江鱼（用户） |
| 后端 | Node.js + Express，单文件 `server.js` (~216KB) |
| 前端 | 原生 HTML/CSS/JS，`public/index.html` + `script.js` + `style.css` |
| 存储 | JSON 文件 (`data/` 目录)，无数据库 |
| 向量引擎 | SiliconFlow Embedding API (`BAAI/bge-m3`, `BAAI/bge-large-zh-v1.5`) |
| 对话存储 | Zep（已废弃，指向 `127.0.0.1:9999` 快速失败） |
| AI 中转 | msui (msuicode.com) / dzzi / ekan / orange / 68886868 |
| 部署 | VPS (Contabo, 德国)，GitHub Actions 自动部署到 `/opt/syzygy` |
| 进程管理 | systemd (`syzygy.service`) |
| 域名 | `https://syrenth.uk/`，Cloudflare CDN |
| 端口 | 8080（systemd 设 `PORT=8080`），SSH端口 2222 |

---

## 2. 目录结构

```
/opt/syzygy/                        # VPS 部署路径 (GitHub Actions 同步)
├── server.js                       # 全部后端逻辑 (~6000行, ~216KB)
├── system_prompt.txt               # 沈望人格 prompt (~325行)
├── model_prompts.json              # 模型专属 prepend 指令 (gemini/claude/deepseek)
├── package.json                    # 依赖: express, ws, marked, etc.
├── Dockerfile                      # (已废弃，Zeabur→Contabo)
├── zbpack.toml                     # (已废弃)
├── CLAUDE.md                       # AI 助手的项目说明
├── migrate_step1.js               # 迁移脚本1: memory_blocks→long_term
├── migrate_step2.js               # 迁移脚本2: 补全type/valence
├── migrate_step2_fix.js           # 迁移脚本2修复版
├── p0b_reset_pinned.js            # 重置pinned字段脚本
├── .github/workflows/
│   └── deploy.yml                  # GitHub Actions → SSH → VPS 自动部署
├── node_modules/                   # npm 依赖
├── data/                           # JSON 数据文件 (被 .gitignore 忽略)
│   ├── web_config.json             # 聊天会话、消息历史 (核心)
│   ├── long_term_memories.json     # 动态长期记忆
│   ├── memory_blocks.json          # 静态核心记忆 (沈望和江鱼基础设定) [旧]
│   ├── roleplay_archives.json      # RP 角色扮演记忆
│   ├── deep_archive.json           # 归档（冰封）记忆
│   ├── embeddings_cache.json       # 向量缓存
│   ├── user_profile.json           # 江鱼用户画像
│   ├── dream_logs.json             # Dream 整理日志
│   ├── favorites.json              # 收藏对话 (新)
│   ├── weekly_summaries.json       # 每周摘要
│   ├── monthly_summaries.json      # 每月摘要
│   ├── daily_pages.json            # 每日页面
│   ├── last_interaction.json       # 最后交互时间 (主动消息用)
│   ├── session_counters.json       # 会话计数器
│   ├── phone_cache.json            # 手机活动缓存
│   ├── tools_config.json           # 工具开关配置
│   └── web_config.json             # 聊天数据 (CONFIG_FILE, chatSessions)
├── public/
│   ├── index.html                  # 前端页面 (~200行)
│   ├── script.js                   # 前端逻辑 (~1650行)
│   ├── style.css                   # 样式 (~1470行)
│   ├── memory.html                 # 星渡记忆管理页面
│   ├── sw.js                       # PWA Service Worker
│   └── icon-192.png                # PWA 图标
```

---

## 3. 核心数据流

### 3.1 聊天流程

```
用户输入 → public/script.js (sendChat)
  → 组装 messages 数组（system prompt + 记忆注入 + 历史 + 用户消息）
  → POST /v1/chat/completions 或 /via/:platform/v1/chat/completions
  → server.js handleChat() (line ~1993)
    → resolveApiUrl() 选择中转站 (msui/dzzi/ekan/orange/68886868)
    → 注入系统 prompt (system_prompt.txt + 记忆雷达 + 用户画像 + 时间环境)
    → 注入工具列表 (fetch_txt, bark_push, check_phone, MCP filesystem等)
    → 转发到 AI API (SSE 流式或非流式)
    → 解析 <SAVE_MEMORY> 标签 → smartMemoryWrite()
    → saveToZepWithCounter() → updateLastInteraction()
    → tryAutoDream() (检测睡眠关键词)
  → SSE 流式返回前端
  → renderChatMessages() 重新渲染
```

### 3.2 记忆系统

```
记忆类型:
  memory_blocks.json    → 静态核心记忆 (沈望+江鱼基础设定, 不可变)
  long_term_memories.json → 动态长期记忆 (AI提取+用户手动添加)
  roleplay_archives.json  → RP 游戏卡带记忆
  deep_archive.json     → 归档记忆 (过期/衰减后移入)

记忆生命周期:
  创建 → 初始 heat=0.5, activation_count=0
  召回 → scanAllRadars() → 命中后 heat↑, activation_count↑
  升级 → 高热度+跨话题召回 → expires_at=null (永久, pinned=true)
  衰减 → cleanAndArchiveMemories() → heat 衰减 → 过期 → 归档
  归档 → deep_archive.json

记忆雷达 (每次对话触发):
  scanAllRadars(userText)
    ├── scanMemoryRadar()     → 静态核心记忆 RRF搜索
    ├── scanLongTermRadar()   → 长期记忆 RRF搜索 + 热度分层注入
    ├── scanRoleplayRadar()   → RP卡带 RRF搜索
    └── surfaceUnresolvedMemories() → 未解决的高热度记忆(前2条)

RRF 搜索 (双路融合, rrfMergeSearch):
  _vectorRankSearch() + _keywordRankSearch() → RRF 融合 → 热度/arousal加权 → topK
```

### 3.3 Dream（梦境整理）

```
触发方式:
  1. 自动: SLEEP_KEYWORDS (晚安/去睡吧等) → tryAutoDream()
  2. 定期: cleanAndArchiveMemories() 发现活跃记忆≥30条+距上次Dream>7天
  3. 手动: POST /trigger-dream

Dream 流程 (backgroundMemoryDream):
  整理层: cleanAndArchiveMemories() → 过期清理
  固化层: AI(Gemini via msui) 提取永久记忆 + RP记忆 → smartMemoryWrite()
  生长层: AI 前瞻洞察 (foresight)

API: POST /trigger-dream?pwd=xxx
```

### 3.4 用户画像更新

```
触发: 每次聊天后自动 (updateUserProfile())
流程: 取最近40条对话 → DeepSeek-v4-pro (msui) → 提取 basic_info/communication_style/recent_focus/long_term_values
存储: data/user_profile.json
注入: 每次聊天 + 主动消息的 system prompt 中
```

---

## 4. 关键代码路径 (server.js 行号参考)

### 4.1 初始化 & 常亮 (line 1-130)

| 行号 | 内容 |
|------|------|
| 1-5 | require (express, http, ws, fs, path) |
| 20-42 | API_ROUTES (中转站 URL 映射), resolveApiUrl() |
| 47-53 | model_prompts.json 加载, getModelPromptConfig() |
| 59-124 | DATA_DIR, 所有 *_FILE 常量, load/save函数 |
| 93-108 | lastInteractionTime/lastProactiveTime 管理 |
| 151-215 | getEmbedding() — SiliconFlow 多provider降级 |
| 217-296 | ensureEmbedding(), reindexAllEmbeddings() |
| 297-332 | rrfMergeSearch() — 向量+关键词双路RRF融合 |

### 4.2 记忆管理 (line 750-980)

| 行号 | 内容 |
|------|------|
| 752-806 | scanLongTermRadar() — 热度分层注入 (heat>0.7全文本, heat>0.3模糊) |
| 811-818 | scanRoleplayRadar() — RP卡带雷达 |
| 820 | EMOTION_KEYWORDS — 情绪权重表 |
| 870-890 | surfaceUnresolvedMemories() — 高热度未解决记忆 |
| 892-974 | cleanAndArchiveMemories() — 衰减/过期/归档 + 自动Dream触发 |
| 977-978 | SAVE_MEMORY 标签提取正则 |
| 1082-1090 | scanAllRadars() — 四路雷达聚合 |

### 4.3 工具系统 (line 1350-1578)

| 行号 | 内容 |
|------|------|
| 1353-1362 | BUILTIN_TOOLS — 7个内置工具 (fetch_txt/html/json/github, exec, bark_push, check_phone) |
| 1363-1369 | 工具开关配置 (data/tools_config.json) |
| 1371-1409 | filterRelevantTools() — 按关键词评分筛选 |
| 1412-1540 | MCP Server 管理 (filesystem MCP: /opt/syzygy 目录读写) |

### 4.4 Dream & 画像 (line 1160-1750)

| 行号 | 内容 |
|------|------|
| 1161-1187 | tryAutoDream() — 睡眠关键词触发 |
| 1524-1578 | buildDreamPrompt() — Dream 固化层 system prompt |
| 1580-1660 | updateUserProfile() — AI 提取江鱼画像 |
| 1662-1758 | backgroundMemoryDream() — Dream 三阶段 (整理/固化/生长) |

### 4.5 主动消息 (line 1761-1910)

| 行号 | 内容 |
|------|------|
| 1761-1811 | generateProactiveMessage() — 三层策略 (基础概率+时段权重+硬兜底) |
| 1813-1816 | 环境变量读取 (PROACTIVE_MODEL/URL/KEY) |
| 1820-1838 | 读取最近25条对话 (web_config.json) |
| 1841-1854 | 手机活动查询 (Supabase, 白天+沉默>1.5h) |
| 1858-1877 | 记忆雷达 + 用户画像注入 |
| 1881-1901 | API调用 + Bark推送 + WebSocket广播 + 插入聊天记录 |
| 1902-1910 | insertProactiveToConfig() — 写入 web_config.json |
| 3261-3280 | /trigger-proactive 端点 (强制跳过冷却+概率) |

### 4.6 收藏夹 (新增)

| 行号 | 内容 |
|------|------|
| 3650-3680 | POST/GET/DELETE /api/favorites |

### 4.7 主聊天端点 (line 1991-2320)

| 行号 | 内容 |
|------|------|
| 1993 | POST ['/v1/chat/completions', '/via/:platform/v1/chat/completions'] |
| 1995-2024 | 消息清洗 (去system/tool, 清洗历史图片) |
| 2030-2050 | Zep 向量搜索 (已走本地127.0.0.1快速失败) |
| 2080-2140 | 记忆雷达注入 |
| 2150-2190 | 构建最终messages数组 |
| 2185 | resolveApiUrl() 选择中转站 |
| 2200-2320 | AI API调用 + SSE流式返回 + 工具调用循环 |

### 4.8 其他 API 端点

| 行号 | 端点 | 说明 |
|------|------|------|
| ~2476 | POST /api/long-term-memories | 创建记忆 |
| ~2528 | PATCH /api/long-term-memories/:id | 更新记忆(含resolved字段) |
| ~2569 | DELETE /api/long-term-memories/:id | 删除记忆 |
| 3148 | GET /memory-manager | 记忆管理页面 |
| 3152 | GET /long-term | 长期记忆页面 |
| 3178 | POST /trigger-cleanup | 手动清理 |
| 3297 | POST /api/web-chat | Web Chat API (密码保护) |
| 3550-3576 | /diary-logs, /diary/add, /diary/:id, /diary/ai-write | 日记CRUD |
| 3634-3635 | /capsule-logs, /capsule/add | 时光胶囊 |
| 3652-3670 | /api/sync-config | 云端配置同步(POST保存,GET读取) |
| 3704 | server.listen() | 服务启动, setInterval/setTimeout |

---

## 5. 前端架构 (public/)

### 5.1 页面切换

```
goView(viewId) → 切换 .section.active
  home → #sec-home      首页仪表盘
  chat → #sec-chat      聊天页面 (fixed全屏)
  data → #sec-data      中枢设置
  favorites → #sec-favorites  收藏夹 (新增)
```

### 5.2 聊天数据结构 (web_config.json)

```js
{
  chatSessions: [{
    id: 'main',           // 会话ID
    name: '主频道',        // 会话名
    messages: [{
      role: 'user' | 'assistant',
      versions: [{
        content: string,       // 消息内容
        image: string|null,    // base64图片
        thinking: string|null, // 思考过程
        time: 'HH:MM',         // 显示时间
        fullTime: ISO8601,     // 完整时间戳
        model: string          // 使用的模型
      }],
      activeVersion: 0,     // 当前选中版本索引
      _zepDirty: boolean    // 待同步标记
    }],
    messages: [...]
  }],
  activeChatId: 'main'
}
```

### 5.3 收藏数据结构 (favorites.json)

```json
{
  "id": "fav_<timestamp-base36>",
  "timestamp": "ISO8601",
  "messages": [
    { "role": "user", "content": "用户原文" },
    { "role": "assistant", "content": "AI回复原文" }
  ],
  "note": "用户备注",
  "tags": ["标签1", "标签2"]
}
```

### 5.4 前端关键函数

| 函数 | 说明 |
|------|------|
| goView(viewId) | 页面切换 |
| renderChatMessages() | 重新渲染所有消息气泡 |
| sendChat() | 发送消息+流式接收 |
| openFavDialog(index) | 打开收藏弹窗 |
| generateProactiveMessage() | 后端: 主动消息生成 |

### 5.5 WebSocket

```
wss.on('connection') → wsClients.add()
wsBroadcast(data, excludeTabId) → 广播给所有客户端
消息类型:
  proactive_message → 前端弹出沈望主动消息通知
  dream_done → Dream 完成通知
  new_message → 新消息通知
```

---

## 6. 环境变量 (systemd syzygy.service)

| 变量 | 说明 |
|------|------|
| PORT | 监听端口 (8080) |
| ROUTER_API_KEY | msui 主聊天 key (含 Bearer 前缀) |
| EMBEDDING_API_KEY | SiliconFlow 向量嵌入 API key |
| MEMORY_PASSWORD | 管理接口密码 |
| PROACTIVE_KEY | 主动消息 API key (msui) |
| PROACTIVE_MODEL | 主动消息模型名 (claude-opus-4-6) |
| PROACTIVE_URL | 主动消息 API 地址 |
| DREAM_API_KEY | Dream 固化层 key (msui) |
| DZZI_API_KEY | 已废弃 — 有 typo 导致 401，已切 msui |
| SUPABASE_KEY | Supabase 手机活动数据库 anon key |

---

## 7. 部署管线

```
开发机 → git push origin main
  → GitHub Actions (.github/workflows/deploy.yml)
    → SSH -p 2222 root@<VPS_IP>
      → cd /opt/syzygy
      → 备份本地修改 (沈望通过MCP改的文件)
      → git fetch origin main
      → git reset --hard origin/main
      → npm install --production
      → 恢复本地修改
      → systemctl restart syzygy.service
```

---

## 8. 关键约束 (CLAUDE.md 原文)

1. 记忆库"原始记录栏"(/memory-manager) 必须保留
2. 长期记忆页面(/long-term) 必须保留且正常
3. SAVE_MEMORY 标签机制必须正常
4. RP 游戏卡带系统必须正常
5. Zep 对话存储不能断
6. arousal + activation_count 字段保留，在其上扩展
7. JSON 文件存储方式不变（不换数据库）
8. 每次只改一个功能，改完告诉怎么测试
9. 新功能加开关（出问题能关）
10. 旧数据必须兼容（缺失字段给默认值）
11. 改之前先说改哪里，同意后再动手

---

## 9. 日常运维命令

```bash
# VPS 服务管理
systemctl status syzygy.service      # 查看服务状态
journalctl -u syzygy.service -n 50   # 最近50行日志
systemctl restart syzygy.service     # 重启
systemctl daemon-reload              # 重新加载systemd配置

# 测试主动消息
curl "https://syrenth.uk/trigger-proactive?pwd=<密码>"

# 测试收藏API
curl "https://syrenth.uk/api/favorites"

# 查看 systemd 配置
cat /etc/systemd/system/syzygy.service
```

---

## 10. 已知问题 & 技术债

| 问题 | 说明 |
|------|------|
| DZZI_API_KEY 有 typo | 小写 `r` vs 大写 `R`，系统已切换 msui 不再使用 |
| Zep 已废弃 | 指向 127.0.0.1:9999 快速失败，对话存在本地 web_config.json |
| server.js 单文件巨大 | ~6000行，后续应考虑拆分模块 |
| 无数据库 | JSON 文件读写线程安全风险(当前 Node 单线程安全) |
| 无认证体系 | 管理接口只有 MEMORY_PASSWORD 简单密码 |
| Cloudflare 超时 | 主动消息触发耗时可能超 CF 默认超时 (但 setInterval 不受影响) |
| 主动消息概率 | 深夜(0-7点)概率被压到9%，手动触发已强制跳过 |

---

## 11. 常用链接

| 名称 | 地址 |
|------|------|
| 溯星小屋 | https://syrenth.uk/ |
| GitHub 仓库 | https://github.com/sw563351280-sudo/syzygy-gateway |
| GitHub Actions | https://github.com/sw563351280-sudo/syzygy-gateway/actions |
| Cloudflare | syrenth.uk 的 DNS/CDN |
| msui API | https://www.msuicode.com/v1/chat/completions |
