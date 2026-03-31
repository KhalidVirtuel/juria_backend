// src/routes/ragdata.js
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { authRequired } from '../middleware/auth.js';
import { embedTexts } from '../services/llm.js';
import { upsertPoints, deleteByFilter } from '../services/qdrant.js';
import { cfg } from '../config.js';

export const ragRouter = express.Router();
const prisma = new PrismaClient();

// dossier d’upload dédié RAG
const RAG_DIR = path.join(process.cwd(), 'uploads', 'rag');
fs.mkdirSync(RAG_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, RAG_DIR),
  filename: (_req, file, cb) => {
    const ts = Date.now();
    const safe = file.originalname.replace(/\s+/g, '_');
    cb(null, `${ts}_${safe}`);
  },
});
const upload = multer({ storage });

// --------- helpers ---------
function splitIntoChunks(text, chunkSize = 1200, overlap = 150) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(i + chunkSize, text.length);
    const piece = text.slice(i, end).trim();
    if (piece) chunks.push(piece);
    i = end - overlap;
    if (i < 0) i = 0;
  }
  return chunks;
}

function publicUrlFor(filePath) {
  return filePath.startsWith('/uploads')
    ? filePath
    : `/uploads/${filePath}`.replace('/uploads/uploads/', '/uploads/');
}

// --------- LISTE ---------
ragRouter.get('/files', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const docs = await prisma.document.findMany({
      where: { userId, mimeType: 'rag' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, path: true, size: true, createdAt: true },
    });
    const files = docs.map(d => ({
      id: d.id,
      name: d.title,
      size: d.size ?? 0,
      createdAt: d.createdAt.toISOString(),
      url: publicUrlFor(d.path),
    }));
    res.json({ files });
  } catch (e) { next(e); }
});

// --------- UPLOAD + INGESTION ---------
ragRouter.post('/upload', authRequired, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file required' });
    const userId = req.user.uid;

    const saved = await prisma.document.create({
      data: {
        userId,
        title: req.file.originalname,
        path: path.join('rag', req.file.filename).replace(/\\/g, '/'),
        size: req.file.size,
        mimeType: 'rag', // on marque les fichiers dédiés RAG
      },
      select: { id: true, title: true, path: true, size: true, createdAt: true },
    });

    // extraction texte (txt/pdf/docx)
    const fullPath = path.join(process.cwd(), 'uploads', saved.path);
    const buffer = fs.readFileSync(fullPath);

    const ext = path.extname(req.file.originalname).toLowerCase();
    const mime = (req.file.mimetype || '').toLowerCase();

    let rawText = '';

    // TXT
    if (mime.startsWith('text/') || ['.txt', '.md', '.csv', '.log'].includes(ext)) {
      rawText = buffer.toString('utf-8');
    }
    // PDF
    else if (mime === 'application/pdf' || ext === '.pdf') {
      try {
        const pdfParse = (await import('pdf-parse')).default;
        const out = await pdfParse(buffer);
        rawText = out.text || '';
      } catch {
        rawText = '';
      }
    }
    // DOCX
    else if (
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      ext === '.docx'
    ) {
      try {
        const mammoth = (await import('mammoth')).default;
        const out = await mammoth.extractRawText({ buffer });
        rawText = (out && out.value) ? out.value : '';
      } catch {
        rawText = '';
      }
    }
    // autres (si jamais on envoie du texte brut dans un champ 'text')
    else {
      rawText = (req.body?.text || '').toString();
    }

    // Ingestion RAG si du texte
    if (rawText.trim()) {
      const chunks = splitIntoChunks(rawText, 1200, 150);
      const vectors = await embedTexts(chunks);

      const points = vectors.map((vec, i) => ({
        vector: vec,
        payload: {
          userId,
          docId: saved.id,
          chunk_index: i,
          file_name: saved.title,
          path: saved.path,
          text: chunks[i],
        },
      }));

      await upsertPoints(cfg.qdrant.collections.company_knowledge_fr, points);
    }

    res.json({
      file: {
        id: saved.id,
        name: saved.title,
        size: saved.size ?? 0,
        createdAt: saved.createdAt.toISOString(),
        url: publicUrlFor(saved.path),
      }
    });
  } catch (e) { next(e); }
});

// --------- SUPPRESSION ---------
ragRouter.delete('/files/:id', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const id = Number(req.params.id);

    const doc = await prisma.document.findUnique({
      where: { id },
      select: { id: true, userId: true, path: true },
    });
    if (!doc || doc.userId !== userId) return res.status(404).json({ error: 'Not found' });

    await deleteByFilter(cfg.qdrant.collections.company_knowledge_fr, {
      must: [
        { key: 'userId', match: { value: userId } },
        { key: 'docId', match: { value: id } },
      ]
    });

    const fullPath = path.join(process.cwd(), 'uploads', doc.path);
    try { fs.unlinkSync(fullPath); } catch {}

    await prisma.document.delete({ where: { id } });

    res.status(204).end();
  } catch (e) { next(e); }
});
