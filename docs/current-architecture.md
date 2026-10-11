# 溯星小屋当前架构

> 沈望 × 江鱼 · 私有 AI 伴侣与共创工作区
> 最后核对：2026-10-03

本文记录稳定的模块边界、数据流和运维入口，不使用容易失效的源码行号。具体行为以测试和当前代码为准。

## 系统概览

| 层 | 当前实现 |
| --- | --- |
| Web 服务 | Node.js + Express，入口为 `server.js` |
| 实时通信 | `ws` WebSocket；聊天通知与 Codex 任务事件共用浏览器连接 |
| 前端 | 原生 HTML、CSS、JavaScript，主入口为 `public/index.html` |
| 持久化 | `data/` 下的 JSON 文件；不使用数据库 |
| 对话模型 | 浏览器选择供应商和模型，服务器统一补充受控上下文并转发 |
| Codex | 服务端 `codex app-server`，浏览器不持有 Codex 登录凭据 |
| 部署 | GitHub Actions 通过 SSH 发布到 `/opt/syzygy`，systemd 运行 `syzygy.service` |

仓库支持并实际验证 Node.js 22 和 24。浏览器冒烟测试使用 Puppeteer Core 与本机 Chromium；Node.js 25/26 暂不在支持范围内。

## 代码边界

```text
server.js                    Express 组装、API 路由、聊天和记忆编排
codex-bridge.js              Codex app-server 生命周期与事件桥接
codex-workspace.js           共创设置、任务记录和权限边界
shen-settings.js             沈望 A/B prompt 与当前版本设置
web-config-store.js          主聊天配置缓存、串行事务与原子写入
chat-history.js              主聊天历史分页与局部保存合并
provider-cache.js            供应商请求缓存适配
model-list-cache.js          模型列表的限时缓存与后台刷新
context-budget.js            上下文预算、投影和诊断
rolling-context.js           长对话滚动摘要及覆盖证明
tool-policy.js               按意图选择工具并保持权限边界
music*.js                    音乐、播放权与一起听房间
memory-*.js                  记忆事件、合并、诊断与写入辅助
relationship-*.js           关系状态和关系反思
reality-events.js            现实事件与里程碑
xhs-*.js                     小红书读取和散步流程
public/                      浏览器页面、脚本、样式、字体与图片
test/                        Node 行为测试和源码级回归测试
scripts/                     浏览器冒烟与运维辅助脚本
```

`server.js` 仍然较大，但关键状态写入、上下文、Codex、音乐、记忆和工具策略已经拆为独立模块。新增逻辑优先放进现有领域模块。

## 浏览器结构

首页是唯一的房间入口：

- **通讯小屋**进入 `sec-chat`，与沈望对话；右上角齿轮进入 `sec-shen-settings`，管理 A/B prompt。
- **共创工作区**进入 `sec-dev`，与 Codex 讨论或明确授权执行；右上角齿轮进入 `sec-codex-settings`。

通讯和共创各自保存当前视图状态。普通共创消息默认只读；只有用户明确开启执行权限的任务可以修改工作区。

主页面还包含收藏、Flo、账本、日历、相册、状态、工作记录和 TT 记忆抽屉。账本、日历、相册与状态在第一次进入时从 `home-tools.js` 和 `home-tools.css` 按需加载。

| 前端文件 | 职责 |
| --- | --- |
| `public/index.html` | 主页面结构和所有主视图容器 |
| `public/script.js`、`style.css` | 导航、通讯聊天、配置同步、主视觉和响应式 |
| `public/workroom-pages.js/css` | 共创对话、Codex 设置、工作记录和 TT 抽屉 |
| `public/shen-settings-page.js` | 沈望 A/B prompt 设置页 |
| `public/home-tools.js/css` | 次级首页工具的按需资源 |
| `public/music-player.js/css` | 音乐播放器与一起听 |
| `public/context-*.js` | 上下文缓存与连续性状态 |
| `public/chat-window-context.js` | 图片保留窗口和消息投影 |
| `public/thinking-parser.js` | 推理内容隐藏与展示解析 |
| `public/vendor/marked.min.js` | 本地 Markdown 渲染器 |

`public/sw.js` 只负责 PWA 安装生命周期，目前不做离线缓存。

## 核心数据流

### 通讯聊天

```text
输入文字/图片
  → public/script.js 组装当前会话窗口
  → POST /v1/chat/completions 或 /via/:platform/v1/chat/completions
  → server.js 校验请求并清洗历史
  → 记忆、关系状态、现实事件、待办和工具策略按需注入
  → provider-cache/context-budget 形成最终请求
  → 上游模型流式返回
  → thinking-parser 清理展示文本
  → 浏览器保存局部历史窗口，web-config-store 串行合并并原子落盘
```

主聊天首次只读取最近一页历史；滚动到顶部再分页读取。局部保存包含稳定消息 ID、版本和窗口边界，服务器不会用未加载的短窗口覆盖更早历史。

