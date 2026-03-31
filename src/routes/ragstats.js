// src/routes/ragstats.js
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { cfg } from '../config.js';
import { authRequired } from '../middleware/auth.js';

export const ragStatsRouter = express.Router();


// ✅ Utilise la bonne structure
const QDRANT_URL = cfg.qdrant?.url || 'http://localhost:6333';
const QDRANT_COLLECTION = cfg.qdrant?.collection || 'jure_ai_kb';

/* ---------------------------
   Helpers
----------------------------*/
async function countWithFilterValue(value) {
  const coll = QDRANT_COLLECTION; // ✅ Corrigé
  const body = {
    exact: true,
    filter: { must: [{ key: 'path', match: { value: String(value) } }] }
  };
  const data = await qdrantPost(`/collections/${coll}/points/count`, body);
  return data?.result?.count ?? 0;
}

/*
async function countSmart(kbDir, relPath) {
  // Candidats possibles selon la façon dont tu as indexé le payload.path
  const full = path.join(kbDir, relPath);
  const base = path.basename(relPath);

  const candidates = [
    relPath,                 // "Code_des_Juridictions_Financieres.pdf"
    base,                    // "Code_des_Juridictions_Financieres.pdf"
    full,                    // ".../data/uploads/knowledge_fr/Code_des_....pdf"
    // si tu as déjà indexé avec un prefixe "uploads/" :
    path.join('uploads', relPath).replace(/\\/g, '/'),
  ];

  for (const v of candidates) {
    try {
      const c = await countWithFilterValue(v);
      if (c > 0) return c;
    } catch (_) 
  }
  return 0;
}
*/

async function countSmart(kbDir, relPath) {
  const full = path.join(kbDir, relPath);
  const base = path.basename(relPath);

  const candidates = [
    relPath,
    base,
    full,
    path.join('uploads', relPath).replace(/\\/g, '/'),
  ];

  console.log(`🔍 Searching for: ${relPath}`); // ✅ Log
  console.log(`📋 Candidates:`, candidates); // ✅ Log

  for (const v of candidates) {
    try {
      console.log(`  Testing: "${v}"`); // ✅ Log
      const c = await countWithFilterValue(v);
      console.log(`    → Count: ${c}`); // ✅ Log
      if (c > 0) {
        console.log(`    ✅ Found with: "${v}"`); // ✅ Log
        return c;
      }
    } catch (err) {
      console.log(`    ❌ Error:`, err.message); // ✅ Log
    }
  }
  
  console.log(`  ⚠️ No match found for: ${relPath}`); // ✅ Log
  return 0;
}



// Liste récursive des fichiers d'un dossier
function listFilesRecursive(rootDir) {
  const out = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(full);
    }
  }
  if (fs.existsSync(rootDir)) walk(rootDir);
  return out;
}

// Petite enveloppe POST pour Qdrant
async function qdrantPost(urlPath, body) {
  const base = QDRANT_URL.replace(/\/$/, '');
  const headers = { 'content-type': 'application/json' };
  if (process.env.QDRANT_API_KEY) headers['api-key'] = process.env.QDRANT_API_KEY;
  const res = await fetch(`${base}${urlPath}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[Qdrant ${urlPath}] ${res.status} ${res.statusText} ${text}`);
  }
  return res.json();
}

// Compter les points pour un path donné (exact)
async function countByPath(pathValue) {
  const coll = QDRANT_COLLECTION; // ✅ Corrigé
  const filter = { must: [{ key: 'path', match: { value: String(pathValue) } }] };

  const data = await qdrantPost(
    `/collections/${coll}/points/count`,
    { exact: true, filter }
  );
  return data?.result?.count ?? 0;
}

/* ---------------------------
   Routes
----------------------------*/

/**
 * GET /api/ragstat/files
 * -> { files: [{ path, size, mtime }] } (liste de fichiers vus sur disque)
 */
ragStatsRouter.get('/files', authRequired, async (_req, res, next) => {
  try {
    const kbDir = cfg.knowledgeBaseDir || path.join(process.cwd(), 'data', 'uploads', 'catalogue_fr');
    const files = listFilesRecursive(kbDir).map(full => {
      const st = fs.statSync(full);
      return {
        path: full.replace(kbDir + path.sep, ''), // chemin relatif utile pour "path" dans Qdrant
        size: st.size,
        mtime: st.mtime.toISOString(),
      };
    });
    res.json({ files });
  } catch (e) { next(e); }
});

/**
 * GET /api/ragstat/stats
 * Agrège les counts par fichier **sans** /scroll :
 * - lit la liste des fichiers du KB
 * - fait un /points/count pour chaque path
 * - renvoie { total, byPath: [{ path, count }] }
 */

ragStatsRouter.get('/stats', authRequired, async (_req, res, next) => {
  try {
    const kbDir = cfg.knowledgeBaseDir || path.join(process.cwd(), 'data', 'uploads', 'catalogue_fr');
    const files = listFilesRecursive(kbDir)
      .map(full => full.replace(kbDir + path.sep, ''));

    const results = [];
    const BATCH = 6;
    for (let i = 0; i < files.length; i += BATCH) {
      const slice = files.slice(i, i + BATCH);
      const counts = await Promise.all(slice.map(p => countSmart(kbDir, p)));
      slice.forEach((p, idx) => results.push({ path: p, count: counts[idx] || 0 }));
    }

    const total = results.reduce((s, r) => s + (r.count || 0), 0);
    results.sort((a, b) => b.count - a.count);
    res.json({ total, byPath: results });
  } catch (e) { next(e); }
});



/**
 * GET /api/ragstat/count?path=...
 * -> { path, count } (exact)
 */
ragStatsRouter.get('/count', authRequired, async (req, res, next) => {
  try {
    const p = String(req.query.path || '');
    if (!p) return res.status(400).json({ error: 'path required' });
    const count = await countByPath(p);
    res.json({ path: p, count });
  } catch (e) { next(e); }
});
