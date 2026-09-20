#!/bin/sh
# Called on the Linux host by the existing deployment workflow.
set -eu
cd /opt/syzygy/tools/music-api
timeout 180 npm ci --ignore-scripts --no-audit --no-fund --omit=dev
NODE_BIN=$(command -v node)
test -x "$NODE_BIN"
# The adapter has no site credentials and runs as an isolated dynamic user.
# Its writable state survives restarts via systemd's StateDirectory.
{
  printf '%s\n' '[Unit]' 'Description=Syzygy NetEase music adapter' 'After=network-online.target' 'Wants=network-online.target' ''
  printf '%s\n' '[Service]' 'Type=simple' 'DynamicUser=yes' 'StateDirectory=syzygy-music-api' 'WorkingDirectory=/opt/syzygy/tools/music-api'
  printf '%s\n' 'Environment=NCM_SERVICE_PORT=3001' 'Environment=NCM_STATE_DIR=/var/lib/syzygy-music-api' 'Environment=NODE_ENV=production'
  printf 'ExecStart=%s /opt/syzygy/tools/music-api/start.js\n' "$NODE_BIN"
  printf '%s\n' 'Restart=on-failure' 'RestartSec=5' 'NoNewPrivileges=true' 'PrivateTmp=true' 'ProtectSystem=strict' 'ProtectHome=true' 'UMask=0077' '' '[Install]' 'WantedBy=multi-user.target'
} > /etc/systemd/system/syzygy-music-api.service
mkdir -p /etc/systemd/system/syzygy.service.d
printf '%s\n' '[Service]' 'Environment=NCM_API_BASE=http://127.0.0.1:3001' > /etc/systemd/system/syzygy.service.d/music.conf
systemctl daemon-reload
systemctl enable syzygy-music-api.service
systemctl restart syzygy-music-api.service
attempt=0
until curl --silent --fail --max-time 3 http://127.0.0.1:3001/ --output /dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 15 ]; then
    echo 'Music API did not become ready; inspect syzygy-music-api.service on the host.' >&2
    exit 1
  fi
  sleep 2
done
echo 'Music API ready on loopback port 3001.'
