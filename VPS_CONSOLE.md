# VPS 控制台配置

控制台通过已登录的网页建立 WebSocket，再由本服务端创建 SSH 会话。浏览器不会收到 SSH 私钥、密码或主机指纹。

在部署服务的环境中设置以下变量，然后重启服务：

```ini
VPS_CONSOLE_HOST=203.0.113.10
VPS_CONSOLE_PORT=22
VPS_CONSOLE_USERNAME=console-user
VPS_CONSOLE_PRIVATE_KEY_PATH=/run/secrets/vps_console_ed25519
VPS_CONSOLE_HOST_FINGERPRINT=put_the_hex_sha256_hash_here
VPS_CONSOLE_LABEL=生产 VPS
```

`VPS_CONSOLE_PRIVATE_KEY_PATH` 指向仅运行服务的系统用户可读的私钥。优先使用独立的、权限受限的 SSH 用户和密钥，不要使用 root 或日常管理员私钥。

主机指纹是必填项；它防止服务被伪造的 SSH 主机接管。下面的命令会从已知主机密钥生成本项目需要的 SHA-256 十六进制值：

```sh
ssh-keyscan -t ed25519 YOUR_VPS_HOST 2>/dev/null | awk '{print $2}' | base64 -d | sha256sum
```

先通过可信渠道核对该值（例如 VPS 控制台或已有的 `known_hosts`），再填入 `VPS_CONSOLE_HOST_FINGERPRINT`。不要把私钥、密码、令牌或此配置文件提交进仓库。

也支持 `VPS_CONSOLE_PASSWORD`，但只建议临时迁移使用；SSH 密钥是首选方式。未完整配置时，前端会显示“尚未配置”，并不会发起网络连接。
