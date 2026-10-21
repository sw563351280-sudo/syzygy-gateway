#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { runCrumbEmbeddingBackfill } = require('../crumb-embedding-backfill');

const root = path.join(__dirname, '..');

runCrumbEmbeddingBackfill({
    crumbsFile: path.join(root, 'data', 'crumbs.json'),
    cacheFile: path.join(root, 'data', 'crumb_embeddings.json'),
    seedCacheFile: path.join(root, 'data', 'embeddings_cache.json'),
    checkpointFile: path.join(root, 'data', 'crumb_embedding_backfill.jsonl'),
    apiKey: process.env.EMBEDDING_API_KEY,
    batchSize: Math.max(1, Math.min(64, Number(process.env.CRUMB_EMBEDDING_BATCH_SIZE || 24)))
}).then(result => {
    process.stdout.write(JSON.stringify(result) + '\n');
    if (result.status !== 'completed') process.exitCode = 2;
}).catch(error => {
    process.stderr.write(`[碎屑向量补齐] ${error.message}\n`);
    process.exitCode = 1;
});
