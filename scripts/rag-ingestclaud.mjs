
// scripts/rag-ingest-improved.mjs
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { QdrantClient } from '@qdrant/js-client-rest';
import { v4 as uuidv4 } from 'uuid';
import OpenAI from 'openai';
import pdfParse from 'pdf-parse';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ========= ENV ========= */
const {
  QDRANT_URL = 'http://localhost:6333',
  QDRANT_API_KEY = '',
  QDRANT_COLLECTION = 'company_knowledge_fr',
  OPENAI_API_KEY,
  EMBEDDING_MODEL = 'text-embedding-3-small',
  EMBEDDING_DIM = '1536',
  RAG_MAX_FILE_BYTES = `${15 * 1024 * 1024}`,
  RAG_EMBED_BATCH = '16',
  RAG_CHUNK_SIZE = '1200', // 🆕 Augmenté de 900 à 1200
  RAG_CHUNK_OVERLAP = '200', // 🆕 Augmenté de 150 à 200
} = process.env;

const MAX_FILE_BYTES = parseInt(RAG_MAX_FILE_BYTES, 10);
const BATCH = parseInt(RAG_EMBED_BATCH, 10);
const CHUNK_SIZE = parseInt(RAG_CHUNK_SIZE, 10);
const CHUNK_OVERLAP = parseInt(RAG_CHUNK_OVERLAP, 10);

const KB_DIR = path.resolve(process.cwd(), 'data/uploads/catalogue_fr');

/* ========= Utils ========= */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 🆕 CHUNKING INTELLIGENT PAR ARTICLES
function smartChunkText(text) {
  const chunks = [];
  
  // Nettoyer le texte
  const clean = text
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Détecter les articles
  const articlePattern = /^(Article\s+\d+(?:\s+bis)?)/gim;
  const matches = [...clean.matchAll(articlePattern)];
  
  if (matches.length === 0) {
    // Pas d'articles détectés, chunking classique
    return classicChunkText(clean);
  }

  // Découper par articles
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const articleNum = match[1];
    const startIdx = match.index;
    const endIdx = i < matches.length - 1 ? matches[i + 1].index : clean.length;
    
    let articleText = clean.slice(startIdx, endIdx).trim();
    
    // Si l'article est trop long, le découper en gardant le header
    if (articleText.length > CHUNK_SIZE) {
      const header = articleNum;
      const content = articleText.slice(header.length).trim();
      
      let pos = 0;
      while (pos < content.length) {
        const end = Math.min(content.length, pos + CHUNK_SIZE - header.length - 10);
        let slice = content.slice(pos, end);
        
        // Chercher un point d'arrêt propre
        if (end < content.length) {
          const lastBreak = Math.max(
            slice.lastIndexOf('\n\n'),
            slice.lastIndexOf('. '),
            slice.lastIndexOf(';\n')
          );
          if (lastBreak > CHUNK_SIZE * 0.5) {
            slice = slice.slice(0, lastBreak + 1);
          }
        }
        
        chunks.push({
          text: `${header}\n\n${slice}`.trim(),
          article: articleNum,
        });
        
        pos += slice.length - CHUNK_OVERLAP;
        if (pos >= content.length) break;
      }
    } else {
      chunks.push({
        text: articleText,
        article: articleNum,
      });
    }
  }
  
  return chunks;
}

function classicChunkText(text) {
  const parts = [];
  let i = 0;

  while (i < text.length) {
    const end = Math.min(text.length, i + CHUNK_SIZE);
    let slice = text.slice(i, end);

    const lastBreak = Math.max(
      slice.lastIndexOf('\n'), 
      slice.lastIndexOf('. ')
    );
    if (lastBreak > CHUNK_SIZE * 0.6) {
      slice = slice.slice(0, lastBreak + 1);
    }

    parts.push({ text: slice.trim() });
    if (end >= text.length) break;
    i += Math.max(1, CHUNK_SIZE - CHUNK_OVERLAP);
  }

  return parts.filter((s) => s.text && s.text.trim().length > 0);
}

