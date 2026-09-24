# 上下文与费用优化框架

当前已接入被动费用观测和 AIHubMix Claude 缓存格式适配，不承诺固定节省金额。观测默认开启；不发额外模型请求，不裁剪消息，不切换模型，不生成摘要，不启动保温。

## 本次缓存修复

按 [AIHubMix 缓存文档](https://docs.aihubmix.com/en/practices/prompt-caching)，Chat Completions 的 Claude 标记应放在 content 文本块上。`provider-cache.js` 在真正发出请求前复制 payload，清理旧的消息层标记，在固定 system 和历史末尾各放一个 5 分钟断点。当前动态资料、问题及本轮新增工具结果不设断点。原始聊天记录和图片、工具调用、thinking 参数保持原样。

适配仅覆盖 HTTPS 的 aihubmix.com、api.aihubmix.com、api.inferera.com 上 claude- 开头模型，普通聊天和 web-chat 的工具与最终生成均接入。流式显式请求 include_usage。AIHubMix Claude 工具请求失败直接报错，不因参数错误自动降级再发一次。

前端「原始日志」顶部显示免费本地格式检查，以及最近一次模型调用的读写 token、时间、渠道、模型和费用估算。刷新只访问本服务，不调用模型；本地检查通过不表示上游实际命中。观测日志独立保留最近 1000 条，筛选 ContextBudget 可查看；重启清空。状态接口需要管理密码。

真实缓存仍受最小长度、前缀一致性和有效期限制；Opus 4.6 最低 4096 token。工具定义变化、历史窗口滑动可能使缓存失效。这次没有改现有工具选择、30/50/12 条历史窗口或实现累计摘要，所以不是最终费用保证。

## 现有接入

`context-budget.js` 的 `composeContext` 统一普通聊天和 web-chat 的消息组装：system → summary（当前为空）→ history → current（含本轮动态资料）。输入角色、内容、多模态块和已有缓存标记原样保留。消息数组可继续用于工具循环，原始历史数组不被追加工具结果。

`createBudgetObserver` 为一次聊天分配随机标识，统计每一次上游模型请求，包括工具轮与最终生成。日志前缀为 `[ContextBudget]`。新增日志没有正文、工具参数、密钥、URL 查询串或正文哈希。原有项目日志不在本次清理范围。

## 开启观测

无需设置环境变量即可观测。设置 `CONTEXT_BUDGET_MODE=off` 后重启可关闭；显式设置为 `observe` 也可以。

- `CONTEXT_BUDGET_TARGET_CNY`：每轮目标，默认 0.08；只提示超预算，不截断回复。
- `CONTEXT_BUDGET_HISTORY_TOKENS`：历史压缩建议阈值，默认 12000；当前只输出建议，不执行压缩。
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
3. 先实现持久原文、消息 ID/版本边界、会话锁和摘要原子提交，再启用累计摘要。只有完整摘要才能推进边界；失败保留原文，重试不丢上下文。
4. 改为两次压缩间追加历史；现已设置的稳定区和历史末尾断点才更容易连续复用。当前 30/50/12 条滑动历史规则尚未改变。
5. 以每 100 轮总费用和聊天连续性验收，再决定 Self-Summary 和 Keeper。预算不是硬性截断开关。

## 验证

`node --test test/context-budget.test.js test/provider-cache.test.js test/context-cache-status.test.js test/streaming-chat.test.js test/cache-server-integration.test.js` 验证断点、前缀稳定、协议计费、未知字段、多次调用累计、分段流用量、免费状态接口和前端文案。`node --check server.js` 检查集成语法。测试无需 API 密钥，不产生模型费用，也不能替代供应商真实命中验证。
