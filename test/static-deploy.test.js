const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

const root = path.join(__dirname, '..');
const manifestPath = path.join(root, '.github', 'static-assets.txt');

function manifestFiles() {
    return fs.readFileSync(manifestPath, 'utf8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));
}

test('static deployment manifest exactly covers tracked public assets', () => {
    const declared = manifestFiles();
    const tracked = execFileSync('git', ['ls-files', 'public'], {
        cwd: root,
        encoding: 'utf8'
    }).split(/\r?\n/).filter(Boolean);

    assert.ok(declared.length > 0);
    assert.equal(new Set(declared).size, declared.length, 'manifest must not contain duplicates');
    assert.ok(declared.every((file) => file.startsWith('public/')), 'assets must stay under public/');
    assert.deepEqual([...declared].sort(), tracked.sort());
    for (const file of declared) assert.ok(fs.statSync(path.join(root, file)).isFile(), file);
});

test('static deployment publishes dependencies before replacing the entry page', () => {
    const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'deploy-static.yml'), 'utf8');
    const extractAt = workflow.indexOf('tar --no-same-owner --no-same-permissions -xzf');
    const replaceAt = workflow.indexOf('mv \\"${remote_index}\\" /opt/syzygy/public/index.html');

    assert.match(workflow, /\.github\/static-assets\.txt/);
    assert.ok(extractAt >= 0, 'workflow must extract the verified dependency bundle');
    assert.ok(replaceAt > extractAt, 'index.html must be replaced after its dependencies');
    assert.match(workflow, /test -s \/opt\/syzygy\/public\/home-tools\.js/);
    assert.match(workflow, /test -s \/opt\/syzygy\/public\/workroom-pages\.js/);
    assert.match(workflow, /test -s \/opt\/syzygy\/public\/shen-settings-page\.js/);
});
