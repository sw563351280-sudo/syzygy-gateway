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

test('quiet reflection uses shared journal mode with complete main-chat messages', () => {
    assert.match(server, /const PRIVATE_JOURNAL_REFLECTION_MESSAGES = 24/);
    assert.match(server, /loadMainRecentConversation\(PRIVATE_JOURNAL_REFLECTION_MESSAGES\)/);
    assert.match(server, /normalizeConversationMessages\(history\.messages, PRIVATE_JOURNAL_REFLECTION_MESSAGES, Infinity, false, true\)/);
    assert.match(server, /mode: 'private_journal'/);
    assert.match(server, /shared\.systemMessage,\s*\.\.\.messages,/);
    assert.doesNotMatch(server, /PRIVATE_JOURNAL_REFLECTION_MESSAGES, 700/);
});

test('proactive chat has its own thirty-message window and workroom never writes main memory', () => {
    assert.match(server, /const WAKE_RECENT_MESSAGES = 30/);
    assert.match(server, /const RESEARCH_NOTIFICATION_RECENT_MESSAGES = 6/);
    assert.match(server, /const XHS_WALK_RECENT_MESSAGES = 6/);
    assert.match(server, /loadMainRecentConversation\(WAKE_RECENT_MESSAGES\)/);
    assert.match(server, /normalizeConversationMessages\(selectedHistory\.messages, WAKE_RECENT_MESSAGES, WAKE_MESSAGE_CHARS, false, false\)/);
    assert.match(server, /const noMemory = req\.headers\['x-no-memory'\] === 'true' \|\| workroomDiscussion/);
    assert.match(server, /if \(workroomDiscussion\) \{\s*updateLastInteraction\(\);\s*schedulePrivateJournalReflection\(\);/);
    assert.match(frontend, /async function flushDirtyToZep\(session, signal\) \{\s*if \(!session \|\| !session\.messages\) return;\s*if \(isWorkroomSession\(session\)\) return;/);
    assert.match(frontend, /JSON\.stringify\(\{sessionId:session\.id,userContent:userContent,aiContent:aiContent\}\)/);
    assert.match(server, /if \(sessionId === 'syzygy-workroom'\)/);
    assert.match(server, /if \(req\.body\?\.source === 'workroom'\) \{\s*updateLastInteraction\(\);\s*schedulePrivateJournalReflection\(\);/);
});
