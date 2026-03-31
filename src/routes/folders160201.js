// src/routes/folders.js
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { authRequired } from '../middleware/auth.js';

import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';

export const foldersRouter = express.Router();
const prisma = new PrismaClient();

/* --------------------------- Upload (multer) --------------------------- */
const UPLOAD_DIR = path.join(process.cwd(), 'upload_pieces');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ts = Date.now();
    const safe = (file.originalname || 'file').replace(/\s+/g, '_');
    cb(null, `${ts}_${safe}`);
  },
});

const upload = multer({ 
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
  fileFilter: (_req, file, cb) => {
    const allowedMimeTypes = ['image/png', 'image/jpeg', 'image/jpg', 'application/pdf'];
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Type de fichier non supporté. Seuls PNG, JPG et PDF sont acceptés.'));
    }
  }
});

/* ------------------------------ DTO helpers --------------------------- */
const toFolderDTO = (f) => ({
  id: String(f.id),
  userId: String(f.userId),
  name: f.name,
  description: f.description ?? '',
  color: f.color ?? '#3b82f6',
  createdAt: f.createdAt.toISOString(),
});

const toAttachmentDTO = (doc) => ({
  id: String(doc.id),
  folderId: doc.folderId ? String(doc.folderId) : '',
  name: doc.title,
  type: (doc.kind || 'document').toLowerCase(),
  url: doc.path?.startsWith('http') || doc.path?.startsWith('/')
    ? doc.path
    : `/upload_pieces/${doc.path}`,
  size: doc.size ?? 0,
  uploadedAt: doc.createdAt.toISOString(),
});

const toGenDocDTO = (d) => ({
  id: String(d.id),
  folderId: String(d.folderId),
  title: d.title,
  type: d.type,
  content: d.content,
  createdAt: d.createdAt.toISOString(),
  lastModified: d.updatedAt.toISOString(),
});

// GET /api/folders/upload_pieces/:filename - Télécharger un fichier uploadé
foldersRouter.get('/upload_pieces/:filename', authRequired, async (req, res, next) => {
  try {
    const { filename } = req.params;
    const userId = req.user.uid;
    
    const filePath = path.join(UPLOAD_DIR, filename);
    
    // Vérifie que le fichier existe
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Fichier non trouvé' });
    }

    // Sécurité : vérifie que l'utilisateur a accès
    const doc = await prisma.document.findFirst({
      where: { 
        path: filename,
        userId 
      }
    });

    if (!doc) {
      return res.status(403).json({ error: 'Accès non autorisé' });
    }

    // Envoie le fichier
    res.sendFile(filePath);
    
  } catch (e) {
    console.error('[DOWNLOAD] ❌ Erreur:', e);
    next(e);
  }
});

// POST /api/folders/:id/attachments  (multipart OU JSON)
foldersRouter.post('/:id/attachments', authRequired, upload.single('file'), async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const folderId = Number(req.params.id);

    const folder = await prisma.folder.findFirst({ where: { id: folderId, userId } });
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    let title, pathValue, size, mimeType, kind;

     if (req.file) {
      // ✅ Mode multipart avec validation supplémentaire
      const allowedMimeTypes = ['image/png', 'image/jpeg', 'image/jpg', 'application/pdf'];
      if (!allowedMimeTypes.includes(req.file.mimetype)) {
        // Supprime le fichier uploadé si type invalide
        fs.unlinkSync(path.join(UPLOAD_DIR, req.file.filename));
        return res.status(400).json({ 
          error: 'Type de fichier non supporté. Seuls PNG, JPG et PDF sont acceptés.' 
        });
      }

      // Vérifie la taille (10MB max)
      const maxSize = 10 * 1024 * 1024;
      if (req.file.size > maxSize) {
        fs.unlinkSync(path.join(UPLOAD_DIR, req.file.filename));
        return res.status(400).json({ 
          error: 'Fichier trop volumineux. La taille maximale est de 10MB.' 
        });
      }

      title = req.body?.name || req.file.originalname;
      pathValue = req.file.filename;
      size = req.file.size;
      mimeType = req.file.mimetype;
      kind = (req.body?.type || req.body?.kind || 'document').toLowerCase();
      
      console.log(`[UPLOAD] ✅ Fichier uploadé: ${req.file.originalname} (${size} bytes) → ${pathValue}`);
      
    } else {
      // Mode JSON
      const { name, url, size: s, type, kind: kindBody } = req.body || {};
      if (!name) return res.status(400).json({ error: 'name required' });
      title = name;
      pathValue = url || '';
      size = Number(s) || 0;
      mimeType = null;
      kind = (kindBody || type || 'document').toLowerCase();
    }

    const doc = await prisma.document.create({
      data: {
        userId,
        folderId,
        title,
        path: pathValue,
        size,
        mimeType,
        kind: (req.body?.type || req.body?.kind || 'document').toLowerCase(), 
      },
      select: {
        id: true, folderId: true, title: true, path: true, size: true,
        createdAt: true, mimeType: true, kind: true,
      },
    });

    res.json({ attachment: toAttachmentDTO(doc) });
  } catch (e) { next(e); }
});

