// scripts/qdrant-reset.mjs
import dotenv from 'dotenv';
import { QdrantClient } from '@qdrant/js-client-rest';
import readline from 'readline';

// Charger .env.local en priorité
dotenv.config({ path: '.env.local' });
dotenv.config();

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const QDRANT_COLLECTION = process.env.QDRANT_COLLECTION || 'company_knowledge_fr';

// Interface pour confirmation
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function resetCollection() {
  try {
    console.log('🔄 Connexion à Qdrant...');
    console.log(`📍 URL: ${QDRANT_URL}`);
    console.log(`📦 Collection: ${QDRANT_COLLECTION}\n`);

    const client = new QdrantClient({
      url: QDRANT_URL,
      apiKey: process.env.QDRANT_API_KEY,
    });

    // Vérifier la collection existe
    const collections = await client.getCollections();
    const exists = collections.collections.some(c => c.name === QDRANT_COLLECTION);

    if (!exists) {
      console.log(`❌ Collection "${QDRANT_COLLECTION}" n'existe pas`);
      rl.close();
      return;
    }

    // Compter les points
    const info = await client.getCollection(QDRANT_COLLECTION);
    const count = info.points_count;

    console.log(`📊 Points actuels: ${count}`);

    if (count === 0) {
      console.log('✅ Collection déjà vide');
      rl.close();
      return;
    }

    // Demander confirmation
    const answer = await question(`\n⚠️  Voulez-vous supprimer les ${count} points ? (oui/non): `);

    if (answer.toLowerCase() !== 'oui') {
      console.log('❌ Opération annulée');
      rl.close();
      return;
    }

    // Supprimer tous les points
    console.log('\n🗑️  Suppression en cours...');
    
    await client.delete(QDRANT_COLLECTION, {
      filter: {
        must: [
          {
            key: 'exists',
            match: { any: [true, false] }
          }
        ]
      }
    });

    // Vérifier
    const newInfo = await client.getCollection(QDRANT_COLLECTION);
    console.log(`✅ Collection vidée (${newInfo.points_count} points restants)`);
    console.log('\n🚀 Vous pouvez maintenant lancer:');
    console.log('   POST /api/rag/rebuildcat');
    console.log('   POST /api/rag/rebuildDoc');

  } catch (error) {
    console.error('❌ Erreur:', error.message);
  } finally {
    rl.close();
  }
}

resetCollection();