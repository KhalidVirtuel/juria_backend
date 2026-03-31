// src/routes/ragdata.js
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import multer from 'multer';
import { authMiddleware as authRequired } from '../middleware/auth.js';

export const catalogueDataRouter = express.Router();

// Dossier de stockage des fichiers "user knowledge"
const BASE_DIR = path.resolve(process.cwd(), 'data/uploads/catalogue_fr');
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

// ===== MISE À JOUR DE fileToDTO POUR SUPPORTER description =====

const fileToDTO = (fullPath) => {
  const stat = fs.statSync(fullPath);
  const name = path.basename(fullPath);
  return {
    path: name,
    count: 0,
    id: undefined,
    name,
    size: stat.size,
    url: `${BASE_DIR}/${name}`,
    createdAt: (stat.birthtime ?? stat.mtime).toISOString?.() || new Date(stat.mtime).toISOString(),
    description: undefined, // ✅ Ajouté pour supporter les métadonnées
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
catalogueDataRouter.get('/files', authRequired, async (_req, res) => {
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
catalogueDataRouter.post('/upload', authRequired, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file required (multipart/form-data)' });
  const full = req.file.path;
  console.log(fileToDTO(full))
  return res.json({ file: fileToDTO(full) });
});

/**
 * DELETE /api/rag/files/:basename
 * Supprime le fichier du dossier (pas de suppression Qdrant ici)
 * Retourne { ok: true, deleted: 1 }

catalogueDataRouter.delete('/files/:basename', authRequired, async (req, res) => {
  try {
    const p = safeJoin(BASE_DIR, req.params.basename);
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'File not found' });
    fs.unlinkSync(p);
    return res.json({ ok: true, deleted: 1 });
  } catch (e) {
    return res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});


 */










// src/routes/cataloguedata.js - NOUVELLE ROUTE

/**
 * POST /api/catalogue/upload-with-metadata
 * Champs multipart: "file", "name", "description"
 * Sauvegarde le fichier + métadonnées dans un fichier JSON séparé
 * Retourne { file: RagFile }
 */

catalogueDataRouter.post('/upload-with-metadata', authRequired, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file required (multipart/form-data)' });
    const { name, description } = req.body;
    console.log('Received upload with metadata:', { name, description, file: req.file.originalname });
    // Valider les champs obligatoires
    if (!name || !name.trim()) {
      fs.unlinkSync(req.file.path); // Supprimer le fichier uploadé
      return res.status(400).json({ error: 'name is required' });
    }
    
    if (!description || !description.trim()) {
      fs.unlinkSync(req.file.path); // Supprimer le fichier uploadé
      return res.status(400).json({ error: 'description is required' });
    }
    
    const filePath = req.file.path;
    const basename = path.basename(filePath);
    
    // Créer un fichier de métadonnées JSON
    const metadataPath = path.join(BASE_DIR, `${basename}.meta.json`);
    const metadata = {
      name: name.trim(),
      description: description.trim(),
      filename: basename,
      originalName: req.file.originalname,
      uploadedAt: new Date().toISOString(),
      size: req.file.size,
      mimetype: req.file.mimetype,
    };
    
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
    
    console.log('✅ File uploaded with metadata:', {
      file: basename,
      metadata: metadataPath,
    });
    
    // Retourner le DTO enrichi avec les métadonnées
    const fileDTO = fileToDTO(filePath);
    return res.json({
      file: {
        ...fileDTO,
        name: metadata.name,
        description: metadata.description,
      },
    });
  } catch (error) {
    console.error('❌ Upload with metadata failed:', error);
    return res.status(500).json({ error: String(error?.message || error) });
  }
});

/**
 * GET /api/catalogue/files-with-metadata
 * Liste les fichiers avec leurs métadonnées
 * Retourne { files: RagFile[] }
 */
catalogueDataRouter.get('/files-with-metadata', authRequired, async (_req, res) => {
  try {
    const items = [];
    const dirents = fs.readdirSync(BASE_DIR, { withFileTypes: true });
    
    for (const d of dirents) {
      // Ignorer les fichiers .meta.json
      if (d.name.endsWith('.meta.json')) continue;
      if (!d.isFile()) continue;
      
      const full = path.join(BASE_DIR, d.name);
      const fileDTO = fileToDTO(full);
      
      // Lire les métadonnées si elles existent
      const metaPath = path.join(BASE_DIR, `${d.name}.meta.json`);
      if (fs.existsSync(metaPath)) {
        try {
          const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          fileDTO.name = metadata.name;
          fileDTO.description = metadata.description;
        } catch (error) {
          console.error('Failed to read metadata for', d.name, error);
        }
      }
      
      items.push(fileDTO);
    }
    
    // Tri par date de création/maj desc
    items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return res.json({ files: items });
  } catch (error) {
    console.error('❌ List files with metadata failed:', error);
    return res.status(500).json({ error: String(error?.message || error) });
  }
});

/**
 * DELETE /api/catalogue/files/:basename
 * MODIFIER pour supprimer aussi le fichier de métadonnées
 */
catalogueDataRouter.delete('/files/:basename', authRequired, async (req, res) => {
  try {
    const p = safeJoin(BASE_DIR, req.params.basename);
    const metaPath = path.join(BASE_DIR, `${req.params.basename}.meta.json`);
    
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'File not found' });
    
    // Supprimer le fichier
    fs.unlinkSync(p);
    
    // Supprimer les métadonnées si elles existent
    if (fs.existsSync(metaPath)) {
      fs.unlinkSync(metaPath);
      console.log('✅ Metadata deleted:', metaPath);
    }
    
    return res.json({ ok: true, deleted: 1 });
  } catch (e) {
    return res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

