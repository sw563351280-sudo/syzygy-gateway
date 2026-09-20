'use strict';
// Run this sidecar separately from the gateway so its credentials, dependencies
// and failure lifecycle do not affect chat. Never expose its port publicly.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const directory = process.env.NCM_STATE_DIR || path.resolve(__dirname, '../../data/music-api');
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
process.env.TEMP = directory;
process.env.TMP = directory;
process.env.TMPDIR = directory;
const fromApi = createRequire(require.resolve('@neteasecloudmusicapienhanced/api/package.json'));
fromApi('axios').default.defaults.timeout = 10000;

async function start() {
    const anonymous = path.join(directory, 'anonymous_token');
    if (!fs.existsSync(anonymous)) fs.writeFileSync(anonymous, '', { mode: 0o600 });
    await fromApi('./generateConfig')();
    // The upstream CLI runs an unbounded npm version check during boot. This
    // service uses a pinned dependency, so that check is unnecessary.
    await fromApi('./server').serveNcmApi({ host: '127.0.0.1', port: Number(process.env.NCM_SERVICE_PORT || 3001), checkVersion: false });
}
start().catch(() => { console.error('Music API initialization failed'); process.exitCode = 1; });
