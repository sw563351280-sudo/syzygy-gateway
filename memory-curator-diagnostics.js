'use strict';
const { decideMemoryWrite } = require('./memory-merge-curator');
function configuration(env = process.env) {
    return {
        apiKey: env.DREAM_API_KEY || env.ROUTER_API_KEY || '',
        keySource: env.DREAM_API_KEY ? 'DREAM_API_KEY' : env.ROUTER_API_KEY ? 'ROUTER_API_KEY' : '未配置',
        endpoint: env.MEMORY_MERGE_URL || env.DAILY_CURATOR_URL || 'https://www.msuicode.com/v1/chat/completions',
        model: env.MEMORY_MERGE_MODEL || 'gemini-3-flash-preview'
    };
}
function redact(value, config) {
    let text = String(value || '');
    const key = String(config.apiKey || '').replace(/^Bearer\s+/i, '');
    for (const secret of [key, encodeURIComponent(key)]) if (secret) text = text.split(secret).join('[已隐藏]');
    return text.replace(/Bearer\s+[^\s"<>]+/gi, 'Bearer [已隐藏]')
        .replace(/sk-[a-zA-Z0-9_-]+/g, '[已隐藏]')
        .replace(/((?:api[_-]?key|token|authorization|password)\s*["']?\s*[:=]\s*["']?)[^\s,"'<>}]+/gi, '$1[已隐藏]')
        .replace(/https?:\/\/[^\s"<>]+/gi, value => { try { const u = new URL(value); return u.origin + u.pathname; } catch (_) { return '[地址已隐藏]'; } })
        .replace(/<[^>]*>/g, ' ').slice(0, 1600);
}
function publicConfiguration(config) {
    let endpoint = '地址格式无效';
    try { const url = new URL(config.endpoint); endpoint = url.origin + url.pathname; } catch (_) {}
    return { endpoint: redact(endpoint, config), model: redact(config.model, config), keySource: config.keySource, configured: Boolean(config.apiKey) };
}
async function diagnose(config, fetchImpl) {
    const attempts = [];
    const started = Date.now();
    if (!config.apiKey) return { ...publicConfiguration(config), ok: false, attempts, error: '未配置分类密钥', elapsedMs: 0 };
    try {
        await decideMemoryWrite({ ...config, timeoutMs: 45000,
            incoming: { content: '连接诊断：测试物品是蓝色。', tags: ['连接测试'] },
            candidates: [{ id: 'diagnostic-only', content: '连接诊断：测试物品是红色。', tags: ['连接测试'], similarity: 0.8 }],
            fetchImpl: async (url, options) => {
                // No caller-controlled destination, no memories, no redirects carrying credentials.
                const response = await fetchImpl(url, { ...options, redirect: 'manual', size: 16384 });
                const row = { status: response.status, jsonMode: Boolean(JSON.parse(options.body).response_format),
                    requestId: redact(response.headers?.get('x-request-id') || response.headers?.get('request-id') || response.headers?.get('cf-ray') || '', config) };
                attempts.push(row);
                if (!response.ok) {
                    try {
                        let raw = '';
                        if (response.body?.[Symbol.asyncIterator]) {
                            const chunks = []; let bytes = 0;
                            for await (const chunk of response.body) {
                                const buffer = Buffer.from(chunk);
                                bytes += buffer.length;
                                if (bytes > 16384) throw new Error('response too large');
                                chunks.push(buffer);
                            }
                            raw = Buffer.concat(chunks).toString('utf8');
                        } else { raw = await response.text(); }
                        let detail = raw;
                        try { const json = JSON.parse(raw); detail = json.error?.message || json.message || json.error?.code || '上游返回错误，但没有提供说明'; } catch (_) {}
                        row.detail = redact(detail, config);
                    } catch (_) { row.detail = '错误响应过大或无法读取'; }
                }
                return response;
            }
        });
        return { ...publicConfiguration(config), ok: true, attempts, elapsedMs: Date.now() - started };
    } catch (error) {
        return { ...publicConfiguration(config), ok: false, attempts, elapsedMs: Date.now() - started,
            error: error.name === 'AbortError' ? '请求超过 45 秒，已停止' : redact(error.message, config) };
    }
}
function router(fetchImpl, getConfig = configuration, getFlow = () => null) {
    const result = require('express').Router();
    let running = false, nextAllowed = 0;
    result.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    result.get('/', (_req, res) => {
        try { res.json({ ...publicConfiguration(getConfig()), flow: getFlow() }); }
        catch (_) { res.status(500).json({ error: '无法读取记忆流程状态' }); }
    });
    result.post('/', async (_req, res) => {
        if (running || Date.now() < nextAllowed) return res.status(429).json({ error: '请等待当前测试完成，间隔 30 秒后再试' });
        running = true; nextAllowed = Date.now() + 30000;
        try { res.json(await diagnose(getConfig(), fetchImpl)); }
        catch (_) { res.status(500).json({ error: '诊断暂时不可用，请稍后重试' }); }
        finally { running = false; }
    });
    return result;
}
module.exports = { configuration, publicConfiguration, redact, diagnose, router };
