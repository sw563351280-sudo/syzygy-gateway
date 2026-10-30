'use strict';
// Use the live service environment without logging credentials or starting a turn.
const fs = require('node:fs');
const { execFileSync, spawn } = require('node:child_process');
async function main() {
    const pid = execFileSync('systemctl', ['show', 'syzygy', '--property=MainPID', '--value'], { encoding: 'utf8' }).trim();
    if (!/^[1-9]\d*$/.test(pid)) throw new Error('syzygy service is not running');
    const env = {};
    for (const item of fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0')) {
        const i = item.indexOf('=');
        if (i > 0 && !/(PASSWORD|SECRET|TOKEN|PRIVATE_KEY|API_KEY|ACCESS_KEY)/i.test(item.slice(0, i))) {
            env[item.slice(0, i)] = item.slice(i + 1);
        }
    }
    const bin = env.CODEX_BIN || 'codex';
    console.log('Service Codex version:', execFileSync(bin, ['--version'], { env, encoding: 'utf8' }).trim());
    const { createModelReader } = require('/opt/syzygy/codex-models');
    const models = await createModelReader({ spawn, bin, cwd: '/opt/syzygy', env: () => env, timeoutMs: 30000 })();
    console.log(JSON.stringify({ models: models.map(m => ({ model: m.model, displayName: m.displayName })) }, null, 2));
    for (const target of ['gpt-6.1-sol', 'gpt-6-astra']) console.log(`${target}: ${models.some(m => m.model === target) ? 'available' : 'not listed for service account'}`);
}
main().catch(error => { console.error('Codex inspection failed:', error.code || error.name); process.exitCode = 1; });
