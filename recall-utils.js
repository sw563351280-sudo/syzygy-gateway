'use strict';

const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
const GENERIC_QUERY_WORDS = new Set('我 你 她 他 它 我们 你们 他们 江鱼 沈望 现在 今天 昨天 前天 那天 之前 以前 上次 这个 那个 什么 怎么 为什么 记得 还记得 说过 聊过 当时 一下 一个'.split(' '));

function chinaDay(value) {
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? new Date(time + 8 * 3600000).toISOString().slice(0, 10) : '';
}

function relativeTimeLabel(value, now = new Date()) {
    const day = chinaDay(value); const today = chinaDay(now);
    if (!day || !today) return '';
    const dayNumber = text => Date.parse(`${text}T00:00:00Z`) / 86400000;
    const days = Math.max(0, Math.round(dayNumber(today) - dayNumber(day)));
    if (days === 0) return '今天';
    if (days === 1) return '昨天';
    if (days === 2) return '前天';
    if (days < 7) return `${days}天前`;
    if (days < 35) return `约${Math.max(1, Math.round(days / 7))}周前`;
    if (days < 365) return `约${Math.max(1, Math.round(days / 30))}个月前`;
    return `约${Math.max(1, Math.round(days / 365))}年前`;
}

function formatRecallDate(value, now = new Date()) {
    const day = chinaDay(value);
    if (!day) return '日期未注明';
    const relative = relativeTimeLabel(value, now);
    return relative ? `${day}（${relative}）` : day;
}

function normalizedTerms(text) {
    return [...new Set([...segmenter.segment(String(text || ''))]
        .filter(part => part.isWordLike)
        .map(part => part.segment.normalize('NFKC').toLowerCase().trim())
        .filter(term => term && !GENERIC_QUERY_WORDS.has(term)))];
}

function bigrams(text) {
    const value = String(text || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const result = [];
    for (let i = 0; i < value.length - 1; i++) result.push(value.slice(i, i + 2));
    return result;
}

function transcriptMessageScore(content, query) {
    const text = String(content || ''); const wanted = String(query || '').trim();
    if (!text || !wanted) return 0;
    let score = text.includes(wanted) ? 100 : 0;
    const terms = normalizedTerms(wanted);
    for (const term of terms) {
        if (text.includes(term)) score += term.length >= 3 ? 12 : 7;
    }
    const queryPairs = new Set(bigrams(wanted));
    if (queryPairs.size) {
        const textPairs = new Set(bigrams(text));
        let overlap = 0;
        for (const pair of queryPairs) if (textPairs.has(pair)) overlap++;
        score += (overlap / queryPairs.size) * 10;
    }
    return score;
}

function selectTranscriptPreview(messages, query, { maxMessages = 4 } = {}) {
    const rows = Array.isArray(messages) ? messages : [];
    if (!rows.length) return { start: 0, anchor: -1, messages: [] };
    const scores = rows.map(message => transcriptMessageScore(message?.content, query));
    let anchor = 0;
    for (let i = 1; i < scores.length; i++) if (scores[i] > scores[anchor]) anchor = i;
    const count = Math.max(1, Math.min(maxMessages, rows.length));
    let start = Math.max(0, anchor - Math.floor((count - 1) / 2));
    start = Math.min(start, rows.length - count);
    return { start, anchor, score: scores[anchor], messages: rows.slice(start, start + count) };
}

module.exports = { chinaDay, formatRecallDate, relativeTimeLabel, selectTranscriptPreview, transcriptMessageScore };
