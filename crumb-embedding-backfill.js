'use strict';

const fs = require('node:fs');

function readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}

function embeddingText(crumb) {
    return [crumb?.fact, ...(Array.isArray(crumb?.entities) ? crumb.entities : []), ...(Array.isArray(crumb?.tags) ? crumb.tags : [])]
        .filter(Boolean).join('\n').slice(0, 512);
}

function validEmbedding(value, dimension = 0) {
    return Array.isArray(value) && value.length > 0 && (!dimension || value.length === dimension)
        && value.every(number => Number.isFinite(number));
}

function readCheckpoint(file, dimension = 0) {
    const result = {};
    try {
        for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
            if (!line.trim()) continue;
            const item = JSON.parse(line);
            if (item?.id && validEmbedding(item.embedding, dimension)) result[item.id] = item.embedding;
        }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return result;
}

async function requestEmbeddingBatch({ texts, apiKey, fetchImpl, endpoint, model, timeoutMs }) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetchImpl(endpoint, {
            method: 'POST', signal: controller.signal,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${String(apiKey).replace(/^Bearer\s+/i, '')}` },
            body: JSON.stringify({ model, input: texts, encoding_format: 'float' })
        });
        if (!response.ok) throw new Error(`embedding API HTTP ${response.status}`);
        const payload = await response.json();
        const rows = Array.isArray(payload?.data) ? payload.data : [];
        const ordered = [...rows].sort((a, b) => Number(a?.index || 0) - Number(b?.index || 0)).map(row => row?.embedding || row);
        if (ordered.length !== texts.length || ordered.some(item => !validEmbedding(item))) throw new Error('embedding API returned an incomplete batch');
        return ordered;
    } finally { clearTimeout(timer); }
}

async function runCrumbEmbeddingBackfill(options = {}) {
    const {
        crumbsFile, cacheFile, seedCacheFile, checkpointFile = `${cacheFile}.crumb-backfill.jsonl`, apiKey,
        fetchImpl = global.fetch, endpoint = 'https://api.siliconflow.cn/v1/embeddings', model = 'BAAI/bge-m3',
        batchSize = 24, timeoutMs = 30000, logger = console
    } = options;
    if (!apiKey) return { status: 'skipped', reason: 'missing_api_key', total: 0, existing: 0, indexed: 0, remaining: 0 };
    if (!crumbsFile || !cacheFile || typeof fetchImpl !== 'function') throw new Error('crumb embedding backfill is not configured');

    const crumbs = readJson(crumbsFile, []).filter(item => item?.id && embeddingText(item));
    const initialCache = readJson(cacheFile, {});
    // Older deployments kept crumb vectors in the shared cache. Read it only as
    // a migration seed; never write crumb vectors back into that near-limit file.
    const seedCache = seedCacheFile ? readJson(seedCacheFile, {}) : {};
    const sample = [...Object.values(initialCache), ...Object.values(seedCache)].find(value => validEmbedding(value));
    const dimension = sample?.length || 0;
    const checkpoint = readCheckpoint(checkpointFile, dimension);
    const known = {};
    for (const crumb of crumbs) {
        const embedding = checkpoint[crumb.id] || initialCache[crumb.id] || seedCache[crumb.id];
        if (validEmbedding(embedding, dimension)) known[crumb.id] = embedding;
    }
    const missing = crumbs.filter(item => !validEmbedding(known[item.id], dimension));
    let indexed = Object.keys(checkpoint).filter(id => !initialCache[id] && !seedCache[id]).length;
    logger.log?.(`[碎屑向量补齐] total=${crumbs.length} existing=${crumbs.length - missing.length} remaining=${missing.length}`);

    for (let offset = 0; offset < missing.length; offset += batchSize) {
        const batch = missing.slice(offset, offset + batchSize);
        let vectors;
        try {
            vectors = await requestEmbeddingBatch({ texts: batch.map(embeddingText), apiKey, fetchImpl, endpoint, model, timeoutMs });
        } catch (batchError) {
            logger.warn?.(`[碎屑向量补齐] batch fallback: ${batchError.message}`);
            vectors = [];
            for (const item of batch) {
                const one = await requestEmbeddingBatch({ texts: [embeddingText(item)], apiKey, fetchImpl, endpoint, model, timeoutMs });
                vectors.push(one[0]);
            }
        }
        for (let i = 0; i < batch.length; i++) {
            if (dimension && vectors[i].length !== dimension) throw new Error(`embedding dimension mismatch: expected ${dimension}, received ${vectors[i].length}`);
            known[batch[i].id] = vectors[i];
            fs.appendFileSync(checkpointFile, JSON.stringify({ id: batch[i].id, embedding: vectors[i] }) + '\n', 'utf8');
            indexed++;
        }
        logger.log?.(`[碎屑向量补齐] progress=${Math.min(offset + batch.length, missing.length)}/${missing.length}`);
    }

    // The dedicated crumb cache stays small enough for an atomic JSON write.
    // Reload before the final merge so a concurrent crumb-only update survives.
    const latestCache = readJson(cacheFile, {});
    const merged = { ...latestCache, ...known };
    const temporary = `${cacheFile}.tmp-${process.pid}`;
    fs.writeFileSync(temporary, JSON.stringify(merged), 'utf8');
    fs.renameSync(temporary, cacheFile);
    try { fs.unlinkSync(checkpointFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return { status: 'completed', total: crumbs.length, existing: crumbs.length - missing.length, indexed, remaining: 0 };
}

module.exports = { embeddingText, readCheckpoint, requestEmbeddingBatch, runCrumbEmbeddingBackfill, validEmbedding };