### 共创工作区

```text
浏览器共创消息
  → WebSocket
  → codex-bridge.js
  → VPS 上的 codex app-server
  → 任务快照和事件回传浏览器
  → workroom-transcripts.js 保存完整轮次
```

Codex 登录保存在 VPS 的 `CODEX_HOME`。服务端对子进程环境做白名单处理，Syzygy 的密码、API key、SSH 凭据和 systemd 环境不会传给 Codex。部署和 Codex 写任务使用同一文件锁，部署会等正在保存的回复结束。

### 设置与记忆

- `shen-settings.js` 保存沈望 A/B prompt、当前启用版本和修订号。
- `codex-workspace.js` 保存 Codex 模型、思考程度和自定义 prompt。
- 设置接口用修订号拒绝旧页面覆盖新值；浏览器保留未保存草稿。
- 记忆写入先形成可追踪事件，再由整理器决定进入长期记忆、生活碎屑、现实事件或关系过程。
- Zep 不是默认依赖；只有显式配置 `ZEP_URL` 时才启用兼容读取。本地 transcript 和 `web_config.json` 始终是通讯保存路径。

### 记忆浏览与生活碎屑读取

- 长期记忆页按存放范围（长期、卡带、冰封、全部范围）浏览，写入来源独立筛选；支持记录时间与修改时间排序，不使用热度排序或新增内容标签分类。
- “AI 整理建议”触发存量合并建议扫描，在收纳室处理建议；浏览页面不会自动清理数据。沈望现有的自主写入、更新和用户编辑入口继续共用原存储。
- `crumb-recall.js` 负责生活碎屑的只读检索，查正文、原话与既有索引字段。静默记录、超过七天但尚未切换状态的记录、缺少状态的旧记录均可检索；默认排除归档、撤回及已合并记录。
- 两条聊天入口均使用 `buildCrumbRecallContext` 注入历史资料；普通话题最多两条，明确询问碎屑最多八条，按相关性优先，不根据召回次数排序，也不在读取时改写碎屑文件。
- 内置 `search_crumbs` 让沈望主动检索或翻页，支持中国时间日期和显式查询归档记录；返回匹配总数、记录 ID、原话和日期。没有匹配与读取失败分开报告，不能据此声称从未保存。
- 此路径不要求 embedding 服务在线；长期记忆原有的检索机制保持不变。

## 数据与写入安全

运行时数据全部位于 `data/`，并被 Git 忽略。常见文件包括 `web_config.json`、`shen_settings.json`、Codex 设置与工作记录、长期记忆、记忆事件、角色扮演归档、收藏、待办、账本和音乐库。

不要把 `data/`、`.codex/`、systemd 环境文件或 token 提交到 Git。核心配置修改应经过对应存储模块的事务队列和同目录临时文件替换，避免并发写入或进程中断留下半份 JSON。

## 部署

### 完整自动部署

向 `main` 推送会触发 `.github/workflows/deploy.yml`：

1. 在 GitHub Runner 上先运行 Codex 部署协调测试。
2. SSH 到 VPS，取得 `data/codex-deployment.lock` 独占锁。
3. 将 `/opt/syzygy` 更新到 `origin/main` 并安装生产依赖。
4. 维护所需 systemd/nginx 配置并重启 `syzygy.service`。
5. 同时检查 systemd 活跃状态和 `https://syrenth.uk/health`。

GitHub Actions 显示成功，才代表本次提交已经通过服务器重启和线上健康检查。

### 无重启静态发布

`.github/workflows/deploy-static.yml` 只能手动触发，用于纯 `public/` 改动。`.github/static-assets.txt` 是显式资源清单，并由测试强制与所有受 Git 跟踪的 `public/` 文件完全一致。工作流先发布依赖，最后再替换 `index.html`，避免入口页引用尚未上传的新资源。

新增或删除受版本控制的 `public/` 文件时，必须同步更新该清单；否则测试和静态发布都会在上传前失败。

## 本地验证

```bash
npm test
npm run test:browser:startup
npm run test:music:browser
```

`npm test` 是不接触真实账号的主回归套件。`test:browser:startup` 使用真实 Chromium 验证首页启动、桌面/手机导航、按需资源和低动态模式。

## 稳定约束

1. 保留长期记忆和记忆收件箱页面及其数据兼容。
2. 保留本地 transcript / `web_config.json`；停用 Zep 不得影响通讯保存。
3. 旧 JSON 缺少新字段时使用安全默认值，不做破坏性迁移。
4. 普通共创消息维持只读，只有明确授权的任务可以修改项目。
5. 不在浏览器或 Codex 子进程中暴露服务端密钥。
6. 部署必须等待 Codex 写任务释放锁，并以线上健康检查作为成功条件。
7. 新增前端资源时同时更新静态资源清单与浏览器测试。
