import { QdrantClient } from '@qdrant/js-client-rest';
import { cfg } from '../config.js';

// Déduis la dimension depuis le modèle (fallback ENV ou 1536)
const MODEL_DIMS = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  // ajoute ici d'autres modèles si tu changes
};
const VECTOR_SIZE = parseInt(process.env.EMBEDDING_DIM || MODEL_DIMS[cfg.embeddingModel] || '1536', 10);

export const qdrant = new QdrantClient({
  url: cfg.qdrantUrl,
  apiKey: cfg.qdrantApiKey || undefined,
});

async function getCollectionInfo(name) {
  try {
    return await qdrant.getCollection(name);
  } catch {
    return null;
  }
}

export async function ensureCollection() {
  const name = cfg.qdrantCollection;
  const info = await getCollectionInfo(name);

  // S'il n'existe pas -> création
  if (!info) {
    await qdrant.createCollection(name, {
      vectors: { size: VECTOR_SIZE, distance: 'Cosine' },
    });
    return name;
  }

  // S'il existe -> vérifier la dimension
  // Qdrant 1.15 renvoie info comme { result: { config: { params: { vectors: { size }}}}}
  const existingSize =
    info?.result?.config?.params?.vectors?.size ??
    info?.result?.config?.params?.vectors?.default?.size; // si multivector

  if (existingSize && Number(existingSize) !== VECTOR_SIZE) {
    console.warn(
      `[Qdrant] Dimension mismatch: existing=${existingSize} vs expected=${VECTOR_SIZE}. Recreating collection "${name}".`
    );
    await qdrant.deleteCollection(name);
    await qdrant.createCollection(name, {
      vectors: { size: VECTOR_SIZE, distance: 'Cosine' },
    });
  }
  return name;
}

export async function upsertPoints(points) {
  await ensureCollection();
  return qdrant.upsert(cfg.qdrantCollection, { points });
}

export async function searchSimilar(vector, limit = 6, filter = null) {
  await ensureCollection();
  try {
    return await qdrant.search(cfg.qdrantCollection, {
      vector,
      limit,
      filter: filter || undefined,
    });
  } catch (e) {
    console.error('[Qdrant search error]', e?.response?.data || e);
    // En cas d’erreur, retourne un tableau vide pour ne pas casser la réponse IA
    return [];
  }
}
