# 小米运动健康只读服务

该服务只监听 `127.0.0.1`，独占小米账号 token。主站通过另一枚本机共享密钥读取睡眠、心率和步数；不会保存响应，也不会把 token 交给 Node、浏览器或模型。

## 首次安装（在 VPS 上）

```bash
cd /opt/syzygy
# mi-fitness requires Python 3.11 or newer.
python3 -m venv mi-health/.venv
mi-health/.venv/bin/pip install --upgrade pip
mi-health/.venv/bin/pip install -r mi-health/requirements.txt
install -d -m 700 /opt/syzygy/data/mi-health
install -d -m 700 /etc/syzygy
```

创建 `/etc/syzygy/mi-health.env`（`chmod 600`），内容如下。两处 `MI_HEALTH_SERVICE_TOKEN` / `HEALTH_SERVICE_TOKEN` 必须是同一串至少 32 位的随机值；不要提交或发送它。

```ini
MI_HEALTH_ENABLED=true
MI_HEALTH_TOKEN_FILE=/opt/syzygy/data/mi-health/token.json
MI_HEALTH_RELATIVE_UID=你的大号亲友UID
MI_HEALTH_SERVICE_TOKEN=替换为至少32位随机字符串
MI_HEALTH_BIND_HOST=127.0.0.1
MI_HEALTH_PORT=8091
# Default is https://hlth.io.mi.com. Set the endpoint matching your account
# data center when needed, for example: MI_HEALTH_API_BASE=https://sg.hlth.io.mi.com
```

登录时，用运行服务的同一用户执行以下命令；先在 App 中完成“小号为大号亲友”并明确授权睡眠、心率、步数。二维码与 token 都是敏感凭证。

```bash
set -a
. /etc/syzygy/mi-health.env
set +a
/opt/syzygy/mi-health/.venv/bin/python /opt/syzygy/mi-health/login.py
```

若要先检查 VPS 能否读取数据（不输出健康详情），可执行：

```bash
/opt/syzygy/mi-health/.venv/bin/python /opt/syzygy/mi-health/check_access.py --uid 你的小米UID --api-base https://sg.hlth.io.mi.com
```

安装 systemd 单元后启动：

```bash
install -m 644 /opt/syzygy/mi-health/mi-health.service.example /etc/systemd/system/mi-health.service
systemctl daemon-reload
systemctl enable --now mi-health.service
systemctl status mi-health.service
```

最后给主站的 `syzygy.service` 增加同一枚密钥，并显式启用功能：

```ini
Environment="HEALTH_DATA_ENABLED=true"
Environment="HEALTH_SERVICE_URL=http://127.0.0.1:8091"
Environment="HEALTH_SERVICE_TOKEN=与MI_HEALTH_SERVICE_TOKEN相同的随机值"
```

启用主站工具开关：`POST /api/tools-toggle?tool=health_data`。查询结果仅供记录参考，不能用于诊断或替代就医。
