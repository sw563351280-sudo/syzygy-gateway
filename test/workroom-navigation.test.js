const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require.resolve('../public/index.html'), 'utf8');
const script = fs.readFileSync(require.resolve('../public/script.js'), 'utf8');
const css = fs.readFileSync(require.resolve('../public/style.css'), 'utf8');
test('legacy Codex UI and executable client are removed while shared features remain', () => {
    assert.doesNotMatch(html, /devOpenCodex|devCodexPanel|devCodexLoginPanel|devRecentTaskCard|devOpenDashboard/);
    assert.doesNotMatch(script, /function devOpenCodex|function devSendCodexMessage|let devCodexSocket|devSetCodexImmersive/);
    assert.match(html, /id="sec-console"/);
    assert.match(html, /id="sec-codex-settings"/);
    assert.match(script, /function workroomDispatchToCodex/);
    assert.match(script, /function devDescribeCodexPermissions/);
});
test('settings has an explicit top entry and toolbar wraps outside mobile media rules', () => {
    assert.match(html, /id="workroomSettingsTop"[^>]*onclick="goView\('codex-settings'\)"/);
    const rule = css.match(/\.workroom-codex-bar\s*\{([^}]+)\}/)[1];
    assert.match(rule, /flex-wrap:\s*wrap/);
});
test('top settings button is shown in workroom and hidden in private chat', () => {
    let active = true;
    const top = { hidden: true };
    const source = script.slice(script.indexOf('function updateWorkroomChrome()'), script.indexOf('function escapeToolHtml'));
    const context = vm.createContext({ isWorkroomSession: () => active, ensureWorkroomSession: () => ({ codexTaskId: null }),
        document: { getElementById: id => id === 'workroomSettingsTop' ? top : null, querySelectorAll: () => [] }, workroomApprovalQueue: [] });
    vm.runInContext(source, context);
    context.updateWorkroomChrome();
    assert.equal(top.hidden, false);
    active = false;
    context.updateWorkroomChrome();
    assert.equal(top.hidden, true);
});
