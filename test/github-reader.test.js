'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractGitHubUrl, parseGitHubTarget, readGitHubTarget } = require('../github-reader');

test('recognizes only safe GitHub URLs and their targets', () => {
    assert.equal(extractGitHubUrl('看 https://github.com/octo/demo/issues/12。'), 'https://github.com/octo/demo/issues/12');
    assert.equal(parseGitHubTarget('https://evil.example/github.com/a/b'), null);
    assert.deepEqual(parseGitHubTarget('https://github.com/octo/demo/blob/main/src/a.js').type, 'file');
    assert.equal(parseGitHubTarget('https://github.com/octo/demo/pull/7').type, 'pull');
});

test('reads a GitHub file through the GitHub API', async () => {
    const calls = [];
    const fetchImpl = async url => {
        calls.push(url);
        const body = url.endsWith('/repos/octo/demo')
            ? { full_name: 'octo/demo', default_branch: 'main', html_url: 'https://github.com/octo/demo', visibility: 'private' }
            : { type: 'file', path: 'README.md', size: 5, encoding: 'base64', content: 'aGVsbG8=', html_url: 'https://github.com/octo/demo/blob/main/README.md' };
        return { ok: true, json: async () => body };
    };
    const result = await readGitHubTarget(fetchImpl, 'https://github.com/octo/demo/blob/main/README.md', { token: 'test' });
    assert.match(result.text, /hello/);
    assert.equal(result.card.type, 'file');
    assert.equal(calls.length, 2);
});
