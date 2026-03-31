// scripts/qdrant-manage.mjs
import 'dotenv/config';
import { QdrantClient } from '@qdrant/js-client-rest';

const {
  QDRANT_URL = 'http://localhost:6333',
  QDRANT_API_KEY = '',
  QDRANT_COLLECTION = 'company_knowledge_fr',
} = process.env;

const client = new QdrantClient({
  url: QDRANT_URL,
  apiKey: QDRANT_API_KEY || undefined,
});

// Parse arguments
const args = process.argv.slice(2);
const command = args[0];
const collectionName = args[1];

async function listCollections() {
  console.log('📚 COLLECTIONS QDRANT');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  
  const collections = await client.getCollections();
  
  if (collections.collections.length === 0) {
    console.log('   Aucune collection trouvée.');
    return;
  }
  
  for (const col of collections.collections) {
    try {
      const info = await client.getCollection(col.name);
      const count = info.points_count || 0;
      const size = info.vectors_count || 0;
      console.log(`📁 ${col.name}`);
      console.log(`   Points: ${count.toLocaleString()}`);
      console.log(`   Vecteurs: ${size.toLocaleString()}`);
      console.log('');
    } catch (e) {
      console.log(`📁 ${col.name} (erreur: ${e.message})`);
    }
  }
}

async function deleteCollection(name) {
  console.log(`🗑️  Suppression de la collection: ${name}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  
  try {
    // Vérifier que la collection existe
    const info = await client.getCollection(name);
    const count = info.points_count || 0;
    
    console.log(`   Collection: ${name}`);
    console.log(`   Points: ${count.toLocaleString()}`);
    console.log('');
    
    await client.deleteCollection(name);
    console.log(`✅ Collection "${name}" supprimée avec succès`);
    
  } catch (e) {
    if (e.message.includes('Not found')) {
      console.error(`❌ Collection "${name}" n'existe pas`);
    } else {
      console.error(`❌ Erreur:`, e.message);
    }
    process.exit(1);
  }
}

async function deleteAllCollections() {
  console.log('🗑️  SUPPRESSION DE TOUTES LES COLLECTIONS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  
  const collections = await client.getCollections();
  const names = collections.collections.map(c => c.name);
  
  if (names.length === 0) {
    console.log('✅ Aucune collection à supprimer.');
    return;
  }
  
  console.log(`Collections à supprimer: ${names.join(', ')}`);
  console.log('');
  
  for (const name of names) {
    try {
      process.stdout.write(`   🗑️  ${name}...`);
      await client.deleteCollection(name);
      console.log(' ✅ OK');
    } catch (e) {
      console.log(` ❌ ${e.message}`);
    }
  }
  
  console.log('');
  console.log('✅ Toutes les collections ont été supprimées');
}

async function showInfo(name) {
  console.log(`📊 INFORMATIONS: ${name}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  
  try {
    const info = await client.getCollection(name);
    
    console.log(`Collection: ${name}`);
    console.log(`Status: ${info.status}`);
    console.log(`Points: ${(info.points_count || 0).toLocaleString()}`);
    console.log(`Vecteurs: ${(info.vectors_count || 0).toLocaleString()}`);
    console.log(`Segments: ${info.segments_count || 0}`);
    console.log('');
    console.log('Configuration:');
    console.log(`   Distance: ${info.config?.params?.vectors?.distance || 'N/A'}`);
    console.log(`   Dimension: ${info.config?.params?.vectors?.size || 'N/A'}`);
    
  } catch (e) {
    if (e.message.includes('Not found')) {
      console.error(`❌ Collection "${name}" n'existe pas`);
    } else {
      console.error(`❌ Erreur:`, e.message);
    }
    process.exit(1);
  }
}

function showHelp() {
  console.log('🔧 QDRANT MANAGER');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('Usage:');
  console.log('   node qdrant-manage.mjs <command> [options]');
  console.log('');
  console.log('Commandes:');
  console.log('   list                    Liste toutes les collections');
  console.log('   info <name>            Affiche les infos d\'une collection');
  console.log('   delete <name>          Supprime une collection spécifique');
  console.log('   delete-all             Supprime TOUTES les collections');
  console.log('   help                   Affiche cette aide');
  console.log('');
  console.log('Exemples:');
  console.log('   node qdrant-manage.mjs list');
  console.log('   node qdrant-manage.mjs info company_knowledge_fr');
  console.log('   node qdrant-manage.mjs delete company_knowledge_fr');
  console.log('   node qdrant-manage.mjs delete-all');
}

async function main() {
  try {
    switch (command) {
      case 'list':
        await listCollections();
        break;
        
      case 'info':
        if (!collectionName) {
          console.error('❌ Nom de collection requis');
          console.log('Usage: node qdrant-manage.mjs info <name>');
          process.exit(1);
        }
        await showInfo(collectionName);
        break;
        
      case 'delete':
        if (!collectionName) {
          console.error('❌ Nom de collection requis');
          console.log('Usage: node qdrant-manage.mjs delete <name>');
          process.exit(1);
        }
        await deleteCollection(collectionName);
        break;
        
      case 'delete-all':
        await deleteAllCollections();
        break;
        
      case 'help':
      case '--help':
      case '-h':
        showHelp();
        break;
        
      default:
        console.error(`❌ Commande inconnue: ${command}`);
        console.log('');
        showHelp();
        process.exit(1);
    }
  } catch (e) {
    console.error('❌ Erreur:', e.message);
    process.exit(1);
  }
}

main();