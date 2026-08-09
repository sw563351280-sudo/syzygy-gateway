# Codex Bridge

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
