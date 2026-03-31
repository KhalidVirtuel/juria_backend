// scripts/qdrant-reset-safe.mjs
import 'dotenv/config';
import { QdrantClient } from '@qdrant/js-client-rest';
import readline from 'readline';

const {
  QDRANT_URL = 'http://localhost:6333',
  QDRANT_API_KEY = '',
} = process.env;

const client = new QdrantClient({
  url: QDRANT_URL,
  apiKey: QDRANT_API_KEY || undefined,
});

function askConfirmation(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'oui' || answer.toLowerCase() === 'o' || answer.toLowerCase() === 'y');
    });
  });
}

async function resetCollections() {
  console.log('🗑️  RESET QDRANT COLLECTIONS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  
  try {
    // Lister toutes les collections
    const collections = await client.getCollections();
    const collectionNames = collections.collections.map(c => c.name);
    
    if (collectionNames.length === 0) {
      console.log('✅ Aucune collection trouvée.');
      return;
    }
    
    console.log('📚 Collections trouvées:');
    for (const name of collectionNames) {
      const info = await client.getCollection(name);
      const count = info.points_count || 0;
      console.log(`   • ${name} (${count} points)`);
    }
    
    console.log('');
    console.log('⚠️  ATTENTION: Cette opération va supprimer TOUTES les collections !');
    console.log('   Toutes les données vectorisées seront perdues.');
    console.log('');
    
    const confirmed = await askConfirmation('Êtes-vous sûr de vouloir continuer ? (oui/non): ');
    
    if (!confirmed) {
      console.log('❌ Opération annulée.');
      return;
    }
    
    console.log('');
    console.log('🗑️  Suppression en cours...');
    console.log('');
    
    // Supprimer chaque collection
    for (const name of collectionNames) {
      try {
        process.stdout.write(`   🗑️  ${name}...`);
        await client.deleteCollection(name);
        console.log(' ✅ OK');
      } catch (e) {
        console.log(` ❌ Erreur: ${e.message}`);
      }
    }
    
    console.log('');
    console.log('✅ Réinitialisation terminée avec succès !');
    console.log('');
    console.log('📝 Prochaines étapes:');
    console.log('   1. Relancer l\'ingestion du catalogue:');
    console.log('      docker exec -it juria-node node scripts/rag-ingest.mjs data/uploads/catalogue_fr');
    console.log('');
    console.log('   2. Relancer l\'ingestion des documents:');
    console.log('      docker exec -it juria-node node scripts/rag-ingest.mjs data/uploads/document_fr');
    
  } catch (e) {
    console.error('❌ Erreur:', e.message);
    process.exit(1);
  }
}

resetCollections();