// GET /api/folders/:id/attachments
foldersRouter.get('/:id/attachments', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const folderId = Number(req.params.id);

    const folder = await prisma.folder.findFirst({ where: { id: folderId, userId } });
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    const docs = await prisma.document.findMany({
      where: { folderId, userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, folderId: true, title: true, path: true, size: true,
        createdAt: true, mimeType: true, kind: true,
      },
    });

    res.json({ attachments: docs.map(toAttachmentDTO) });
  } catch (e) { next(e); }
});

// DELETE /api/folders/attachments/:attachmentId
foldersRouter.delete('/attachments/:attachmentId', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const id = Number(req.params.attachmentId);

    const doc = await prisma.document.findUnique({ where: { id } });
    if (!doc || doc.userId !== userId) return res.status(404).json({ error: 'Attachment not found' });

    await prisma.document.delete({ where: { id } });
    res.status(204).end();
  } catch (e) { next(e); }
});

/* ============================== TIMELINE =============================== */

// POST /api/folders/:id/timeline
foldersRouter.post('/:id/timeline', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const folderId = Number(req.params.id);
    const { title, type, description, date, conversationId } = req.body || {}; // ✅ AJOUTER conversationId

    const allowed = ['FACT','PROCEDURE','HEARING','DEADLINE','EVENT'];
    const upper = String(type || 'EVENT').toUpperCase();
    const finalType = allowed.includes(upper) ? upper : 'EVENT';

    const f = await prisma.folder.findFirst({ where: { id: folderId, userId } });
    if (!f) return res.status(404).json({ error: 'Folder not found' });

    const ev = await prisma.timelineEvent.create({
      data: {
        folderId,
        conversationId: conversationId ? Number(conversationId) : null, // ✅ AJOUTER CETTE LIGNE
        label: title ?? '',
        type: finalType ?? '',
        note: description ?? '',
        date: date ? new Date(date) : new Date(),
      },
    });
    
console.log('Created timeline event:', ev);
    res.json({
      entry: {
        id: String(ev.id),
        folderId: String(ev.folderId),
        conversationId: ev.conversationId ? String(ev.conversationId) : undefined, // ✅ AJOUTER CETTE LIGNE
        title: ev.label,
        description: ev.note ?? '',
        type: ev.type ?? 'event',
        date: ev.date.toISOString(),
        createdAt: ev.createdAt.toISOString(),
      },
    });
  } catch (e) { next(e); }
});

// GET /api/folders/:id/timeline
foldersRouter.get('/:id/timeline', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const folderId = Number(req.params.id);

    const f = await prisma.folder.findFirst({ where: { id: folderId, userId } });
    if (!f) return res.status(404).json({ error: 'Folder not found' });

    const items = await prisma.timelineEvent.findMany({
      where: { folderId },
      orderBy: { date: 'desc' },
    });

    res.json({
      entries: items.map(ev => ({
        id: String(ev.id),
        folderId: String(ev.folderId),
        conversationId: ev.conversationId ? String(ev.conversationId) : undefined, // ✅ AJOUTER CETTE LIGNE
        title: ev.label,
        description: ev.note ?? '',
        type: (ev.type || 'EVENT').toLowerCase(),
        date: ev.date.toISOString(),
        createdAt: ev.createdAt.toISOString(),
      })),
    });
  } catch (e) { next(e); }
});