async function ensureCollection(client, name, size) {
  try {
    const info = await client.getCollection(name);
    if (info?.status) return;
  } catch {}
  await client.createCollection(name, {
    vectors: { size: Number(size), distance: 'Cosine' },
  });
}

async function readPdf(filePath) {
  const buff = await fs.promises.readFile(filePath);
  const data = await pdfParse(buff);
  return data.text || '';
}

async function embedBatch(openai, texts) {
  const resp = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  });
  return resp.data.map((d) => d.embedding);
}

function walkFiles(dir) {
  const out = [];
  (function dive(current) {
    const items = fs.readdirSync(current, { withFileTypes: true });
    for (const it of items) {
      const p = path.join(current, it.name);
      if (it.isDirectory()) dive(p);
      else out.push(p);
    }
  })(dir);
  return out;
}

/* ========= Ingestion ========= */
async function ingestFile({ client, openai }, filePath) {
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile()) return { skipped: true, reason: 'not a file' };
  if (stat.size > MAX_FILE_BYTES) {
    return { skipped: true, reason: `> ${MAX_FILE_BYTES} bytes` };
  }

  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.pdf') {
    return { skipped: true, reason: `ext ${ext} not supported` };
  }

  const basename = path.basename(filePath);
  console.log(`📄 Lecture: ${basename}`);
  
  const text = await readPdf(filePath);
  if (!text) {
    return { skipped: true, reason: 'empty text' };
  }

  // 🆕 Chunking intelligent
  const chunks = smartChunkText(text);
  console.log(` → ${chunks.length} chunks (smart chunking)`);

  // Purge ancienne version
  await client.delete(QDRANT_COLLECTION, {
    filter: { must: [{ key: 'filename', match: { value: basename } }] },
    wait: true,
  });

  // Embeddings par batch
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    const texts = batch.map(c => c.text);
    const vectors = await embedBatch(openai, texts);

    const points = batch.map((chunk, k) => ({
      id: uuidv4(),
      vector: vectors[k],
      payload: {
        text: chunk.text,
        source: 'kb',
        filename: basename,
        ext,
        file_size: stat.size,
        chunk_index: i + k,
        chunk_total: chunks.length,
        article: chunk.article || null, // 🆕 Métadonnée article
        createdAt: new Date().toISOString(),
      },
    }));

    await client.upsert(QDRANT_COLLECTION, {
      wait: true,
      points,
    });

    await sleep(100);
  }

  return { ok: true, chunks: chunks.length };
}

/* ========= Main ========= */
async function main() {
  if (!OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY manquant');
    process.exit(1);
  }
  if (!fs.existsSync(KB_DIR)) {
    console.error(`❌ Dossier introuvable: ${KB_DIR}`);
    process.exit(1);
  }

  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  const client = new QdrantClient({ 
    url: QDRANT_URL, 
    apiKey: QDRANT_API_KEY || undefined 
  });

  await ensureCollection(client, QDRANT_COLLECTION, EMBEDDING_DIM);

  const files = walkFiles(KB_DIR).filter(f => f.endsWith('.pdf'));
  if (!files.length) {
    console.log('Aucun fichier PDF à ingérer.');
    return;
  }
  
  console.log(`🧾 ${files.length} fichier(s) PDF trouvé(s)`);

  let ok = 0, skipped = 0;
  for (const f of files) {
    try {
      const res = await ingestFile({ client, openai }, f);
      if (res?.ok) {
        ok++;
        console.log(`   ✔ OK (${res.chunks} chunks)`);
      } else {
        skipped++;
        console.log(`   ↷ Skip: ${res?.reason}`);
      }
    } catch (e) {
      skipped++;
      console.log(`   ✖ Erreur:`, e?.message || e);
    }
  }

  console.log(`\n✅ Terminé. OK=${ok}, SKIPPED=${skipped}`);
}

main().catch((e) => {
  console.error('Erreur:', e);
  process.exit(1);
});