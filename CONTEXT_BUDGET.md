# 上下文与费用优化框架

当前已接入被动费用观测、AIHubMix Claude 缓存格式适配、网页滚动摘要和动态资料预算，不承诺固定节省金额。观测和免费自检不调用模型；达到压缩阈值后的摘要会调用独立模型并产生费用。不会切换聊天模型或启动保温。

## 安全滚动摘要

网页正常发送和重新生成先免费读取 `/api/context-budget/capabilities`。仅 AIHubMix Claude 且服务器配置了摘要密钥时，使用 v1 上下文协议：网页把当前可用的完整历史和消息 ID 交给网关；网关存原文、生成摘要投影后再发给聊天模型。协议字段和 ID 不发送给供应商。未配置、旧服务器或检查失败时保留原来的历史窗口。

未压缩历史的粗估文本 token 达到 `CONTEXT_BUDGET_HISTORY_TOKENS`（默认12000）时，把较旧部分与旧累计摘要一起总结；保留约1500 token近期原文，至少2条完整消息，尽量从user开始。不硬截断长消息或回复。摘要输出上限1400 token，验证后摘要粗估上限1800 token；空内容、非stop结束、工具调用、未缩小输入均拒绝提交。

`rolling-context.js` 每个会话/渠道/模型单独串行处理，使用消息ID与内容版本验证摘要覆盖前缀。当前输入发生编辑、删除或起点变化时，旧覆盖失效，从当前原文重建。重生成较早的回复也必须重新匹配，不能使用未来消息的摘要。不自动拼回被用户删除的消息。

原文版本、当前快照、摘要及覆盖版本一起写入 `data/rolling-context/`，临时文件写入并fsync后原子替换。原文必须先落盘才发摘要请求；存储失败回退全部输入。摘要失败保留旧有效摘要及所有未总结原文，5分钟内不自动重试；单次请求超时45秒，不做供应商重试。摘要没有tools、不写聊天气泡、不执行隐藏标签。日志只包含数值、状态、结束原因和白名单用量字段。

前端原有云同步仍只保留最近200条。新归档保留此功能启用后收到的文本版本，不是历史图片备份，也不追溯恢复启用前已丢弃的消息。浏览器重载后可用历史起点若变化，保守地使旧摘要失效重新总结，而不是猜测缺失部分。这会造成一次重建成本；跨进程多实例共享状态文件尚不支持，应由单个Node服务管理该目录。

摘要配置：`CONTEXT_SUMMARY_API_KEY` → `DREAM_API_KEY` → `ROUTER_API_KEY`；默认沿用旧摘要端点 `https://www.msuicode.com/v1/chat/completions`、模型 `gemini-3-flash-preview-thinking`。可用 `CONTEXT_SUMMARY_URL`、`CONTEXT_SUMMARY_MODEL` 覆盖。免费检查仅确认配置存在，不证明供应商可用或有余额。旧 `/api/sync-config` 保存记录时自动生成分段摘要的入口已关闭，旧摘要文件保留。摘要费用单列在 `[ContextBudget] event=summary`，尚未合并到聊天模型的小计，不应把聊天小计当总账单。

## 动态资料预算

AIHubMix Claude 的普通聊天和web-chat动态构建使用约3000 token软预算，普通检索背景单段最多约600 token；按完整句子节选并标记，完全重复资料去重。规则、当前状态、待办、账本、时间等优先完整保留；若这些必要信息已超预算，则保留并记录超额，而非错误删减。当前用户消息、图片、显式读取的GitHub/小红书页面等不在此预算中，因此3000不是总输入上限。

Self-Summary、Keeper、工具schema稳定化仍未启用；本次先使用现有独立摘要渠道，把安全覆盖与压缩流程接通。OpenClaw和不提供新协议的外部客户端仍保留原入口策略。

## 本次缓存修复