// DELETE /api/folders/timeline/:eventId
foldersRouter.delete('/timeline/:eventId', authRequired, async (req, res, next) => {
  try {
    const id = Number(req.params.eventId);
    const ev = await prisma.timelineEvent.findUnique({ where: { id } });
    if (!ev) return res.status(404).json({ error: 'Timeline not found' });
    await prisma.timelineEvent.delete({ where: { id } });
    res.status(204).end();
  } catch (e) { next(e); }
});

// PUT /api/folders/timeline/:eventId
foldersRouter.put('/timeline/:eventId', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const id = Number(req.params.eventId);
    const { title, type, description, date, conversationId } = req.body || {};

    // Vérifier que l'event appartient à un dossier de l'utilisateur
    const ev = await prisma.timelineEvent.findUnique({
      where: { id },
      include: { folder: true },
    });
    if (!ev) return res.status(404).json({ error: 'Timeline event not found' });
    if (ev.folder.userId !== userId) return res.status(403).json({ error: 'Forbidden' });

    const allowed = ['FACT', 'PROCEDURE', 'HEARING', 'DEADLINE', 'EVENT'];
    const upper = String(type || ev.type || 'EVENT').toUpperCase();
    const finalType = allowed.includes(upper) ? upper : 'EVENT';

    const updated = await prisma.timelineEvent.update({
      where: { id },
      data: {
        ...(title !== undefined      && { label: title }),
        ...(description !== undefined && { note: description }),
        ...(type !== undefined        && { type: finalType }),
        ...(date !== undefined        && { date: new Date(date) }),
        ...(conversationId !== undefined && {
          conversationId: conversationId ? Number(conversationId) : null,
        }),
      },
    });

    res.json({
      entry: {
        id: String(updated.id),
        folderId: String(updated.folderId),
        conversationId: updated.conversationId ? String(updated.conversationId) : undefined,
        title: updated.label,
        description: updated.note ?? '',
        type: (updated.type || 'EVENT').toLowerCase(),
        date: updated.date.toISOString(),
        createdAt: updated.createdAt.toISOString(),
      },
    });
  } catch (e) { next(e); }
});

/* ============================== DEADLINES ============================== */

// POST /api/folders/:id/deadlines
foldersRouter.post('/:id/deadlines', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const folderId = Number(req.params.id);
    const { title, description, dueDate } = req.body || {};

    const f = await prisma.folder.findFirst({ where: { id: folderId, userId } });
    if (!f) return res.status(404).json({ error: 'Folder not found' });

    const d = await prisma.deadline.create({
      data: {
        folderId,
        title: title ?? '',
        note: description ?? '',
        dueDate: dueDate ? new Date(dueDate) : new Date(),
      },
    });

    res.json({
      deadline: {
        id: String(d.id),
        folderId: String(d.folderId),
        title: d.title,
        description: d.note ?? '',
        dueDate: d.dueDate.toISOString(),
        priority: 'medium',
        status: 'pending',
        createdAt: d.createdAt.toISOString(),
      },
    });
  } catch (e) { next(e); }
});

// PATCH /api/folders/deadlines/:deadlineId/status
foldersRouter.patch('/deadlines/:deadlineId/status', authRequired, async (req, res, next) => {
  try {
    const id = Number(req.params.deadlineId);
    const { status } = req.body || {};
    const d = await prisma.deadline.update({
      where: { id },
      data: { note: undefined }, // no-op, juste un exemple de champ
    });
    res.json({
      deadline: {
        id: String(d.id),
        folderId: String(d.folderId),
        title: d.title,
        description: d.note ?? '',
        dueDate: d.dueDate.toISOString(),
        priority: 'medium',
        status: (status || 'pending'),
        createdAt: d.createdAt.toISOString(),
      },
    });
  } catch (e) { next(e); }
});

// DELETE /api/folders/deadlines/:deadlineId
foldersRouter.delete('/deadlines/:deadlineId', authRequired, async (req, res, next) => {
  try {
    const id = Number(req.params.deadlineId);
    await prisma.deadline.delete({ where: { id } });
    res.status(204).end();
  } catch (e) { next(e); }
});

/* ============================== GenDoc (documents IA) ================== */

