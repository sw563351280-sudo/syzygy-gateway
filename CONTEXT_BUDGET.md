# 上下文与费用优化框架

第一阶段只整理代码入口并提供可选观测，不承诺节省金额。默认关闭观测；不发额外模型请求，不修改缓存标记，不裁剪消息，不切换模型，不生成摘要，不启动保温。

## 现有接入

`context-budget.js` 的 `composeContext` 统一普通聊天和 web-chat 的消息组装：system → summary（当前为空）→ history → current（含本轮动态资料）。输入角色、内容、多模态块和已有缓存标记原样保留。消息数组可继续用于工具循环，原始历史数组不被追加工具结果。

`createBudgetObserver` 为一次聊天分配随机标识，统计每一次上游模型请求，包括工具轮与最终生成。日志前缀为 `[ContextBudget]`。新增日志没有正文、工具参数、密钥、URL 查询串或正文哈希。原有项目日志不在本次清理范围。

## 开启观测

设置 `CONTEXT_BUDGET_MODE=observe` 后重启。移除该变量或设为 `off` 可关闭。

- `CONTEXT_BUDGET_TARGET_CNY`：每轮目标，默认 0.08；只提示超预算，不截断回复。
- `CONTEXT_BUDGET_HISTORY_TOKENS`：历史压缩建议阈值，默认 12000；当前只输出建议，不执行压缩。
- `CONTEXT_BUDGET_RATES_JSON`：按 `供应商host|准确模型ID` 配置价格，不根据模型名自动套用官方价格。

示例价格仅用于演示计算，启用前按实际模型、渠道、缓存 TTL、充值结算核对：

```json
{"aihubmix.com|claude-opus-4-6":{"input":5,"read":0.5,"write":6.25,"output":25,"usdToCny":7}}
```

四项 token 单价单位均为美元/百万 token。示例 write 为 5 分钟缓存写入总单价，不是另加在普通输入上的附加费。1 小时或混合 TTL 不能直接使用此示例。usdToCny 是手工估算汇率，不自动查询。不使用本示例推断 Kiro/Antigravity 的计费。

## 如何读数据

- `context`：固定提示、摘要、历史、当前消息含动态资料的粗估文本 token；尚不单独拆分末条消息中的 RAG 和真实用户发言。
- `request`：实际发出前的消息文本粗估和工具 schema 粗估；图片只计块数，不把 base64 长度误算成文本 token。未覆盖多模态 token 和协议开销，不能当精确账单。
- `usage`：上游返回的真实计数字段，以及按配置价格计算的估算费用。Anthropic 原生 input_tokens 不含缓存，Chat Completions prompt_tokens 包含缓存。reasoning 不再次加到 completion_tokens 上。
- `turn.knownUsd/knownCny`：当前已知模型请求费用小计。`complete=false` 表示有请求尚未返回完整可计价信息，不能把小计当整轮费用；即使 true 也只是截至当前已发出的请求，不代表后续不会再调用。

缺失缓存读写字段、单价或 usage 时，费用为 null；不把未知当零。不将 DeepSeek cache miss 当缓存创建。流式只读取上游已经发送的 usage，不主动添加 stream_options，也不保证上游会返回 usage。网络错误/中断可能留下仅有 request 的记录。后台摘要、记忆处理、主动任务、图片工具费用和 Keeper 不包含在聊天小计中。

## 后续阶段

1. 用真实请求核对 AIHubMix 参数透传、缓存读写与账单；按渠道建立适配配置。
2. 拆出动态后缀和真实用户消息；稳定常用工具集合，保留执行权限策略。
3. 先实现持久原文、消息 ID/版本边界、会话锁和摘要原子提交，再启用累计摘要。只有完整摘要才能推进边界；失败保留原文，重试不丢上下文。
4. 改为两次压缩间追加历史；将缓存断点放在稳定区和历史末尾。当前 30/50/12 条滑动历史规则尚未改变。
5. 以每 100 轮总费用和聊天连续性验收，再决定 Self-Summary 和 Keeper。预算不是硬性截断开关。

## 验证

`node --test test/context-budget.test.js` 验证协议计费、未知字段、多次调用累计、默认关闭、日志隐私及消息结构保留。`node --check server.js` 检查集成语法。测试无需 API 密钥，不产生模型费用。
