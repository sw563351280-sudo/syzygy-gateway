#!/usr/bin/env node
'use strict';
const crypto = require('node:crypto');
const { buildNativeRequest } = require('./anthropic-cache');

console.log('=== Anthropic Prompt Cache 稳定性验证 ===\n');

// 模拟两次连续请求
const body = {
  model: 'claude-opus-5-5',
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi! How can I help you?' },
    { role: 'user', content: 'Tell me about caching' }
  ],
  tools: [
    { type: 'function', function: { name: 'search', description: 'Search the web', parameters: { type: 'object', properties: {} } } }
  ]
};

const scope = 'test-chat-12345';
const historyEnd = 2;

// 第一次请求
const req1 = buildNativeRequest(body, { scope, historyEnd });
console.log('✓ 第一次请求构建完成');

// 第二次请求（相同参数）
const req2 = buildNativeRequest(body, { scope, historyEnd });
console.log('✓ 第二次请求构建完成\n');

// 计算关键部分的 hash
function hash(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 16);
}

const systemHash1 = hash(req1.system);
const systemHash2 = hash(req2.system);
const toolsHash1 = hash(req1.tools);
const toolsHash2 = hash(req2.tools);
const thinkingHash1 = hash(req1.thinking || null);
const thinkingHash2 = hash(req2.thinking || null);

console.log('🔍 缓存 Key 组成部分稳定性检查：');
console.log('');
console.log('1. metadata.user_id:');
console.log('   第一次:', req1.metadata ? JSON.stringify(req1.metadata) : '(未设置)');
console.log('   第二次:', req2.metadata ? JSON.stringify(req2.metadata) : '(未设置)');
console.log('   状态:', req1.metadata === req2.metadata && !req1.metadata ? '✅ 已移除（正确）' : req1.metadata ? '❌ 仍然存在' : '✅ 一致');
console.log('');

console.log('2. system blocks:');
console.log('   第一次 hash:', systemHash1);
console.log('   第二次 hash:', systemHash2);
console.log('   状态:', systemHash1 === systemHash2 ? '✅ 完全一致' : '❌ 不一致');
console.log('');

console.log('3. tools:');
console.log('   第一次 hash:', toolsHash1);
console.log('   第二次 hash:', toolsHash2);
console.log('   状态:', toolsHash1 === toolsHash2 ? '✅ 完全一致' : '❌ 不一致');
console.log('');

console.log('4. thinking 参数:');
console.log('   第一次:', JSON.stringify(req1.thinking));
console.log('   第二次:', JSON.stringify(req2.thinking));
console.log('   状态:', thinkingHash1 === thinkingHash2 ? '✅ 完全一致' : '❌ 不一致');
console.log('');

console.log('5. temperature/top_p/top_k:');
console.log('   第一次:', { temperature: req1.temperature, top_p: req1.top_p, top_k: req1.top_k });
console.log('   第二次:', { temperature: req2.temperature, top_p: req2.top_p, top_k: req2.top_k });
console.log('   状态:', req1.temperature === req2.temperature && req1.top_p === req2.top_p && req1.top_k === req2.top_k ? '✅ 一致' : '❌ 不一致');
console.log('');

// 整体一致性检查
const allStable =
  !req1.metadata && !req2.metadata &&
  systemHash1 === systemHash2 &&
  toolsHash1 === toolsHash2 &&
  thinkingHash1 === thinkingHash2;

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
if (allStable) {
  console.log('✅ 整体结论：缓存 Key 完全稳定，应该能命中 Anthropic Prompt Cache');
  console.log('');
  console.log('预期效果：');
  console.log('  - 第一次请求：写入缓存（cache_creation_input_tokens > 0）');
  console.log('  - 第二次请求：读取缓存（cache_read_input_tokens > 0, cache_creation = 0）');
} else {
  console.log('❌ 整体结论：仍存在不稳定因素，可能无法命中缓存');
  console.log('');
  console.log('请检查以上标记为 ❌ 的项目');
}
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
