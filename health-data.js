'use strict';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const HEALTH_DATA_TYPES = new Set(['all', 'sleep', 'heart_rate', 'steps']);

function getShanghaiDate(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(now);
    const values = Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

function normalizeDate(value, now = new Date()) {
    if (value === undefined || value === null || value === '') return getShanghaiDate(now);
    const date = String(value);
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
        throw new Error('日期必须是 YYYY-MM-DD');
    }
    return date;
}

function healthDataStatus(env = process.env) {
    const enabled = env.HEALTH_DATA_ENABLED === 'true';
    const serviceUrl = String(env.HEALTH_SERVICE_URL || 'http://127.0.0.1:8091').trim();
    const serviceToken = String(env.HEALTH_SERVICE_TOKEN || '');
    let urlValid = false;
    try {
        const parsed = new URL(serviceUrl);
        urlValid = parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname) && !parsed.username && !parsed.password;
    } catch (_) {}
    return {
        enabled,
        configured: enabled && urlValid && serviceToken.length >= 32,
        reason: !enabled ? 'disabled' : !urlValid ? 'invalid_service_url' : serviceToken.length < 32 ? 'missing_service_token' : 'ready',
        serviceUrl: urlValid ? serviceUrl : null,
    };
}

async function fetchHealthSummary(args = {}, { env = process.env, fetchImpl = global.fetch, now = new Date() } = {}) {
    const status = healthDataStatus(env);
    if (!status.configured) throw new Error('健康数据服务未启用或未完成配置');
    if (typeof fetchImpl !== 'function') throw new Error('运行环境不支持 HTTP 请求');

    const date = normalizeDate(args.date, now);
    const type = String(args.type || 'all');
    if (!HEALTH_DATA_TYPES.has(type)) throw new Error('type 仅支持 all、sleep、heart_rate 或 steps');

    const url = new URL(status.serviceUrl);
    url.pathname = '/health';
    url.search = new URLSearchParams({ date, type }).toString();
    let response;
    try {
        response = await fetchImpl(url, {
            headers: { Authorization: `Bearer ${env.HEALTH_SERVICE_TOKEN}`, Accept: 'application/json' },
            signal: AbortSignal.timeout(10_000),
        });
    } catch (_) {
        throw new Error('健康数据服务暂时不可用');
    }

    const raw = await response.text();
    let payload;
    try { payload = JSON.parse(raw); } catch (_) { throw new Error('健康数据服务返回格式异常'); }
    if (!response.ok) throw new Error(payload?.error || '健康数据查询失败');
    if (!payload || payload.ok !== true || typeof payload.data !== 'object') throw new Error('健康数据服务返回格式异常');

    const result = {
        source: '小米运动健康（亲友授权数据）',
        date: payload.date || date,
        requested_type: type,
        data: payload.data,
        note: '仅供健康记录参考，不构成医疗建议。',
    };
    const output = JSON.stringify(result);
    if (output.length <= 24_000) return output;
    return JSON.stringify({
        source: result.source,
        date: result.date,
        requested_type: type,
        data_truncated: true,
        note: '单日原始记录过多，未返回详情；请改为查询单一数据类型。仅供健康记录参考，不构成医疗建议。',
    });
}

module.exports = { HEALTH_DATA_TYPES, getShanghaiDate, normalizeDate, healthDataStatus, fetchHealthSummary };