// CREATE  /api/folders/:id/documents
foldersRouter.post('/:id/documents', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const folderId = Number(req.params.id);
    const { title, type, content } = req.body || {};

    const f = await prisma.folder.findFirst({ where: { id: folderId, userId } });
    if (!f) return res.status(404).json({ error: 'Folder not found' });
    if (!title || !type || !content) return res.status(400).json({ error: 'title, type, content required' });

    const doc = await prisma.genDoc.create({
      data: { userId, folderId, title, type, content },
    });

    res.json({ document: toGenDocDTO(doc) });
  } catch (e) { next(e); }
});

// LIST    /api/folders/:id/documents
foldersRouter.get('/:id/documents', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const folderId = Number(req.params.id);

    const f = await prisma.folder.findFirst({ where: { id: folderId, userId } });
    if (!f) return res.status(404).json({ error: 'Folder not found' });

    const docs = await prisma.genDoc.findMany({
      where: { folderId, userId },
      orderBy: { updatedAt: 'desc' },
    });

    res.json({ documents: docs.map(toGenDocDTO) });
  } catch (e) { next(e); }
});

// UPDATE  /api/folders/documents/:docId
foldersRouter.put('/documents/:docId', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const id = Number(req.params.docId);
    const { title, content, type } = req.body || {};

    const d = await prisma.genDoc.findUnique({ where: { id } });
    if (!d || d.userId !== userId) return res.status(404).json({ error: 'Document not found' });

    const upd = await prisma.genDoc.update({
      where: { id },
      data: {
        title: title ?? undefined,
        content: content ?? undefined,
        type: type ?? undefined,
      },
    });

    res.json({ document: toGenDocDTO(upd) });
  } catch (e) { next(e); }
});

// DELETE  /api/folders/documents/:docId
foldersRouter.delete('/documents/:docId', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const id = Number(req.params.docId);

    const d = await prisma.genDoc.findUnique({ where: { id } });
    if (!d || d.userId !== userId) return res.status(404).json({ error: 'Document not found' });

    await prisma.genDoc.delete({ where: { id } });
    res.status(204).end();
  } catch (e) { next(e); }
});

/* =============================== FOLDERS =============================== */

foldersRouter.post('/', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const { name, description, color } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name required' });

    const f = await prisma.folder.create({
      data: {
        userId,
        name,
        description: description ?? null,
        color: color ?? null,
      },
      select: {
        id: true, userId: true, name: true, description: true, color: true, createdAt: true,
      },
    });
    res.json({ folder: toFolderDTO(f) });
  } catch (e) { next(e); }
});

