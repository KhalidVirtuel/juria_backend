// scripts/qdrant-reset.mjs
import 'dotenv/config';
import { QdrantClient } from '@qdrant/js-client-rest';

const {
  QDRANT_URL = 'http://localhost:6333',
  QDRANT_API_KEY = '',
} = process.env;

async function main() {
  const client = new QdrantClient({ url: QDRANT_URL, apiKey: QDRANT_API_KEY || undefined });

  const { collections } = await client.getCollections();
  if (!collections?.length) {
    console.log('✅ Aucune collection à supprimer.');
    return;
  }

  console.log(`Collections trouvées: ${collections.map(c => c.name).join(', ')}`);
  for (const c of collections) {
    console.log(`🗑️  Suppression: ${c.name} ...`);
    try {
      await client.deleteCollection(c.name);
      console.log(`   → OK`);
    } catch (e) {
      console.error(`   → Échec sur ${c.name}:`, e?.message || e);
    }
  }
  console.log('✅ Réinitialisation Qdrant terminée.');
}

main().catch((e) => {
  console.error('Erreur reset Qdrant:', e);
  process.exit(1);
});
