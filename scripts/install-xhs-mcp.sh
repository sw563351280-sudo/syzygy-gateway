#!/usr/bin/env bash
set -euo pipefail
# Fixed paths and source version; no chat data, cookies or secrets in output.
test "$(uname -m)" = x86_64
# Ubuntu 24.04 runtime dependencies for the upstream bundled browser.
# List pending service restarts only; never restart the gateway here.
DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l apt-get install -y --no-install-recommends \
  libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libasound2t64 libgbm1 \
  libcairo2 libpango-1.0-0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libatspi2.0-0t64
cd /opt/syzygy-xhs/incoming
sha256sum --check SHA256SUMS
id syzygy-xhs >/dev/null 2>&1 || useradd --system --home-dir /var/lib/syzygy-xhs --shell /usr/sbin/nologin syzygy-xhs
install -d -m 700 -o syzygy-xhs -g syzygy-xhs /var/lib/syzygy-xhs
install -d -m 755 /opt/syzygy-xhs /etc/syzygy-xhs /etc/systemd/system/syzygy.service.d
if [ -f /opt/syzygy-xhs/xiaohongshu-mcp ]; then
  cp /opt/syzygy-xhs/xiaohongshu-mcp /opt/syzygy-xhs/xiaohongshu-mcp.previous
fi
install -m 755 xiaohongshu-mcp /opt/syzygy-xhs/xiaohongshu-mcp
if [ ! -f /etc/syzygy-xhs/service.env ]; then
  umask 077
  token=$(openssl rand -hex 32)
  printf 'AUTH_TOKEN=%s\nXHS_MCP_TOKEN=%s\nXHS_MCP_URL=http://127.0.0.1:18061/mcp\nCOOKIES_PATH=/var/lib/syzygy-xhs/cookies.json\nHOME=/var/lib/syzygy-xhs\n' "$token" "$token" > /etc/syzygy-xhs/service.env
  unset token
fi
# Best-effort local-only reuse of the existing browser session. No cookie ever
# leaves this server. Existing MCP sessions are never overwritten.
cd /opt/syzygy
node <<'NODE'
const fs = require('fs');
(async () => {
  const target = '/var/lib/syzygy-xhs/cookies.json';
  if (fs.existsSync(target)) return;
  let browser;
  try {
    const raw = fs.readFileSync('/opt/syzygy/data/xhs-browser-profile/DevToolsActivePort', 'utf8').split('\n')[0];
    if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 65535) return;
    browser = await require('puppeteer-core').connect({ browserURL: 'http://127.0.0.1:' + raw, protocolTimeout: 10000 });
    const pages = await browser.pages();
    if (!pages.length) return;
    const cookies = await pages[0].cookies('https://www.xiaohongshu.com');
    if (!cookies.some(c => c.name === 'web_session' && c.value)) return;
    fs.writeFileSync(target, JSON.stringify(cookies), { mode: 0o600, flag: 'wx' });
    console.log('Existing server login session copied locally.');
  } catch { console.log('Session reuse unavailable; use the authenticated scan page.'); }
  finally { browser?.disconnect(); }
})();
NODE
if [ -f /var/lib/syzygy-xhs/cookies.json ]; then
  chown syzygy-xhs:syzygy-xhs /var/lib/syzygy-xhs/cookies.json
  chmod 600 /var/lib/syzygy-xhs/cookies.json
fi
cat > /etc/systemd/system/syzygy-xhs.service <<'UNIT'
[Unit]
Description=Syzygy Xiaohongshu MCP v2.5.0
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=600
StartLimitBurst=5

[Service]
Type=simple
User=syzygy-xhs
Group=syzygy-xhs
WorkingDirectory=/var/lib/syzygy-xhs
EnvironmentFile=/etc/syzygy-xhs/service.env
ExecStart=/opt/syzygy-xhs/xiaohongshu-mcp -headless=true -port=127.0.0.1:18061
Restart=on-failure
RestartSec=10
UMask=0077
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/syzygy-xhs
MemoryMax=2G
TasksMax=512
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
UNIT
# Do not set HOME on the gateway or expose the MCP token to the browser.
node <<'NODE'
const fs = require('fs');
const lines = fs.readFileSync('/etc/syzygy-xhs/service.env', 'utf8').split('\n').filter(line => /^XHS_MCP_(URL|TOKEN)=/.test(line));
fs.writeFileSync('/etc/syzygy-xhs/gateway.env', lines.join('\n') + '\n', { mode: 0o600 });
NODE
cat > /etc/systemd/system/syzygy.service.d/xhs-mcp.conf <<'UNIT'
[Unit]
Wants=syzygy-xhs.service
After=syzygy-xhs.service
[Service]
EnvironmentFile=/etc/syzygy-xhs/gateway.env
UNIT
systemctl daemon-reload
systemctl enable --now syzygy-xhs
# The first start downloads and verifies the upstream's pinned browser.
for attempt in $(seq 1 120); do
  if curl --silent --fail --max-time 2 http://127.0.0.1:18061/health >/dev/null; then
    echo 'Xiaohongshu MCP healthy; enabled for server boot; bound to loopback.'
    exit 0
  fi
  sleep 5
done
echo 'MCP health check failed; inspect sanitized diagnostics. Gateway was not restarted.'
exit 1
