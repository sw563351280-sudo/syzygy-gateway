'use strict';

const GITHUB_HOSTS = new Set(['github.com', 'www.github.com']);
const API_ROOT = 'https://api.github.com';

function parseGitHubUrl(value) {
    try {
        const url = new URL(String(value || '').trim());
        return url.protocol === 'https:' && GITHUB_HOSTS.has(url.hostname.toLowerCase()) ? url : null;
    } catch (_) { return null; }
}

function extractGitHubUrl(text) {
    // GitHub URL 本身只接收 ASCII URL 字符；这样“链接。后面的中文”不会被贪婪吞进去。
    const match = String(text || '').match(/https:\/\/(?:www\.)?github\.com\/[A-Za-z0-9._~:\/?#[\]@!$&'()*+,;=%-]+/i);
    return match ? match[0].replace(/[，。！？、】【）)]+$/u, '') : null;
}

function parseGitHubTarget(value) {
    const url = value instanceof URL ? value : parseGitHubUrl(value);
    if (!url) return null;
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (parts.length < 2) return null;
    const [owner, repo, kind, ...rest] = parts;
    if (!/^[A-Za-z0-9-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repo)) return null;
    const base = { owner, repo: repo.replace(/\.git$/i, ''), url: url.toString() };
    if (!kind) return { ...base, type: 'repo' };
    if (kind === 'blob' && rest.length >= 2) return { ...base, type: 'file', ref: rest[0], path: rest.slice(1).join('/') };
    if (kind === 'tree' && rest.length >= 1) return { ...base, type: 'tree', ref: rest[0], path: rest.slice(1).join('/') };
    if (kind === 'issues' && /^\d+$/.test(rest[0] || '')) return { ...base, type: 'issue', number: Number(rest[0]) };
    if (kind === 'pull' && /^\d+$/.test(rest[0] || '')) return { ...base, type: 'pull', number: Number(rest[0]) };
    if (kind === 'commit' && /^[a-f0-9]{7,64}$/i.test(rest[0] || '')) return { ...base, type: 'commit', sha: rest[0] };
    return { ...base, type: 'repo' };
}

function clip(value, max = 12000) {
    const text = String(value || '');
    return text.length > max ? text.slice(0, max) + '\n…（内容已截断）' : text;
}

function headers(token) {
    return {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Syzygy-Gateway GitHub Reader',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
}

async function githubJson(fetchImpl, path, token) {
    const response = await fetchImpl(API_ROOT + path, { headers: headers(token), signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`GitHub API ${response.status}`);
    return response.json();
}

function textForRepo(repo) {
    return [
        `【GitHub 仓库】${repo.full_name}`,
        repo.description ? `简介：${repo.description}` : '',
        `默认分支：${repo.default_branch || '未知'} · ${repo.visibility || 'public'} · ⭐ ${repo.stargazers_count || 0}`,
        repo.language ? `主要语言：${repo.language}` : '',
        `链接：${repo.html_url}`,
    ].filter(Boolean).join('\n');
}

function textForIssue(issue, kind) {
    return [
        `【GitHub ${kind} #${issue.number}】${issue.title || ''}`,
        `状态：${issue.state || '未知'} · 作者：${issue.user?.login || '未知'} · 评论：${issue.comments || 0}`,
        issue.body ? `正文：\n${clip(issue.body, 10000)}` : '正文：无',
        `链接：${issue.html_url}`,
    ].join('\n');
}

async function readGitHubTarget(fetchImpl, input, { token } = {}) {
    const target = parseGitHubTarget(input);
    if (!target) throw new Error('请使用 GitHub 仓库、文件、Issue、PR 或提交链接');
    const root = `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`;
    const repo = await githubJson(fetchImpl, root, token);
    let card = { type: target.type, title: repo.full_name, subtitle: repo.description || '', url: repo.html_url };
    let text = textForRepo(repo);

    if (target.type === 'file') {
        const item = await githubJson(fetchImpl, `${root}/contents/${target.path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(target.ref)}`, token);
        if (Array.isArray(item) || item.type !== 'file') throw new Error('该链接不是可读取的文件');
        const content = item.encoding === 'base64' ? Buffer.from(item.content || '', 'base64').toString('utf8') : String(item.content || '');
        card = { type: 'file', title: item.path, subtitle: `${item.size || 0} bytes · ${target.repo}`, url: item.html_url || target.url };
        text = `【GitHub 文件】${repo.full_name}/${item.path}（${target.ref}）\n\n${clip(content, 18000)}\n\n链接：${item.html_url || target.url}`;
    } else if (target.type === 'tree') {
        const tree = await githubJson(fetchImpl, `${root}/git/trees/${encodeURIComponent(target.ref)}?recursive=1`, token);
        const prefix = target.path ? target.path.replace(/\/$/, '') + '/' : '';
        const entries = (tree.tree || []).filter(item => !prefix || item.path.startsWith(prefix)).slice(0, 180).map(item => `${item.type === 'tree' ? '📁' : '·'} ${item.path}`);
        card = { type: 'tree', title: `${repo.full_name}/${target.path || ''}`, subtitle: `${target.ref} · ${entries.length} 项`, url: target.url };
        text = `${textForRepo(repo)}\n\n【目录 ${target.ref}/${target.path || ''}】\n${entries.join('\n') || '目录为空'}`;
    } else if (target.type === 'issue') {
        const issue = await githubJson(fetchImpl, `${root}/issues/${target.number}`, token);
        card = { type: 'issue', title: `#${issue.number} ${issue.title}`, subtitle: `${issue.state} · ${issue.comments || 0} 条评论`, url: issue.html_url };
        text = textForIssue(issue, 'Issue');
    } else if (target.type === 'pull') {
        const pull = await githubJson(fetchImpl, `${root}/pulls/${target.number}`, token);
        card = { type: 'pull', title: `#${pull.number} ${pull.title}`, subtitle: `${pull.state} · ${pull.changed_files || 0} 个文件 · +${pull.additions || 0}/-${pull.deletions || 0}`, url: pull.html_url };
        text = [textForIssue(pull, 'PR'), `变更：${pull.changed_files || 0} 个文件，+${pull.additions || 0} / -${pull.deletions || 0}`].join('\n');
    } else if (target.type === 'commit') {
        const commit = await githubJson(fetchImpl, `${root}/commits/${encodeURIComponent(target.sha)}`, token);
        const message = commit.commit?.message || '';
        const files = (commit.files || []).slice(0, 30).map(file => `${file.filename} (+${file.additions || 0}/-${file.deletions || 0})`);
        card = { type: 'commit', title: clip(message.split('\n')[0], 90), subtitle: `${String(commit.sha || '').slice(0, 7)} · ${files.length} 个文件`, url: commit.html_url };
        text = `【GitHub 提交】${repo.full_name}@${String(commit.sha || '').slice(0, 12)}\n${clip(message, 4000)}\n\n变更文件：\n${files.join('\n') || '无'}\n\n链接：${commit.html_url}`;
    }
    return { target, repo, card, text };
}

module.exports = { extractGitHubUrl, parseGitHubTarget, readGitHubTarget };
