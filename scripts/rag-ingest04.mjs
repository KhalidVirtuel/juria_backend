// scripts/rag-ingest.mjs
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { QdrantClient } from '@qdrant/js-client-rest';
import { v4 as uuidv4 } from 'uuid';
import OpenAI from 'openai';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import WordExtractor from 'word-extractor';

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

  RAG_MAX_FILE_BYTES = `${15 * 1024 * 1024}`, // 15 Mo
  RAG_MAX_PAGES = '60',
  RAG_EMBED_BATCH = '16',
  RAG_CHUNK_SIZE = '900',
  RAG_CHUNK_OVERLAP = '150',
} = process.env;

/* ========= Réglages ========= */
const MAX_FILE_BYTES = parseInt(RAG_MAX_FILE_BYTES, 10);
const MAX_PAGES = parseInt(RAG_MAX_PAGES, 10);
const BATCH = parseInt(RAG_EMBED_BATCH, 10);
const CHUNK_SIZE = parseInt(RAG_CHUNK_SIZE, 10);
const CHUNK_OVERLAP = parseInt(RAG_CHUNK_OVERLAP, 10);

// Dossier des connaissances
const KB_DIR = path.resolve(process.cwd(), 'data/uploads/knowledge_fr');

// flags CLI (ex: node scripts/rag-ingest.mjs --dedupe)
const ARGS = new Set(process.argv.slice(2));
const DEDUPE = ARGS.has('--dedupe');

/* ========= Utils ========= */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function chunkText(text, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  // Nettoyage simple
  const clean = text
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const parts = [];
  let i = 0;

  while (i < clean.length) {
    // Coupe au plus à "size", puis recule au dernier séparateur "propre"
    const end = Math.min(clean.length, i + size);
    let slice = clean.slice(i, end);

    // Essaye de couper sur un séparateur (fin de phrase ou newline)
    const lastBreak =
      Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '));
    if (lastBreak > size * 0.6) slice = slice.slice(0, lastBreak + 1);

    parts.push(slice.trim());
    if (end >= clean.length) break;
    i += Math.max(1, size - overlap);
  }

  return parts.filter((s) => s && s.trim().length > 0);
}

async function ensureCollection(client, name, size) {
  try {
    const info = await client.getCollection(name);
    if (info?.status) return; // existe déjà
  } catch {}
  await client.createCollection(name, {
    vectors: { size: Number(size), distance: 'Cosine' },
  });
}

async function readTxt(filePath) {
  return fs.promises.readFile(filePath, 'utf8');
}

async function readDocx(filePath) {
  const buff = await fs.promises.readFile(filePath);
  const { value } = await mammoth.extractRawText({ buffer: buff });
  return value || '';
}

async function readDoc(filePath) {
  const extractor = new WordExtractor();
  const doc = await extractor.extract(filePath);
  return doc?.getBody() || '';
}

async function readPdf(filePath) {
  // pdf-parse charge en mémoire -> on coupe le texte sur MAX_PAGES si possible
  const buff = await fs.promises.readFile(filePath);
  const data = await pdfParse(buff);
  if (!data.text) return '';
  const pageBreak = '\f';
  if (data.text.includes(pageBreak)) {
    const pages = data.text.split(pageBreak);
    const limited = pages.slice(0, MAX_PAGES).join('\n');
    return limited || data.text;
  }
  return data.text;
}

async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.txt') return readTxt(filePath);
  if (ext === '.docx') return readDocx(filePath);
  if (ext === '.doc') return readDoc(filePath);
  if (ext === '.pdf') return readPdf(filePath);
  return '';
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

/** Supprime tous les points d’un fichier (filtre sur payload.path = basename) */
async function deleteByPath(client, collection, basename) {
  // Méthode REST du client : delete with filter
  await client.delete(collection, {
    filter: {
      must: [{ key: 'path', match: { value: basename } }],
    },
    wait: true,
  });
}

/* ========= Ingestion ========= */
async function ingestFile({ client, openai }, filePath) {
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile()) return { skipped: true, reason: 'not a file' };
  if (stat.size > MAX_FILE_BYTES) {
    return { skipped: true, reason: `> ${MAX_FILE_BYTES} bytes` };
  }

  const ext = path.extname(filePath).toLowerCase();
  if (!['.pdf', '.docx', '.doc', '.txt'].includes(ext)) {
    return { skipped: true, reason: `ext ${ext} not supported` };
  }

  const rel = path.relative(KB_DIR, filePath).replace(/\\/g, '/');
  const basename = path.basename(filePath);

  console.log(`📄 Lecture: ${rel}`);
  const raw = await extractText(filePath);
  const text = raw?.toString().trim();
  if (!text) {
    return { skipped: true, reason: 'empty text' };
  }

  const chunks = chunkText(text);
  console.log(` → ${chunks.length} chunks`);

  // Idempotence optionnelle : purge ancienne version de ce fichier
  if (DEDUPE) {
    console.log(`   ↺ Purge des points existants pour path=${basename}`);
    await deleteByPath(client, QDRANT_COLLECTION, basename);
  }

  // Embeddings en batch
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    const vectors = await embedBatch(openai, batch);

    const points = batch.map((txt, k) => ({
      id: uuidv4(),
      vector: vectors[k],
      payload: {
        text: txt,
        source: 'kb',
        path: basename,          // <— clé que tes stats agrègent
        full_path: rel,          // <— chemin relatif complet (info)
        filename: basename,
        ext,
        file_size: stat.size,
        chunk_index: i + k,
        chunk_total: chunks.length,
        createdAt: new Date().toISOString(),
      },
    }));

    await client.upsert(QDRANT_COLLECTION, {
      wait: true,
      points,
    });

    // anti-throttle
    await sleep(100);
  }

  return { ok: true, chunks: chunks.length };
}

/* ========= Main ========= */
async function main() {
  if (!OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY manquant dans .env');
    process.exit(1);
  }
  if (!fs.existsSync(KB_DIR)) {
    console.error(`❌ Dossier introuvable: ${KB_DIR}`);
    process.exit(1);
  }

  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  const client = new QdrantClient({ url: QDRANT_URL, apiKey: QDRANT_API_KEY || undefined });

  await ensureCollection(client, QDRANT_COLLECTION, EMBEDDING_DIM);

  const files = walkFiles(KB_DIR);
  if (!files.length) {
    console.log('Aucun fichier à ingérer.');
    return;
  }
  console.log(`🧾 ${files.length} fichier(s) trouvé(s). ${DEDUPE ? '(dedupe: ON)' : ''}`);

  let ok = 0, skipped = 0;
  for (const f of files) {
    try {
      const res = await ingestFile({ client, openai }, f);
      if (res?.ok) {
        ok++;
        console.log(`   ✔ Ingest OK (${res.chunks} chunks) — ${path.relative(KB_DIR, f)}`);
      } else {
        skipped++;
        console.log(`   ↷ Skip: ${path.relative(KB_DIR, f)} — ${res?.reason || 'unknown'}`);
      }
    } catch (e) {
      skipped++;
      console.log(`   ✖ Erreur ingestion ${path.relative(KB_DIR, f)}:`, e?.message || e);
    }
  }

  console.log(`\n✅ Terminé. OK=${ok}, SKIPPED=${skipped}`);
}

main().catch((e) => {
  console.error('Erreur ingestion:', e);
  process.exit(1);
});
