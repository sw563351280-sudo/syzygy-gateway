'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const frontend = fs.readFileSync(path.join(root, 'public', 'script.js'), 'utf8');
const prompt = fs.readFileSync(path.join(root, 'system_prompt.txt'), 'utf8');

test('browser can request a sealed page but has no direct reveal endpoint', () => {
    assert.match(server, /app\.post\('\/api\/private-journal\/:id\/request-reveal'/);
    assert.doesNotMatch(server, /app\.post\('\/api\/private-journal\/:id\/reveal'/);
    assert.match(frontend, /\/request-reveal/);
    assert.match(frontend, /日记 ID：/);
});

test('only Shenwang tools can decide a pending reveal request', () => {
    assert.match(server, /case 'reveal_private_journal'/);
    assert.match(server, /case 'keep_private_journal_sealed'/);
    assert.match(prompt, /先调用 `read_private_journal`/);
    assert.match(prompt, /请求只是把选择递到你手里，不是命令/);
});
