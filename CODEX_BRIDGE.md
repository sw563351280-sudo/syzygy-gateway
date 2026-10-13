# Codex Bridge

## 沈望后台派单

聊天模型可通过 `dispatch_codex_task` 提交具体代码问题。工具返回排队状态后聊天继续；Codex 在服务器独立 Git 副本中处理，完成后报告持久化到来源聊天和工作记录。手机离线时报告仍保留，下次同步可见。不会为结果通知额外调用聊天模型。

- `inspect` 只读检查；`repair` 仅修改独立副本。证据为 `hypothesis` 时服务端强制只读。
- 默认每日最多 3 单，后台串行执行，相同会话的同一问题 24 小时内不重复派单。
- `CODEX_DISPATCH_ENABLED=false` 关闭派单；工具设置中的 `dispatch_codex_task` 控制模型是否可派单。
- `CODEX_DISPATCH_DAILY_LIMIT` 设置每日上限（1–20）。`CODEX_DISPATCH_ROOT` 设置副本目录，默认 `/opt/syzygy-codex-jobs`；目录必须在生产工作区之外。
- 后台独立使用 `<CODEX_DISPATCH_ROOT>/.codex`，首次仅复制服务用户已有的 `auth.json`，不复制全局模型配置或 MCP。若原账号保存在系统钥匙串里，可由同一服务用户用 `CODEX_HOME=/opt/syzygy-codex-jobs/.codex codex login --device-auth` 登录。该目录不进入 Git。
- 不自动推送、部署或重启服务。副本的 origin 推送地址禁用；后台任务网络关闭，额外权限请求自动拒绝。修复交回后由用户审查，再决定发布。
- 服务器重启时，已开始的任务标为中断，不自动再次调用模型；尚未开始的队列继续处理。已有修复副本保留。
- 已登录后访问 `/api/codex/dispatch` 可查看队列、任务、报告和副本路径。报告是 Codex 自报，完成状态不等同于验证通过或已上线。

离线验证：`node --test test/codex-dispatch.test.js test/codex-bridge-chat.test.js test/codex-bridge-login.test.js`。使用假 agent 和本地临时 Git 仓库，不调用模型。

Syzygy 的“开发中枢”通过服务端 `codex app-server` 接入 Codex。浏览器只拿到已登录会话下的任务事件，Codex 登录状态和工作区权限留在 VPS 上。

## VPS 一次性准备

部署脚本会尝试安装 Codex CLI；如果 VPS 没有外网或安装失败，需要手动安装。然后用运行 Syzygy 的系统用户完成一次 Codex 登录，并保证登录目录在 `CODEX_HOME` 中：

```sh
npm install -g @openai/codex
mkdir -p /opt/syzygy/.codex
CODEX_HOME=/opt/syzygy/.codex codex login
```

在 `/etc/systemd/system/syzygy.service` 的 `Environment=` 中加入：

```ini
CODEX_ENABLED=true
CODEX_HOME=/opt/syzygy/.codex
CODEX_WORKDIR=/opt/syzygy
CODEX_MODEL=gpt-5.6-terra
```

之后重启服务。前端默认使用只读诊断；选择“允许修改工作区”时，Codex 只能写入 `CODEX_WORKDIR`，并会把命令或文件变更审批请求发回手机端。

## 注意

- 不要把 `CODEX_HOME`、登录文件、API key 或 systemd 环境文件提交到仓库。
- Codex 子进程不会继承 Syzygy 的密码、令牌、私钥和 API key 环境变量。
- 官方文档将 App Server 标为深度产品集成接口；当前 WebSocket 传输仍是实验性能力，本项目使用本机 stdio transport，由 Node 后端转发事件。
