'use strict';
// Counts only; no memory text, candidate text, API keys or paid probes.
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const root = '/opt/syzygy';
const { readMemoryEvents, autoRetryDue } = require(root + '/memory-events');
const file = root + '/data/memory_events.jsonl';
const raw = new Map();
for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    try { const event = JSON.parse(line); if (event.id) raw.set(event.id, event); } catch {}
}
const events = readMemoryEvents(file);
const invalid = events.filter(event => event.kind === 'long_term' && /no valid decision/.test(String(event.error || '')));
const report = {
    revision: execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    invalidResults: invalid.length,
    heldForReview: invalid.filter(event => event.status === 'needs_review').length,
    automaticRetriesEligible: invalid.filter(event => ['pending', 'received', 'processing'].includes(event.status) && autoRetryDue(event)).length,
    legacyQueueEntriesRecovered: invalid.filter(event => raw.get(event.id)?.status !== event.status).length,
    maximumPastAttempts: Math.max(0, ...invalid.map(event => Number(event.attempts) || 0)),
    deployedFilesMatch: ['memory-merge-curator.js', 'memory-events.js', 'server.js'].every(name =>
        fs.readFileSync(root + '/' + name, 'utf8').replace(/\r\n/g, '\n') === execFileSync('git', ['show', 'HEAD:' + name], { cwd: root, encoding: 'utf8' }).replace(/\r\n/g, '\n')),
};
console.log(JSON.stringify(report, null, 2));
if (report.automaticRetriesEligible !== 0 || !report.deployedFilesMatch) process.exitCode = 1;
