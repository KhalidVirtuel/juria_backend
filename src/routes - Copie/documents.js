// src/routes/documents.js
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { authRequired } from '../middleware/auth.js';

import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';

export const docsRouter = express.Router();
const prisma = new PrismaClient();

// Répertoire d’upload
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Stockage multer : on enregistre le fichier sous /uploads/<timestamp>_<nom>
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ts = Date.now();
    const safe = file.originalname.replace(/\s+/g, '_');
    cb(null, `${ts}_${safe}`);
  },
});

const upload = multer({ storage });

// util: mapper un Document Prisma -> shape simple pour le front
function toDocDTO(d) {
  return {
    id: d.id,
    title: d.title,
    // L’API front utilise une URL; on sert /uploads statiquement depuis index.js
    url: d.path?.startsWith('http') || d.path?.startsWith('/')
      ? d.path
      : `/uploads/${d.path}`,
    path: d.path,           // utile si tu veux le nom physique
    size: d.size ?? 0,
    mimeType: d.mimeType ?? null,
    folderId: d.folderId ?? null,
    caseId: d.caseId ?? null,
    clientId: d.clientId ?? null,
    createdAt: d.createdAt.toISOString(),
  };
}

/**
 * POST /api/documents/upload
 * multipart/form-data
 * - field file: le fichier
 * - body optionnels: folderId, title (sinon originalname), mimeType forcé, size forcé
 *
 * NOTE : PAS d’ingestion RAG ici. L’ingestion RAG est gérée via /api/rag/upload.
 */
docsRouter.post('/upload', authRequired, upload.single('file'), async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const file = req.file;

    if (!file) return res.status(400).json({ error: 'file required' });

    const {
      folderId: folderIdRaw,
      caseId: caseIdRaw,
      clientId: clientIdRaw,
      title: titleRaw,
      mimeType: mimeTypeRaw,
      size: sizeRaw,
    } = req.body || {};

    const folderId = folderIdRaw ? Number(folderIdRaw) : null;
    const caseId   = caseIdRaw   ? Number(caseIdRaw)   : null;
    const clientId = clientIdRaw ? Number(clientIdRaw) : null;

    // titre lisible : body.title > originalname
    const title = (titleRaw && String(titleRaw).trim()) || file.originalname;

    // On stocke en DB seulement le nom de fichier (relatif). L’URL publique sera /uploads/<path>.
    const relPath = path.basename(file.path);

    // Si on force le mime/size
    const mimeType = mimeTypeRaw || file.mimetype || null;
    const size     = Number(sizeRaw) || file.size || 0;

    // Optionnel: vérifier ownership si folderId fourni
    if (folderId) {
      const folder = await prisma.folder.findFirst({ where: { id: folderId, userId } });
      if (!folder) return res.status(404).json({ error: 'Folder not found' });
    }

    const doc = await prisma.document.create({
      data: {
        userId,
        folderId,
        caseId,
        clientId,
        title,
        path: relPath,  // ex: "1730900900_mon_fichier.pdf"
        size,
        mimeType,
      },
      select: {
        id: true, title: true, path: true, size: true, mimeType: true,
        folderId: true, caseId: true, clientId: true, createdAt: true
      },
    });

    return res.json({ document: toDocDTO(doc) });
  } catch (e) { next(e); }
});

/**
 * GET /api/documents
 * Liste paginée simple des documents de l’utilisateur
 * Query: ?folderId=... (optionnel)
 */
docsRouter.get('/', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const { folderId: folderIdRaw, take: takeRaw, skip: skipRaw } = req.query;

    const take = Math.min(Number(takeRaw) || 50, 200);
    const skip = Number(skipRaw) || 0;

    const where = { userId };
    if (folderIdRaw) where.folderId = Number(folderIdRaw);

    const docs = await prisma.document.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, title: true, path: true, size: true, mimeType: true,
        folderId: true, caseId: true, clientId: true, createdAt: true
      },
      take, skip,
    });

    res.json({ documents: docs.map(toDocDTO) });
  } catch (e) { next(e); }
});

/**
 * GET /api/documents/:id
 */
docsRouter.get('/:id', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const id = Number(req.params.id);

    const d = await prisma.document.findFirst({
      where: { id, userId },
      select: {
        id: true, title: true, path: true, size: true, mimeType: true,
        folderId: true, caseId: true, clientId: true, createdAt: true
      },
    });

    if (!d) return res.status(404).json({ error: 'Not found' });
    res.json({ document: toDocDTO(d) });
  } catch (e) { next(e); }
});

/**
 * DELETE /api/documents/:id
 * Supprime l’enregistrement + (best-effort) le fichier physique si local
 */
docsRouter.delete('/:id', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const id = Number(req.params.id);

    const d = await prisma.document.findFirst({
      where: { id, userId },
      select: { id: true, path: true },
    });
    if (!d) return res.status(404).json({ error: 'Not found' });

    // tentative de suppression fichier
    if (d.path && !d.path.startsWith('http')) {
      const abs = path.join(UPLOAD_DIR, path.basename(d.path));
      fs.existsSync(abs) && fs.rmSync(abs, { force: true });
    }

    await prisma.document.delete({ where: { id } });
    res.status(204).end();
  } catch (e) { next(e); }
});
