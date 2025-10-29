import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import { ingestDocument } from '../services/rag.js';
import { prisma } from '../services/db.js';

export const docsRouter = Router();
docsRouter.use(authRequired);

// Upload d'un document (+ ingestion RAG)
docsRouter.post('/upload', upload.single('file'), async (req, res, next) => {
  try {
    const { case_id, client_id } = req.body;
    const f = req.file;
    if (!f) return res.status(400).json({ error: 'Aucun fichier' });

    const meta = {
      user_id: req.user.id,
      case_id: case_id ? Number(case_id) : null,
      client_id: client_id ? Number(client_id) : null,
      filename: f.originalname,
    };

    const { text_length, chunks } = await ingestDocument({
      filePath: f.path,
      mime: f.mimetype,
      meta,
    });

    const doc = await prisma.document.create({
      data: {
        userId: req.user.id,
        caseId: meta.case_id,
        clientId: meta.client_id,
        filename: f.originalname,
        mime: f.mimetype,
        path: f.path,
        textLength: text_length,
      },
    });

    res.status(201).json({ id: doc.id, chunks });
  } catch (e) {
    next(e);
  }
});

export default docsRouter;
