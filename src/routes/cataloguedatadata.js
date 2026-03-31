// src/routes/cataloguedata.js
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import multer from 'multer';
import { authMiddleware as authRequired } from '../middleware/auth.js';

export const catalogueDataRouter = express.Router();

// Dossier de stockage des fichiers "user knowledge"
const BASE_DIR = path.resolve(process.cwd(), 'data/uploads/catalogue_fr');
const BASE_DIR_DOC = path.resolve(process.cwd(), 'data/uploads/document_fr');
fs.mkdirSync(BASE_DIR, { recursive: true });
fs.mkdirSync(BASE_DIR_DOC, { recursive: true });

// ✅ Multer storage pour catalogue (BASE_DIR)
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, BASE_DIR),
  filename: (_req, file, cb) => {
    const ts = Date.now();
    const safe = file.originalname.replace(/[^\p{L}\p{N}\.\-_]+/gu, '_');
    cb(null, `${ts}_${safe}`);
  },
});
const upload = multer({ storage });

// ✅ Multer storage pour documents (BASE_DIR_DOC)
const storageDOC = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, BASE_DIR_DOC),
  filename: (_req, file, cb) => {
    const ts = Date.now();
    const safe = file.originalname.replace(/[^\p{L}\p{N}\.\-_]+/gu, '_');
    cb(null, `${ts}_${safe}`);
  },
});
const uploadDOC = multer({ storage: storageDOC });

// ===== fileToDTO =====
const fileToDTO = (fullPath, baseDir = BASE_DIR) => {
  const stat = fs.statSync(fullPath);
  const name = path.basename(fullPath);
  return {
    path: name,
    count: 0,
    id: undefined,
    name,
    size: stat.size,
    url: `${baseDir}/${name}`,
    createdAt: (stat.birthtime ?? stat.mtime).toISOString?.() || new Date(stat.mtime).toISOString(),
    description: undefined,
  };
};

// Sécurité
function safeJoin(base, filename) {
  const p = path.resolve(base, filename);
  if (!p.startsWith(base)) throw new Error('Path traversal');
  return p;
}

/**
 * GET /api/catalogue/files
 * Liste les fichiers avec métadonnées (BASE_DIR_DOC)
 */
catalogueDataRouter.get('/files', authRequired, async (_req, res) => {
  try {
    const items = [];
    const dirents = fs.readdirSync(BASE_DIR_DOC, { withFileTypes: true });
    
    for (const d of dirents) {
      if (d.name.endsWith('.meta.json')) continue;
      if (!d.isFile()) continue;
      
      const full = path.join(BASE_DIR_DOC, d.name);
      const fileDTO = fileToDTO(full, BASE_DIR_DOC);
      
      // Lire métadonnées
      const metaPath = path.join(BASE_DIR_DOC, `${d.name}.meta.json`);
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
    
    items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return res.json({ files: items });
  } catch (error) {
    console.error('❌ List files failed:', error);
    return res.status(500).json({ error: String(error?.message || error) });
  }
});


/**
 * POST /api/catalogue/upload-with-metadata
 * Upload avec métadonnées (BASE_DIR - pour dictionnaire de lois)
 */
catalogueDataRouter.post('/upload-with-metadata', authRequired, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file required (multipart/form-data)' });
    
    const { name, description } = req.body;
    console.log('✅ Received upload with metadata:', { name, description, file: req.file.originalname });
    
    // Valider
    if (!name || !name.trim()) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'name is required' });
    }
    
    if (!description || !description.trim()) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'description is required' });
    }

    const filePath = req.file.path;
    const basename = path.basename(filePath);
    
    // Créer métadonnées
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
    
    // Retourner
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
 * POST /api/catalogue/upload
 * Upload avec nom et description (BASE_DIR_DOC)
 */
catalogueDataRouter.post('/upload', authRequired, uploadDOC.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file required (multipart/form-data)' });
    
    const { name, description } = req.body;
    console.log('✅ Received upload:', { name, description, file: req.file.originalname });
    
    // Valider
    if (!name || !name.trim()) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'name is required' });
    }
    
    if (!description || !description.trim()) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'description is required' });
    }
    
    const filePath = req.file.path;
    const basename = path.basename(filePath);
    
    console.log('✅ File saved to:', filePath);
    
    // Créer métadonnées
    const metadataPath = path.join(BASE_DIR_DOC, `${basename}.meta.json`);
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
    
    console.log('✅ Metadata saved to:', metadataPath);
    
    // Retourner
    const fileDTO = fileToDTO(filePath, BASE_DIR_DOC);
    return res.json({
      file: {
        ...fileDTO,
        name: metadata.name,
        description: metadata.description,
      },
    });
  } catch (error) {
    console.error('❌ Upload failed:', error);
    return res.status(500).json({ error: String(error?.message || error) });
  }
});

/**
 * GET /api/catalogue/files-with-metadata
 * Liste dictionnaire de lois avec métadonnées (BASE_DIR)
 */
catalogueDataRouter.get('/files-with-metadata', authRequired, async (_req, res) => {
  try {
    const items = [];
    const dirents = fs.readdirSync(BASE_DIR, { withFileTypes: true });
    
    for (const d of dirents) {
      if (d.name.endsWith('.meta.json')) continue;
      if (!d.isFile()) continue;
      
      const full = path.join(BASE_DIR, d.name);
      const fileDTO = fileToDTO(full);
      
      // Lire métadonnées
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
    
    items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return res.json({ files: items });
  } catch (error) {
    console.error('❌ List files with metadata failed:', error);
    return res.status(500).json({ error: String(error?.message || error) });
  }
});

/**
 * DELETE /api/catalogue/files/:basename
 * Supprime fichier + métadonnées
 */
catalogueDataRouter.delete('/files/:basename', authRequired, async (req, res) => {
  try {
    // Essayer dans BASE_DIR_DOC d'abord
    const pDoc = safeJoin(BASE_DIR_DOC, req.params.basename);
    const metaPathDoc = path.join(BASE_DIR_DOC, `${req.params.basename}.meta.json`);
    
    if (fs.existsSync(pDoc)) {
      fs.unlinkSync(pDoc);
      if (fs.existsSync(metaPathDoc)) {
        fs.unlinkSync(metaPathDoc);
        console.log('✅ Metadata deleted:', metaPathDoc);
      }
      return res.json({ ok: true, deleted: 1 });
    }
    
    // Sinon essayer dans BASE_DIR
    const p = safeJoin(BASE_DIR, req.params.basename);
    const metaPath = path.join(BASE_DIR, `${req.params.basename}.meta.json`);
    
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'File not found' });
    
    fs.unlinkSync(p);
    if (fs.existsSync(metaPath)) {
      fs.unlinkSync(metaPath);
      console.log('✅ Metadata deleted:', metaPath);
    }
    
    return res.json({ ok: true, deleted: 1 });
  } catch (e) {
    return res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

// ✅ EXPORT par défaut (facultatif, déjà exporté en haut)
export default catalogueDataRouter;