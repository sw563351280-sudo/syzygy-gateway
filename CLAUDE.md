# CLAUDE.md — 溯星小屋记忆系统升级指南

> 📖 详细架构文档见 [ARCHITECTURE.md](./ARCHITECTURE.md) — 包含完整目录结构、代码行号参考、数据流、API端点、前端函数、环境变量等。

## 项目简介
这是"溯星小屋"（Syzygy Gateway），一个 AI 伴侣聊天系统。
角色叫"沈望"，用户叫"江鱼"。
后端是单文件 Node.js + Express（server.js），存储用 JSON 文件，部署在 Zeabur。

## 技术栈
- 后端：Node.js + Express，全部逻辑在 server.js 里
- 存储：JSON 文件（data/ 目录下），不是数据库
- 向量：SiliconFlow embedding API
- 对话历史：Zep 云端存储
- 前端：public/index.html + script.js + style.css
- 部署：Zeabur（Docker）

## 关键文件
- server.js — 全部后端逻辑（记忆存储、搜索、prompt组装、聊天转发）
- memory_blocks.json — 静态核心记忆（沈望和江鱼的基础设定）
- system_prompt.txt — 沈望的人格 prompt
- public/index.html — 前端页面
- public/script.js — 前端逻辑
- data/long_term_memories.json — 动态长期记忆
- data/roleplay_archives.json — RP 游戏卡带记忆
- data/deep_archive.json — 归档（冰封）记忆
- data/embeddings_cache.json — 向量缓存

## 🚨 绝对不能破坏的东西
1. 记忆库的"原始记录栏"（/memory-manager 页面）必须保留
2. 长期记忆页面（/long-term）必须保留且正常工作
3. SAVE_MEMORY 标签机制必须正常工作
4. RP 游戏卡带系统必须正常工作
5. Zep 对话存储不能断
6. 现有的 arousal 和 activation_count 字段保留，在上面扩展
7. JSON 文件存储方式不变（不要换成数据库）

## 🔒 改动规则
1. 每次只改一个功能，改完告诉我怎么测试
2. 新功能可以加开关（出问题能关掉）
3. 旧数据必须兼容（现有记忆没有新字段时给默认值）
4. 改之前先说你要改哪些地方，我同意了再动手
5. server.js 很长，改的时候说清楚在哪个函数附近

## 📚 参考项目
/references/kiwi-mem/ 下是参考的开源项目 kiwi-mem。
借鉴它的算法思路，但用我的技术栈（Node.js + JSON文件）重写。
不要直接复制它的 Python 代码。