按 [AIHubMix 缓存文档](https://docs.aihubmix.com/en/practices/prompt-caching)，Chat Completions 的 Claude 标记应放在 content 文本块上。`provider-cache.js` 在真正发出请求前复制 payload，清理旧的消息层标记，在固定 system 和历史末尾各放一个 5 分钟断点。当前动态资料、问题及本轮新增工具结果不设断点。原始聊天记录和图片、工具调用、thinking 参数保持原样。

适配仅覆盖 HTTPS 的 aihubmix.com、api.aihubmix.com、api.inferera.com 上 claude- 开头模型，普通聊天和 web-chat 的工具与最终生成均接入。流式显式请求 include_usage。AIHubMix Claude 工具请求失败直接报错，不因参数错误自动降级再发一次。

前端「原始日志」顶部显示免费本地格式检查，以及最近一次模型调用的读写 token、时间、渠道、模型和费用估算。刷新只访问本服务，不调用模型；本地检查通过不表示上游实际命中。观测日志独立保留最近 1000 条，筛选 ContextBudget 可查看；重启清空。状态接口需要管理密码。

真实缓存仍受最小长度、前缀一致性和有效期限制；Opus 4.6 最低 4096 token。工具定义变化、历史窗口移动可能使缓存失效，所以不是最终费用保证。

## 历史前缀复用优化

尚未配置滚动摘要时，网页正常发送经 `/via/aihubmix/` 使用 claude- 模型，从原来的每轮最后30条改为固定起点追加：至少保留30条历史，最多38条，到上限再整体选择最近30条。`public/cache-history.js` 在 sessionStorage 按会话、渠道URL、模型保存起点消息ID，不保存正文副本。200条存储上限不会让起点随数组下标漂移；编辑使用当前版本，删除起点或清空记录时重新选取。存储不可用时安全回退为最近30条。

窗口回退会在部分轮次多带最多8条历史，用来换取几轮内可复用的前缀；冷启动、超时、窗口换批、版本编辑、工具集合变化仍可能重写。其他中转站、未启用摘要的重新生成50条策略、OpenClaw的12条策略及 `/api/web-chat` 的15条策略保持原样。

AIHubMix Claude 普通聊天的关系状态、心情快照、生活碎屑三组固定输出规则移到system缓存区，动态数据仍每轮更新，原有动态字符额度不增加。上游将经历一次新前缀写入。效果需从之后正常聊天账单判断；本地测试仅证明请求前缀可复用，不产生实际供应商缓存。

## 现有接入

`context-budget.js` 的 `composeContext` 统一普通聊天和 web-chat 的消息组装：system → summary（仅新网页协议可能有）→ history → current（含本轮动态资料）。摘要是明确标注来源的历史参考资料，不升级为system指令。消息数组可继续用于工具循环，原始历史数组不被追加工具结果。

`createBudgetObserver` 为一次聊天分配随机标识，统计每一次上游模型请求，包括工具轮与最终生成。日志前缀为 `[ContextBudget]`。新增日志没有正文、工具参数、密钥、URL 查询串或正文哈希。原有项目日志不在本次清理范围。

## 开启观测

无需设置环境变量即可观测。设置 `CONTEXT_BUDGET_MODE=off` 后重启可关闭；显式设置为 `observe` 也可以。

- `CONTEXT_BUDGET_TARGET_CNY`：每轮目标，默认 0.08；只提示超预算，不截断回复。
- `CONTEXT_BUDGET_HISTORY_TOKENS`：未压缩历史的粗估token阈值，默认12000；支持新协议的网页调用会按此触发压缩，其余入口只输出建议。
- `CONTEXT_BUDGET_RATES_JSON`：按 `供应商host|准确模型ID` 覆盖价格；某项设为 null 可禁用该项估算。

默认仅为 aihubmix.com 的 claude-opus-4-6 和 claude-opus-4-6-think 配置以下价格（2026-09-24 核对 [供应商价格页](https://aihubmix.com/authors/anthropic)）；其他渠道、域名、模型不套用。实际结算以供应商账单为准：

```json
{"aihubmix.com|claude-opus-4-6":{"input":5,"read":0.5,"write":6.25,"output":25,"usdToCny":7}}
```

四项 token 单价单位均为美元/百万 token。示例 write 为 5 分钟缓存写入总单价，不是另加在普通输入上的附加费。1 小时或混合 TTL 不能直接使用此示例。usdToCny 是手工估算汇率，不自动查询。不使用本示例推断 Kiro/Antigravity 的计费。

## 如何读数据

- `context`：固定提示、摘要、历史、当前消息含动态资料的粗估文本 token；尚不单独拆分末条消息中的 RAG 和真实用户发言。
- `request`：实际发出前的消息文本粗估和工具 schema 粗估；图片只计块数，不把 base64 长度误算成文本 token。未覆盖多模态 token 和协议开销，不能当精确账单。
- `usage`：上游返回的真实计数字段，以及按配置价格计算的估算费用。Anthropic 原生 input_tokens 不含缓存，Chat Completions prompt_tokens 包含缓存。reasoning 不再次加到 completion_tokens 上。
- `turn.knownUsd/knownCny`：当前已知模型请求费用小计。`complete=false` 表示有请求尚未返回完整可计价信息，不能把小计当整轮费用；即使 true 也只是截至当前已发出的请求，不代表后续不会再调用。

缺失缓存读写字段、单价或 usage 时，费用为 null；不把未知当零。不将 DeepSeek cache miss 当缓存创建。AIHubMix Claude 流式请求添加 stream_options.include_usage，并合并分段 usage；仍不能保证上游提供完整字段。日志的 cacheState 区分 hit、written、no_cache（明确的双零）、unknown（缺失），usageEvidence 只保留数字证据。request.cacheRequest 列出实际发送的断点位置，不包含正文。网络错误/中断可能留下仅有 request 的记录。后台摘要、记忆处理、主动任务、图片工具费用和 Keeper 不包含在聊天小计中。

## 后续阶段

1. 用真实请求核对 AIHubMix 参数透传、缓存读写与账单；按渠道建立适配配置。
2. 拆出动态后缀和真实用户消息；稳定常用工具集合，保留执行权限策略。
3. 在当前原文版本归档、进程内会话锁和原子覆盖提交之上，继续完善跨设备全量历史恢复与多实例锁。
4. 其他入口逐步接入明确的消息身份和摘要边界；不要依赖浮动数组下标。
5. 以每 100 轮总费用和聊天连续性验收，再决定 Self-Summary 和 Keeper。预算不是硬性截断开关。

## 验证

`node --test test/context-budget.test.js test/provider-cache.test.js test/context-cache-status.test.js test/streaming-chat.test.js test/cache-server-integration.test.js` 验证断点、前缀稳定、协议计费、未知字段、多次调用累计、分段流用量、免费状态接口和前端文案。`node --check server.js` 检查集成语法。测试无需 API 密钥，不产生模型费用，也不能替代供应商真实命中验证。
