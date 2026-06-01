// In-memory cache of parsed embedding vectors for fast cosine similarity search
// Avoids JSON.parse on every search by caching Float64Array vectors keyed by memory ID

const cache = new Map(); // id → Float64Array

function cosineSimilarity(a, b) {
  if (a.length !== b.length || !a.length) return null;
  let dot = 0, aMag = 0, bMag = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i], bv = b[i];
    if (!Number.isFinite(av) || !Number.isFinite(bv)) return null;
    dot += av * bv;
    aMag += av * av;
    bMag += bv * bv;
  }
  if (!aMag || !bMag) return null;
  return dot / (Math.sqrt(aMag) * Math.sqrt(bMag));
}

function parseVector(embeddingJson) {
  try {
    const v = JSON.parse(embeddingJson);
    if (!Array.isArray(v) || v.length === 0) return null;
    if (v.some(x => !Number.isFinite(Number(x)))) return null;
    return new Float64Array(v);
  } catch { return null; }
}

function getVector(id, embeddingJson) {
  if (cache.has(id)) return cache.get(id);
  const vector = parseVector(embeddingJson);
  if (vector) cache.set(id, vector);
  return vector;
}

// Rank rows by cosine similarity to queryVector
function rankRows(rows, queryVector, topK, minScore = 0.18) {
  const qVec = queryVector instanceof Float64Array ? queryVector : new Float64Array(queryVector);
  const threshold = Number.isFinite(minScore) ? minScore : 0;
  const ranked = [];

  for (const row of rows) {
    const vector = getVector(row.id, row.embedding_json);
    if (!vector || vector.length !== qVec.length) continue;
    const score = cosineSimilarity(qVec, vector);
    if (score === null) continue;
    if (threshold > 0 && score < threshold) continue;
    ranked.push({ ...row, score });
  }

  return ranked.sort((a, b) => b.score - a.score).slice(0, topK);
}

function invalidate(id) {
  if (id) cache.delete(id);
  else cache.clear();
}

function stats() {
  let bytes = 0;
  for (const v of cache.values()) bytes += v.byteLength;
  return { entries: cache.size, memoryBytes: bytes };
}

module.exports = { rankRows, invalidate, stats };
