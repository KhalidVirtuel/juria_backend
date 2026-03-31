// src/routes/ragdata.js
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import multer from 'multer';
import { authMiddleware as authRequired } from '../middleware/auth.js';
import { cfg } from '../config.js';


export const ragDataRouter = express.Router();

// Dossier de stockage des fichiers "user knowledge"
const BASE_DIR = path.resolve(process.cwd(), 'data/uploads/user_knowledge_fr');
fs.mkdirSync(BASE_DIR, { recursive: true });

// Multer storage (écrit directement sur disque dans BASE_DIR)
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, BASE_DIR),
  filename: (_req, file, cb) => {
    const ts = Date.now();
    const safe = file.originalname.replace(/[^\p{L}\p{N}\.\-_]+/gu, '_');
    cb(null, `${ts}_${safe}`);
  },
});
const upload = multer({ storage });

// Helper: construit l’URL publique si vous servez /uploads → data/uploads
// (Assurez-vous d’avoir dans index.js : app.use('/uploads', express.static(path.resolve(process.cwd(), 'data/uploads')))
const fileToDTO = (fullPath) => {
  const stat = fs.statSync(fullPath);
  const name = path.basename(fullPath);
  return {
    // Compat RagFile côté front
    path: name,            // on renvoie le basename (utilisé pour deleteByPath côté front)
    count: 0,              // pas de RAG ici → 0
    // Infos utiles pour l’UI
    id: undefined,
    name,
    size: stat.size,
   //url: `/uploads/user_knowledge_fr/${name}`,
    url: `${BASE_DIR}/${name}`,
    createdAt: (stat.birthtime ?? stat.mtime).toISOString?.() || new Date(stat.mtime).toISOString(),
  };
};

// Sécurité : valide que le chemin demandé reste dans BASE_DIR
function safeJoin(base, filename) {
  const p = path.resolve(base, filename);
  if (!p.startsWith(base)) throw new Error('Path traversal');
  return p;
}

/**
 * GET /api/rag/files
 * Liste les fichiers présents dans data/uploads/user_knowledge_fr
 * Retourne { files: RagFile[] }
 */
ragDataRouter.get('/files', authRequired, async (_req, res) => {
  const items = [];
  const dirents = fs.readdirSync(BASE_DIR, { withFileTypes: true });
  for (const d of dirents) {
    if (!d.isFile()) continue;
    const full = path.join(BASE_DIR, d.name);
    items.push(fileToDTO(full));
  }
  // Tri par date de création/màj desc (optionnel)
  items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return res.json({ files: items });
});

/**
 * POST /api/rag/upload
 * Champ multipart: "file"
 * Sauvegarde le fichier, ne lance pas le RAG.
 * Retourne { file: RagFile }
 */
ragDataRouter.post('/upload', authRequired, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file required (multipart/form-data)' });
  const full = req.file.path;
  return res.json({ file: fileToDTO(full) });
});

/**
 * DELETE /api/rag/files/:basename
 * Supprime le fichier du dossier (pas de suppression Qdrant ici)
 * Retourne { ok: true, deleted: 1 }
 */
ragDataRouter.delete('/files/:basename', authRequired, async (req, res) => {
  try {
    const p = safeJoin(BASE_DIR, req.params.basename);
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'File not found' });
    fs.unlinkSync(p);
    return res.json({ ok: true, deleted: 1 });
  } catch (e) {
    return res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});



ragDataRouter.post('/delete-by-path', authRequired, async (req, res) => {
  try {
    const { path: filename } = req.body;
    if (!filename) {
      return res.status(400).json({ error: 'path required in body' });
    }

    // 1. Supprimer le fichier du disque
    const fullPath = safeJoin(BASE_DIR, filename);
    let fileDeleted = false;
    
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      fileDeleted = true;
    }

    // 2. Supprimer les chunks dans Qdrant
    const QDRANT_URL = process.env.QDRANT_URL || 'http://qdrant:6333';
    const QDRANT_COLLECTION = process.env.QDRANT_COLLECTION || 'company_knowledge_fr';
    
    const qdrantResponse = await fetch(
      `${QDRANT_URL}/collections/${QDRANT_COLLECTION}/points/delete`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filter: {
            must: [
              { key: 'path', match: { value: filename } }
            ]
          }
        })
      }
    );

    if (!qdrantResponse.ok) {
      const text = await qdrantResponse.text();
      console.error('Qdrant delete error:', text);
    }

    const qdrantData = await qdrantResponse.json();
    
    return res.json({
      ok: true,
      fileDeleted,
      chunksDeleted: qdrantData?.result?.operation_id ? true : false,
      path: filename
    });
    
  } catch (e) {
    console.error('Delete error:', e);
    return res.status(500).json({ 
      ok: false, 
      error: String(e?.message || e) 
    });
  }
});