foldersRouter.get('/', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;

    const folders = await prisma.folder.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, userId: true, name: true, description: true, color: true, createdAt: true },
    });

    const folderIds = folders.map(f => f.id);

    const [docs, genDocs, deadlines, events] = await Promise.all([
      prisma.document.findMany({
        where: { userId, folderId: { in: folderIds } },
        select: { id: true, folderId: true, title: true, path: true, size: true, createdAt: true, mimeType: true, kind: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.genDoc.findMany({
        where: { userId, folderId: { in: folderIds } },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.deadline.findMany({
        where: { folderId: { in: folderIds } },
        orderBy: { dueDate: 'asc' },
      }),
      prisma.timelineEvent.findMany({
        where: { folderId: { in: folderIds } },
        orderBy: { date: 'desc' },
      }),
    ]);

    const by = (key) => (acc, x) => {
      const k = x[key];
      (acc[k] ||= []).push(x);
      return acc;
    };
    const docsByFolder = docs.reduce(by('folderId'), {});
    const genByFolder  = genDocs.reduce(by('folderId'), {});
    const dlByFolder   = deadlines.reduce(by('folderId'), {});
    const evByFolder   = events.reduce(by('folderId'), {});

    const payload = {
      folders: folders.map(f => ({
        ...toFolderDTO(f),
        attachments: (docsByFolder[f.id] || []).map(toAttachmentDTO),
        documents:   (genByFolder[f.id]  || []).map(toGenDocDTO),
        deadlines:   (dlByFolder[f.id]   || []).map(d => ({
          id: String(d.id),
          folderId: String(d.folderId),
          title: d.title,
          description: d.note ?? '',
          dueDate: d.dueDate.toISOString(),
          priority: 'medium',
          status: 'pending',
          createdAt: d.createdAt.toISOString(),
        })),
        timeline:    (evByFolder[f.id]   || []).map(t => ({
          id: String(t.id),
          folderId: String(t.folderId),
          title: t.label,
          description: t.note ?? '',
          type:  t.type ?? '',
          date: t.date.toISOString(),
          createdAt: t.createdAt.toISOString(),
        })),
        conversations: [],
      })),
    };

     console.log('folders ')
    console.log(payload)
    res.json(payload);
  } catch (e) { next(e); }
});

foldersRouter.get('/:id', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const folderId = Number(req.params.id);

    const f = await prisma.folder.findFirst({
      where: { id: folderId, userId },
      select: { id: true, userId: true, name: true, description: true, color: true, createdAt: true },
    });
    if (!f) return res.status(404).json({ error: 'Folder not found' });

    const [docs, genDocs, deadlines, events] = await Promise.all([
      prisma.document.findMany({
        where: { folderId, userId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, folderId: true, title: true, path: true, size: true, createdAt: true, mimeType: true, kind: true },
      }),
      prisma.genDoc.findMany({
        where: { folderId, userId },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.deadline.findMany({
        where: { folderId },
        orderBy: { dueDate: 'asc' },
      }),
      prisma.timelineEvent.findMany({
        where: { folderId },
        orderBy: { date: 'desc' },
      }),
    ]);

    console.log('folder id '+folderId)
    console.log({
        ...toFolderDTO(f),
        attachments: docs.map(toAttachmentDTO),
        documents:   genDocs.map(toGenDocDTO),
        deadlines:   deadlines.map(d => ({
          id: String(d.id),
          folderId: String(d.folderId),
          title: d.title,
          description: d.note ?? '',
          dueDate: d.dueDate.toISOString(),
          priority: 'medium',
          status: 'pending',
          createdAt: d.createdAt.toISOString(),
        })),
        timeline:    events.map(t => ({
          id: String(t.id),
          folderId: String(t.folderId),
          conversationId: t.conversationId ? String(t.conversationId) : undefined, // ✅ AJOUTER
          title: t.label,
          description: t.note ?? '',
          type: t.type ?? '',
          date: t.date.toISOString(),
          createdAt: t.createdAt.toISOString(),
        })),
        conversations: [],
      })
    res.json({
      folder: {
        ...toFolderDTO(f),
        attachments: docs.map(toAttachmentDTO),
        documents:   genDocs.map(toGenDocDTO),
        deadlines:   deadlines.map(d => ({
          id: String(d.id),
          folderId: String(d.folderId),
          title: d.title,
          description: d.note ?? '',
          dueDate: d.dueDate.toISOString(),
          priority: 'medium',
          status: 'pending',
          createdAt: d.createdAt.toISOString(),
        })),
        timeline: events.map(t => ({
        id: String(t.id),
        folderId: String(t.folderId),
        conversationId: t.conversationId ? String(t.conversationId) : undefined, // ✅ AJOUTÉ
        title: t.label,
        description: t.note ?? '',
        type: t.type ?? '',
        date: t.date.toISOString(),
        createdAt: t.createdAt.toISOString(),
      })),
        conversations: [],
      },
    });
  } catch (e) { next(e); }
});

// PUT /api/folders/:id
foldersRouter.put('/:id', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const id = Number(req.params.id);
    const { name, description, color } = req.body || {};

    const exists = await prisma.folder.findFirst({ where: { id, userId } });
    if (!exists) return res.status(404).json({ error: 'Folder not found' });

    const f = await prisma.folder.update({
      where: { id },
      data: {
        name: name ?? undefined,
        description: description ?? undefined,
        color: color ?? undefined,
      },
      select: { id: true, userId: true, name: true, description: true, color: true, createdAt: true },
    });
    res.json({ folder: toFolderDTO(f) });
  } catch (e) { next(e); }
});

// DELETE /api/folders/:id
foldersRouter.delete('/:id', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const id = Number(req.params.id);

    await prisma.$transaction([
      prisma.genDoc.deleteMany({ where: { folderId: id, userId } }),
      prisma.document.deleteMany({ where: { folderId: id, userId } }),
      prisma.timelineEvent.deleteMany({ where: { folderId: id } }),
      prisma.deadline.deleteMany({ where: { folderId: id } }),
      prisma.conversation.updateMany({ where: { folderId: id, userId }, data: { folderId: null } }),
      prisma.folder.deleteMany({ where: { id, userId } }),
    ]);

    res.status(204).end();
  } catch (e) { next(e); }
});