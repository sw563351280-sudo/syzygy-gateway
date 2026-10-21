#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { recallCrumbs } = require('../crumb-recall');
const { requestEmbeddingBatch } = require('../crumb-embedding-backfill');

const root = path.join(__dirname, '..');
const patterns = [
    ['卫星梦', /卫星|做梦|梦到/], ['账单', /账单|缴费/], ['拼豆', /拼豆/], ['日记', /日记/],
    ['麻辣烫', /麻辣烫/], ['电影', /电影/], ['香水', /香水/], ['烤肉', /烤肉/],
    ['逛街', /逛街|逛逛|商场/], ['穿搭', /穿搭|这一身/], ['身份焦虑', /模型|版本|变了|是不是你/],
    ['泛情绪', /脑子.*乱|抱抱|难受/], ['首页设计', /首页/], ['背景图', /背景图|壁纸/],
    ['猫咪', /小猫|妹妹/], ['吃饭', /午饭|中午吃|晚饭/], ['天气', /风大|下雨|台风/],
    ['记账', /账本|记账/], ['内容平台', /小红书|抖音/], ['三方工作区', /工作区|三方/]
];

function clean(text) { return String(text || '').replace(/^\s*⟦ts:[^⟧]+⟧\s*/, '').trim(); }

function loadUserRows() {
    const directory = path.join(root, 'data', 'transcripts');
    const files = fs.readdirSync(directory).filter(file => /^2026-(?:09|10)\.json$/.test(file)).sort();
    const rows = [];
    for (const file of files) {
        const chunks = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
        for (const chunk of chunks) {
            const recent = [];
            for (const message of chunk.messages || []) {
                if (message?.role !== 'user' || !clean(message.content)) continue;
                rows.push({ text: clean(message.content), time: message.time || chunk.timestamp, recent: recent.slice(-4) });
                recent.push(clean(message.content));
            }
        }
    }
    return rows;
}

function chooseSamples(rows) {
    const used = new Set();
    return patterns.map(([topic, expression]) => {
        const row = [...rows].reverse().find(candidate => expression.test(candidate.text)
            && !/^【溯星小屋三方共创工作区/.test(candidate.text)
            && !/开工清单|修天气|快再写一条进去|这个也删不掉/.test(candidate.text)
            && !used.has(`${candidate.time}\0${candidate.text}`));
        if (!row) return null;
        used.add(`${row.time}\0${row.text}`);
        return { topic, ...row };
    }).filter(Boolean);
}

async function main() {
    const apiKey = process.env.EMBEDDING_API_KEY;
    if (!apiKey) throw new Error('EMBEDDING_API_KEY is required');
    const samples = chooseSamples(loadUserRows());
    const texts = samples.flatMap(sample => [sample.text, sample.recent.join('\n') || sample.text]);
    const vectors = await requestEmbeddingBatch({ texts, apiKey, fetchImpl: fetch,
        endpoint: 'https://api.siliconflow.cn/v1/embeddings', model: 'BAAI/bge-m3', timeoutMs: 60000 });
    const crumbs = JSON.parse(fs.readFileSync(path.join(root, 'data', 'crumbs.json'), 'utf8'));
    const embeddings = JSON.parse(fs.readFileSync(path.join(root, 'data', 'crumb_embeddings.json'), 'utf8'));
    const report = samples.map((sample, index) => {
        const sampleTime = Date.parse(sample.time);
        const eligible = crumbs.filter(crumb => (Date.parse(crumb.happened_at || crumb.created_at) || 0) < sampleTime);
        const result = recallCrumbs(eligible, { currentText: sample.text, recentUserTexts: sample.recent,
            currentEmbedding: vectors[index * 2], recentEmbedding: vectors[index * 2 + 1], embeddings,
            limit: 5, diagnostic: true });
        return { topic: sample.topic, at: sample.time, candidates: result.results.map(item => ({
            id: item.id, band: item.band, matched_on: item.matched_on,
            score: Number(item.score.toFixed(3)), vector: item.vector_score === null ? null : Number(item.vector_score.toFixed(3)),
            lexical: item.lexical_score, date: item.happened_at || item.created_at,
            current_vector: item.current_vector_score === null ? null : Number(item.current_vector_score.toFixed(3)),
            recent_vector: item.recent_vector_score === null ? null : Number(item.recent_vector_score.toFixed(3)),
            current_lexical: item.current_lexical_score, recent_lexical: item.recent_lexical_score,
            entities: (item.entities || []).slice(0, 4), tags: (item.tags || []).slice(0, 4)
        })) };
    });
    const target = path.join(root, 'data', 'crumb_recall_calibration.json');
    fs.writeFileSync(target, JSON.stringify({ generated_at: new Date().toISOString(), sample_count: report.length, report }, null, 2));
    process.stdout.write(JSON.stringify({ status: 'completed', samples: report.length, target }) + '\n');
}

main().catch(error => { process.stderr.write(`[碎屑召回标定] ${error.message}\n`); process.exitCode = 1; });
