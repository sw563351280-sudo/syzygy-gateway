(function (root) {
    'use strict';
    const num = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
    function normalize(u) {
        if (!u) return null;
        const read = num(u.cache_read_input_tokens ?? u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens);
        const split = u.cache_creation;
        const write = num(u.cache_creation_input_tokens ?? u.prompt_tokens_details?.cache_write_tokens
            ?? (split ? (split.ephemeral_5m_input_tokens || 0) + (split.ephemeral_1h_input_tokens || 0) : null));
        const native = u.prompt_tokens == null && u.input_tokens != null;
        const input = num(u.prompt_tokens ?? u.input_tokens);
        return { total: input === null ? null : native ? input + (read || 0) + (write || 0) : input,
            read, write, output: num(u.completion_tokens ?? u.output_tokens) };
    }
    function tracker(now = Date.now) {
        const start = now(); let value = null, authoritative = false, raw = {};
        return {
            accept(event) {
                if (event.syzygy_usage) { value = event.syzygy_usage; authoritative = true; }
                else if (event.usage && !authoritative) {
                    raw = { ...raw, ...event.usage, prompt_tokens_details: { ...raw.prompt_tokens_details, ...event.usage.prompt_tokens_details } };
                    value = normalize(raw);
                }
            },
            finish() { return value ? { ...value, elapsedMs: Math.max(0, now() - start) } : null; },
        };
    }
    const exact = v => num(v) === null ? '—' : v.toLocaleString('en-US');
    const short = v => num(v) === null ? '—' : v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(v);
    function html(u) {
        if (!u || !['total', 'read', 'write', 'output'].some(k => num(u[k]) !== null)) return '';
        const seconds = num(u.elapsedMs) === null ? null : u.elapsedMs / 1000;
        const duration = seconds === null ? '—' : seconds.toFixed(1) + 's';
        const hit = num(u.read) !== null && num(u.total) > 0 ? (100 * u.read / u.total).toFixed(1) + '%' : '—';
        const speed = num(u.output) !== null && seconds > 0 ? (u.output / seconds).toFixed(1) + ' tokens/s' : '—';
        return '<details class="message-usage"><summary aria-label="查看本条回复用量详情">'
            + ['↑ ' + short(u.total), '命中 ' + short(u.read), '写入 ' + short(u.write), '↓ ' + short(u.output), duration]
                .map(s => '<span>' + s + '</span>').join('<span aria-hidden="true">·</span>')
            + '</summary><div class="message-usage-detail">总输入 ' + exact(u.total) + ' tokens · 缓存读取 ' + exact(u.read)
            + ' · 缓存写入 ' + exact(u.write) + ' · 输出 ' + exact(u.output) + '<br>缓存命中率 ' + hit
            + ' · 平均速度 ' + speed + ' · 耗时 ' + duration
            + '<br>本次请求汇总；平均速度包含等待和工具处理时间。未返回的统计显示为 —。</div></details>';
    }
    const api = { normalize, tracker, html };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.MessageUsage = api;
})(typeof window === 'undefined' ? globalThis : window);
