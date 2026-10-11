'use strict';
// Read-only, allowlisted deployment facts. Never print cookies, environment,
// browser screenshots, user profiles, or raw service logs to Actions.
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
function command(bin, args) {
    try { return execFileSync(bin, args, { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch { return 'unavailable'; }
}
function readState(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } }
(async () => {
    const browser = readState('/opt/syzygy/data/xhs_browser_state.json');
    const disk = fs.statfsSync('/opt');
    const pid = command('systemctl', ['show', 'syzygy', '-p', 'MainPID', '--value']);
    let env = {};
    if (/^\d+$/.test(pid) && pid !== '0') {
        try { env = Object.fromEntries(fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').filter(Boolean).map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)]; })); } catch {}
    }
    const report = {
        arch: os.arch(), platform: os.platform(), node: process.version,
        availableMemoryMiB: Math.floor(os.freemem() / 1048576), totalMemoryMiB: Math.floor(os.totalmem() / 1048576),
        freeDiskGiB: Math.floor(disk.bavail * disk.bsize / 1073741824),
        gateway: command('systemctl', ['is-active', 'syzygy']),
        xhsService: command('systemctl', ['is-active', 'syzygy-xhs']),
        xhsEnabled: command('systemctl', ['is-enabled', 'syzygy-xhs']),
        existingBrowserLogin: ['logged_in', 'login_required', 'challenge', 'unknown', 'starting'].includes(browser.login_status) ? browser.login_status : 'unknown',
        existingBrowserProfile: fs.existsSync('/opt/syzygy/data/xhs-browser-profile'),
        mcpConfigured: Boolean(env.XHS_MCP_URL),
        walkDisabled: env.XHS_WALK_ENABLED === 'false',
        browserBinaryPresent: ['/usr/bin/chromium', '/usr/bin/google-chrome', '/usr/bin/chromium-browser'].some(file => fs.existsSync(file)),
    };
    try { const response = await fetch('http://127.0.0.1:18061/health', { signal: AbortSignal.timeout(3000) }); report.mcpHealth = response.status; }
    catch { report.mcpHealth = 'unreachable'; }
    console.log(JSON.stringify(report, null, 2));
})();
