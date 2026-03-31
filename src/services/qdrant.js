
// src/services/qdrant.js
import { QdrantClient } from '@qdrant/js-client-rest';
import { cfg } from '../config.js';
console.log("cfg")
console.log(cfg)
const client = new QdrantClient({
  url: cfg.qdrant?.url || 'http://qdrant:6333',
  ...(cfg.qdrant?.apiKey ? { apiKey: cfg.qdrant.apiKey } : {}),
});

/** S’assure que la collection existe (sinon la crée). */
export async function ensureCollection(name = cfg.qdrant.collection) {
  try {
    await client.getCollection(name);
  } catch {
    await client.createCollection(name, {
      vectors: { size: cfg.embedding?.dimension || 1536, distance: 'Cosine' },
    });
  }
}

/** Recherche des passages similaires à un vecteur de requête. */
export async function searchSimilar(
  queryVector,
  limit = 6,
  filter = null,
  collection = cfg.qdrant.collection
) {
  await ensureCollection(collection);

  const res = await client.search(collection, {
    vector: queryVector,
    limit,
    filter: filter || undefined,
    with_payload: true,
  });

  return res || [];
}

/** Upsert en petits batches pour éviter l’OOM. */
export async function upsertPointsBatch(points, collection = cfg.qdrant.collection) {
  await ensureCollection(collection);

  const BATCH = 128;
  for (let i = 0; i < points.length; i += BATCH) {
    const slice = points.slice(i, i + BATCH);
    await client.upsert(collection, {
      wait: true,
      points: slice.map((p, idx) => ({
        id: p.id ?? `${Date.now()}_${i + idx}`,
        vector: p.vector,
        payload: p.payload,
      })),
    });
  }
}

/** Wrapper attendu par ragdata.js : appelle upsertPointsBatch. */
export async function upsertPoints(collection = cfg.qdrant.collection, points = []) {
  return upsertPointsBatch(points, collection);
}

/** Supprime via un filtre arbitraire (wrapper attendu par ragdata.js). */
export async function deleteByFilter(collection = cfg.qdrant.collection, filter) {
  await ensureCollection(collection);
  return client.delete(collection, {
    wait: true,
    filter: filter || undefined,
  });
}

/** Supprime tous les points liés à un fichier (via payload.fileId). */
export async function deleteByFileId(fileId, collection = cfg.qdrant.collection) {
  await ensureCollection(collection);
  await client.delete(collection, {
    wait: true,
    filter: { must: [{ key: 'fileId', match: { value: fileId } }] },
  });
}

/** Supprime la collection (ignore si absente). */
export async function deleteCollection(name = cfg.qdrant.collection) {
  try {
    await client.deleteCollection(name);
  } catch {
    // no-op
  }
}

/** Reset complet: drop + recreate. */
export async function resetCollection(name = cfg.qdrant.collection) {
  await deleteCollection(name);
  await client.createCollection(name, {
    vectors: { size: cfg.embedding?.dimension || 1536, distance: 'Cosine' },
  });
}
