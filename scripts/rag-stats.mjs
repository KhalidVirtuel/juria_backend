// scripts/rag-stats.mjs
import 'dotenv/config';
import { QdrantClient } from '@qdrant/js-client-rest';

const {
  QDRANT_URL = 'http://localhost:6333',
  QDRANT_API_KEY = '',
  QDRANT_COLLECTION = 'company_knowledge_fr',
} = process.env;

async function main() {
  const client = new QdrantClient({ url: QDRANT_URL, apiKey: QDRANT_API_KEY || undefined });

  let nextPage = null;
  const counts = new Map();
  let total = 0;

  while (true) {
    const res = await client.scroll(QDRANT_COLLECTION, {
      with_payload: true,
      with_vector: false,
      limit: 2000,
      offset: nextPage ?? undefined,
    });

    const pts = res.points || [];
    for (const p of pts) {
      total++;
      const path = p.payload?.path || '(no-path)';
      counts.set(path, (counts.get(path) || 0) + 1);
    }

    if (!res.next_page_offset) break;
    nextPage = res.next_page_offset;
  }

  console.log(`Total points: ${total}`);
  console.log('Chunks par fichier (path):');
  const rows = [...counts.entries()].sort((a,b) => b[1] - a[1]);
  for (const [path, n] of rows) {
    console.log(`  ${n.toString().padStart(5)}  ${path}`);
  }
}

main().catch(e => {
  console.error('Erreur rag-stats:', e);
  process.exit(1);
});
