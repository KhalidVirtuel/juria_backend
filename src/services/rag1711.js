// src/services/rag.js
import { embedTexts, chatCompletion } from './llm.js';
import { searchSimilar, upsertPointsBatch } from './qdrant.js';
import { cfg } from '../config.js';

/**
 * Répond à une question en s’appuyant sur le contexte Qdrant (RAG).
 * metaFilter permet de filtrer par userId, fileId, etc.
 */
export async function ragAnswer({ question, metaFilter = {} }) {
  const [qVec] = await embedTexts([question]);

  // Construire le filtre Qdrant
  const filter =
    metaFilter && Object.keys(metaFilter).length
      ? {
          must: Object.entries(metaFilter).map(([k, v]) => ({
            key: k,
            match: { value: v },
          })),
        }
      : null;

  // Recherche de passages similaires
  let results = [];
  try {
    results = await searchSimilar(qVec, 6, filter);
  } catch (e) {
    console.warn('[Qdrant search error]', e);
  }

  const context = (results || [])
    .map((r) => '• ' + (r.payload?.text || ''))
    .join('\n');

  // Appel LLM avec contexte
  const system = {
    role: 'system',
    content:
      'Tu es un assistant juridique. Réponds de façon précise et concise en t’appuyant sur le contexte si pertinent.',
  };
  const user = {
    role: 'user',
    content: `Question:\n${question}\n\nContexte pertinent (peut être vide):\n${context}`,
  };

  const msg = await chatCompletion([system, user]);
  return { answer: msg.content, context };
}

/**
 * Indexe du texte “brut” (déjà extrait) dans Qdrant pour un fichier donné.
 * - userId: propriétaire
 * - fileId: id Document en BDD (permettra delete par fichier)
 * - text: contenu texte déjà extrait
 * - metadata: objet libre (ex: { fileName })
 */
export async function upsertDocumentIntoQdrant({
  userId,
  fileId,
  text,
  metadata = {},
}) {
  const collection = cfg.qdrant.collection || 'company_knowledge_fr';
  const CHUNK_SIZE = parseInt(process.env.RAG_CHUNK_SIZE || '', 10) || 900;
  const CHUNK_OVERLAP =
    parseInt(process.env.RAG_CHUNK_OVERLAP || '', 10) || 150;

  // Découpe en chunks qui se recouvrent légèrement
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(text.length, i + CHUNK_SIZE);
    const piece = text.slice(i, end).trim();
    if (piece) chunks.push(piece);
    i += CHUNK_SIZE - CHUNK_OVERLAP;
    if (i < 0 || i >= text.length) break;
  }

  if (!chunks.length) return { chunks: 0, points: 0 };

  // Embeddings en lots
  const BATCH_EMBED = parseInt(process.env.RAG_EMBED_BATCH || '', 10) || 24;
  const vectors = [];
  for (let k = 0; k < chunks.length; k += BATCH_EMBED) {
    const slice = chunks.slice(k, k + BATCH_EMBED);
    const emb = await embedTexts(slice);
    vectors.push(...emb);
  }

  // Construction des points
  const points = vectors.map((vec, idx) => ({
    vector: vec,
    payload: {
      userId,
      fileId,
      chunkIndex: idx,
      text: chunks[idx],
      ...metadata,
    },
  }));

  // Upsert dans Qdrant
  await upsertPointsBatch(points, collection);
  return { chunks: chunks.length, points: points.length };
}
