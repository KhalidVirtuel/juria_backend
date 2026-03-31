// src/routes/folders.js
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { authRequired } from '../middleware/auth.js';

import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';

export const foldersRouter = express.Router();
const prisma = new PrismaClient();

/* ========= Upload config ========= */
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ts = Date.now();
    const safe = file.originalname.replace(/\s+/g, '_');
    cb(null, `${ts}_${safe}`);
  },
});
const upload = multer({ storage });

/* ========= Helpers communs ========= */

function normalizeAttachmentType(doc) {
  const val = String(doc?.mimeType ?? '').toLowerCase();
  const title = String(doc?.title ?? '').toLowerCase();
  if (['contract', 'evidence', 'document', 'other'].includes(val)) return val;
  if (val.includes('pdf') || title.includes('contrat') || title.includes('contract')) return 'contract';
  if (val.startsWith('image/') || title.includes('preuve') || title.includes('evidence')) return 'evidence';
  return 'document';
}

function toAttachmentDTO(doc) {
  return {
    id: String(doc.id),
    folderId: String(doc.folderId),
    name: doc.title,
    type: normalizeAttachmentType(doc), // 'contract' | 'evidence' | 'document' | 'other'
    url:
      doc.path?.startsWith('http') || doc.path?.startsWith('/')
        ? doc.path
        : `/uploads/${doc.path}`,
    size: doc.size ?? 0,
    uploadedAt: doc.createdAt.toISOString(),
  };
}

function toFolderDTO(f) {
  return {
    id: String(f.id),
    userId: String(f.userId),
    name: f.name,
    description: f.description ?? '',
    color: f.color ?? '#3b82f6',
    createdAt: f.createdAt.toISOString(),
  };
}

/* ========= Timeline helpers ========= */

function parseNoteJSON(note) {
  if (!note) return { type: 'event', description: '' };
  try {
    const obj = JSON.parse(note);
    const type = String(obj?.type ?? 'event').toLowerCase();
    const description = String(obj?.description ?? '');
    return { type, description };
  } catch {
    return { type: 'event', description: String(note) };
  }
}

function toTimelineDTO(ev) {
  const { type, description } = parseNoteJSON(ev.note);
  return {
    id: String(ev.id),
    folderId: String(ev.folderId),
    title: ev.label,
    description,
    type,
    date: ev.date.toISOString(),
    createdAt: ev.createdAt.toISOString(),
  };
}

/* ========= Documents générés (fichiers) ========= */

const GEN_PREFIX = 'generated:'; // mimeType = generated:<type>

function isGenerated(doc) {
  return typeof doc.mimeType === 'string' && doc.mimeType.startsWith(GEN_PREFIX);
}

function genTypeFromMime(mimeType) {
  return String(mimeType || '').toLowerCase().startsWith(GEN_PREFIX)
    ? mimeType.slice(GEN_PREFIX.length).toLowerCase()
    : 'document';
}

function safeReadFile(relPath) {
  if (!relPath) return '';
  if (relPath.startsWith('http://') || relPath.startsWith('https://') || relPath.startsWith('/')) return '';
  try {
    const abs = path.join(UPLOAD_DIR, relPath);
    if (fs.existsSync(abs)) return fs.readFileSync(abs, 'utf8');
  } catch {}
  return '';
}

function writeGeneratedContent(content, ext = 'md') {
  const ts = Date.now();
  const fileName = `${ts}_generated.${ext}`;
  const abs = path.join(UPLOAD_DIR, fileName);
  fs.writeFileSync(abs, String(content ?? ''), 'utf8');
  const stat = fs.statSync(abs);
  return { fileName, size: stat.size, mtime: stat.mtime };
}

function overwriteGeneratedContent(relPath, content) {
  if (!relPath) return null;
  if (relPath.startsWith('http://') || relPath.startsWith('https://') || relPath.startsWith('/')) return null;
  const abs = path.join(UPLOAD_DIR, relPath);
  fs.writeFileSync(abs, String(content ?? ''), 'utf8');
  return fs.statSync(abs);
}

function generatedToDTO(doc) {
  const content = safeReadFile(doc.path);
  let lastModified = doc.createdAt;
  try {
    if (doc.path && !doc.path.startsWith('http') && !doc.path.startsWith('/')) {
      const abs = path.join(UPLOAD_DIR, doc.path);
      if (fs.existsSync(abs)) lastModified = fs.statSync(abs).mtime;
    }
  } catch {}
  return {
    id: String(doc.id),
    folderId: String(doc.folderId),
    title: doc.title,
    type: genTypeFromMime(doc.mimeType),
    content,
    createdAt: doc.createdAt.toISOString(),
    lastModified: (lastModified instanceof Date ? lastModified : new Date(lastModified)).toISOString(),
  };
}

/* ========= Deadlines helpers =========
   On encode { description, priority, status } dans Deadline.note (JSON).
   Priorités possibles côté front: LOW | MEDIUM | HIGH | URGENT
   Statuts possibles: PENDING | COMPLETED | OVERDUE
*/
function parseDeadlineNote(note) {
  if (!note) return { description: '', priority: 'LOW', status: 'PENDING' };
  try {
    const obj = JSON.parse(note);
    const description = String(obj?.description ?? '');
    const priority = String(obj?.priority ?? 'LOW').toUpperCase();
    const status = String(obj?.status ?? 'PENDING').toUpperCase();
    return { description, priority, status };
  } catch {
    return { description: String(note), priority: 'LOW', status: 'PENDING' };
  }
}

function toDeadlineDTO(dl) {
  const meta = parseDeadlineNote(dl.note);
  return {
    id: String(dl.id),
    folderId: String(dl.folderId),
    title: dl.title,
    description: meta.description,
    dueDate: dl.dueDate.toISOString(),
    priority: meta.priority, // 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
    status: meta.status,     // 'PENDING' | 'COMPLETED' | 'OVERDUE'
    createdAt: dl.createdAt.toISOString(),
  };
}

/* ========= Routes ========= */

// POST /api/folders
foldersRouter.post('/', authRequired, async (req, res, next) => {
  console.log(req.body)
  try {
    const userId = req.user.uid;
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name required' });

    const folder = await prisma.folder.create({
      data: { userId, name },
      select: { id: true, userId: true, name: true, createdAt: true },
    });

    return res.json({ folder: toFolderDTO(folder) });
  } catch (e) { next(e); }
});

// GET /api/folders
foldersRouter.get('/', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;

    const folders = await prisma.folder.findMany({
      where: { userId },
      include: {
        documents: true,                // pièces jointes + générés
        timelineEvents: { orderBy: { date: 'desc' } },
        deadlines: { orderBy: { dueDate: 'asc' } }, // <<<<<< deadlines
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json({
      folders: folders.map(f => {
        const attachments = (f.documents || []).filter(d => !isGenerated(d)).map(toAttachmentDTO);
        const generatedDocs = (f.documents || []).filter(isGenerated).map(generatedToDTO);
        const deadlines = (f.deadlines || []).map(toDeadlineDTO);
        return {
          ...toFolderDTO(f),
          attachments,
          timeline: (f.timelineEvents || []).map(toTimelineDTO),
          documents: generatedDocs,
          deadlines,                    // <<<<<< renvoyé au front
          conversations: [],
        };
      }),
    });
  } catch (e) { next(e); }
});

// GET /api/folders/:id
foldersRouter.get('/:id', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const id = Number(req.params.id);

    const folder = await prisma.folder.findFirst({
      where: { id, userId },
      include: {
        documents: true,
        timelineEvents: { orderBy: { date: 'desc' } },
        deadlines: { orderBy: { dueDate: 'asc' } }, // <<<<<< deadlines
      },
    });
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    const attachments = (folder.documents || []).filter(d => !isGenerated(d)).map(toAttachmentDTO);
    const generatedDocs = (folder.documents || []).filter(isGenerated).map(generatedToDTO);
    const deadlines = (folder.deadlines || []).map(toDeadlineDTO);

    return res.json({
      folder: {
        ...toFolderDTO(folder),
        attachments,
        timeline: (folder.timelineEvents || []).map(toTimelineDTO),
        documents: generatedDocs,
        deadlines,                      // <<<<<< renvoyé au front
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
    const { name } = req.body || {};

    const exists = await prisma.folder.findFirst({ where: { id, userId } });
    if (!exists) return res.status(404).json({ error: 'Folder not found' });

    const updated = await prisma.folder.update({
      where: { id },
      data: { name: name ?? undefined },
      select: { id: true, userId: true, name: true, createdAt: true },
    });

    return res.json({ folder: toFolderDTO(updated) });
  } catch (e) { next(e); }
});

// DELETE /api/folders/:id
foldersRouter.delete('/:id', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const id = Number(req.params.id);

    // Supprimer les fichiers physiques liés aux documents
    const docs = await prisma.document.findMany({ where: { folderId: id, userId } });
    for (const d of docs) {
      if (d.path && !d.path.startsWith('http') && !d.path.startsWith('/')) {
        const abs = path.join(UPLOAD_DIR, d.path);
        if (fs.existsSync(abs)) {
          try { fs.unlinkSync(abs); } catch {}
        }
      }
    }

    await prisma.$transaction([
      prisma.document.deleteMany({ where: { folderId: id, userId } }),
      prisma.timelineEvent.deleteMany({ where: { folderId: id } }),
      prisma.deadline.deleteMany({ where: { folderId: id } }),
      prisma.conversation.updateMany({ where: { folderId: id, userId }, data: { folderId: null } }),
      prisma.folder.deleteMany({ where: { id, userId } }),
    ]);

    return res.status(204).end();
  } catch (e) { next(e); }
});

/* ========= Attachments ========= */

// POST /api/folders/:id/attachments
foldersRouter.post('/:id/attachments', authRequired, upload.single('file'), async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const folderId = Number(req.params.id);

    const folder = await prisma.folder.findFirst({ where: { id: folderId, userId } });
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    let title, pathValue, size, mimeType;

    if (req.file) {
      title = req.body?.name || req.file.originalname;
      pathValue = req.file.filename;
      size = req.file.size;
      const semanticType = String(req.body?.type || '').toLowerCase();
      const allowed = new Set(['contract', 'evidence', 'document', 'other']);
      mimeType = allowed.has(semanticType) ? semanticType : (req.file.mimetype || 'document');
    } else {
      const { name, url, size: sz, type } = req.body || {};
      if (!name) return res.status(400).json({ error: 'name required' });
      title = name;
      pathValue = url || '';
      size = Number(sz) || 0;
      const semanticType = String(type || '').toLowerCase();
      const allowed = new Set(['contract', 'evidence', 'document', 'other']);
      mimeType = allowed.has(semanticType) ? semanticType : null;
    }

    const doc = await prisma.document.create({
      data: { userId, folderId, title, path: pathValue, size, mimeType },
      select: {
        id: true, folderId: true, title: true, path: true, size: true, createdAt: true, mimeType: true,
      },
    });

    return res.json({ attachment: toAttachmentDTO(doc) });
  } catch (e) { next(e); }
});

// GET /api/folders/:id/attachments
foldersRouter.get('/:id/attachments', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const folderId = Number(req.params.id);

    const folder = await prisma.folder.findFirst({ where: { id: folderId, userId }, select: { id: true } });
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    const docs = await prisma.document.findMany({
      where: { folderId, userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, folderId: true, title: true, path: true, size: true, mimeType: true, createdAt: true,
      },
    });

    const attachments = docs.filter(d => !isGenerated(d)).map(toAttachmentDTO);
    return res.json({ attachments });
  } catch (e) { next(e); }
});

// DELETE /api/folders/attachments/:attachmentId
foldersRouter.delete('/attachments/:attachmentId', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const attachmentId = Number(req.params.attachmentId);

    const doc = await prisma.document.findUnique({
      where: { id: attachmentId },
      select: { id: true, userId: true, path: true },
    });
    if (!doc || doc.userId !== userId) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    if (doc.path && !doc.path.startsWith('http') && !doc.path.startsWith('/')) {
      const abs = path.join(UPLOAD_DIR, doc.path);
      fs.existsSync(abs) && fs.unlink(abs, () => {});
    }

    await prisma.document.delete({ where: { id: attachmentId } });
    return res.status(204).end();
  } catch (e) { next(e); }
});

/* ========= Timeline ========= */

// POST /api/folders/:id/timeline
foldersRouter.post('/:id/timeline', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const folderId = Number(req.params.id);
    const { title, description, type, date } = req.body || {};

    const folder = await prisma.folder.findFirst({ where: { id: folderId, userId } });
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    if (!title) return res.status(400).json({ error: 'title required' });
    if (!date) return res.status(400).json({ error: 'date required' });

    const payloadNote = JSON.stringify({
      type: String(type || 'event').toLowerCase(),
      description: String(description || ''),
    });

    const ev = await prisma.timelineEvent.create({
      data: {
        folderId,
        label: title,
        date: new Date(date),
        note: payloadNote,
      },
    });

    return res.status(201).json({ entry: toTimelineDTO(ev) });
  } catch (e) { next(e); }
});

// GET /api/folders/:id/timeline
foldersRouter.get('/:id/timeline', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const folderId = Number(req.params.id);

    const folder = await prisma.folder.findFirst({ where: { id: folderId, userId }, select: { id: true } });
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    const items = await prisma.timelineEvent.findMany({
      where: { folderId },
      orderBy: { date: 'desc' },
    });

    return res.json({ entries: items.map(toTimelineDTO) });
  } catch (e) { next(e); }
});

// DELETE /api/folders/timeline/:entryId
foldersRouter.delete('/timeline/:entryId', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const entryId = Number(req.params.entryId);

    const ev = await prisma.timelineEvent.findUnique({
      where: { id: entryId },
      include: { folder: true },
    });
    if (!ev || ev.folder.userId !== userId) {
      return res.status(404).json({ error: 'Timeline entry not found' });
    }

    await prisma.timelineEvent.delete({ where: { id: entryId } });
    return res.status(204).end();
  } catch (e) { next(e); }
});

/* ========= Documents générés ========= */

// POST /api/folders/:id/documents
foldersRouter.post('/:id/documents', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const folderId = Number(req.params.id);
    const { title, type, content } = req.body || {};

    if (!title) return res.status(400).json({ error: 'title required' });

    const folder = await prisma.folder.findFirst({ where: { id: folderId, userId } });
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    const { fileName, size, mtime } = writeGeneratedContent(content ?? '', 'md');
    const mimeType = `${GEN_PREFIX}${String(type || 'document').toLowerCase()}`;

    const doc = await prisma.document.create({
      data: { userId, folderId, title, path: fileName, size, mimeType },
      select: { id: true, folderId: true, title: true, path: true, size: true, createdAt: true, mimeType: true },
    });

    const dto = generatedToDTO(doc);
    dto.lastModified = mtime.toISOString();

    return res.status(201).json({ document: dto });
  } catch (e) { next(e); }
});

// GET /api/folders/:id/documents
foldersRouter.get('/:id/documents', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const folderId = Number(req.params.id);

    const folder = await prisma.folder.findFirst({ where: { id: folderId, userId }, select: { id: true } });
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    const docs = await prisma.document.findMany({
      where: { folderId, userId, mimeType: { startsWith: GEN_PREFIX } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, folderId: true, title: true, path: true, size: true, createdAt: true, mimeType: true },
    });

    return res.json({ documents: docs.map(generatedToDTO) });
  } catch (e) { next(e); }
});

// PUT /api/folders/documents/:documentId
foldersRouter.put('/documents/:documentId', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const documentId = Number(req.params.documentId);
    const { title, content } = req.body || {};

    const doc = await prisma.document.findUnique({ where: { id: documentId } });
    if (!doc || doc.userId !== userId || !isGenerated(doc)) {
      return res.status(404).json({ error: 'Document not found' });
    }

    let newStat = null;
    if (typeof content === 'string') {
      newStat = overwriteGeneratedContent(doc.path, content);
    }

    const updated = await prisma.document.update({
      where: { id: documentId },
      data: { title: title ?? undefined },
      select: { id: true, folderId: true, title: true, path: true, size: true, createdAt: true, mimeType: true },
    });

    const dto = generatedToDTO(updated);
    if (newStat?.mtime) dto.lastModified = newStat.mtime.toISOString();

    return res.json({ document: dto });
  } catch (e) { next(e); }
});

// DELETE /api/folders/documents/:documentId
foldersRouter.delete('/documents/:documentId', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const documentId = Number(req.params.documentId);

    const doc = await prisma.document.findUnique({ where: { id: documentId } });
    if (!doc || doc.userId !== userId || !isGenerated(doc)) {
      return res.status(404).json({ error: 'Document not found' });
    }

    if (doc.path && !doc.path.startsWith('http') && !doc.path.startsWith('/')) {
      const abs = path.join(UPLOAD_DIR, doc.path);
      if (fs.existsSync(abs)) {
        try { fs.unlinkSync(abs); } catch {}
      }
    }

    await prisma.document.delete({ where: { id: documentId } });
    return res.status(204).end();
  } catch (e) { next(e); }
});

/* ========= Deadlines ========= */

// POST /api/folders/:id/deadlines
foldersRouter.post('/:id/deadlines', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const folderId = Number(req.params.id);
    const { title, description, dueDate, priority, status } = req.body || {};

    const folder = await prisma.folder.findFirst({ where: { id: folderId, userId } });
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    if (!title) return res.status(400).json({ error: 'title required' });
    if (!dueDate) return res.status(400).json({ error: 'dueDate required' });

    const payloadNote = JSON.stringify({
      description: String(description || ''),
      priority: String(priority || 'LOW').toUpperCase(),    // LOW | MEDIUM | HIGH | URGENT
      status: String(status || 'PENDING').toUpperCase(),    // PENDING | COMPLETED | OVERDUE
    });

    const dl = await prisma.deadline.create({
      data: {
        folderId,
        title,
        dueDate: new Date(dueDate),
        note: payloadNote,
      },
    });

    return res.status(201).json({ deadline: toDeadlineDTO(dl) });
  } catch (e) { next(e); }
});

// GET /api/folders/:id/deadlines
foldersRouter.get('/:id/deadlines', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const folderId = Number(req.params.id);

    const folder = await prisma.folder.findFirst({ where: { id: folderId, userId }, select: { id: true } });
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    const items = await prisma.deadline.findMany({
      where: { folderId },
      orderBy: { dueDate: 'asc' },
    });

    return res.json({ deadlines: items.map(toDeadlineDTO) });
  } catch (e) { next(e); }
});

// PATCH /api/folders/deadlines/:deadlineId/status
foldersRouter.patch('/deadlines/:deadlineId/status', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const deadlineId = Number(req.params.deadlineId);
    const { status } = req.body || {};

    if (!status) return res.status(400).json({ error: 'status required' });

    // on récupère la deadline ET son folder pour vérifier l’ownership
    const dl = await prisma.deadline.findUnique({
      where: { id: deadlineId },
      include: { folder: true },
    });
    if (!dl || dl.folder.userId !== userId) {
      return res.status(404).json({ error: 'Deadline not found' });
    }

    const meta = parseDeadlineNote(dl.note);
    const newNote = JSON.stringify({
      ...meta,
      status: String(status).toUpperCase(),
    });

    const updated = await prisma.deadline.update({
      where: { id: deadlineId },
      data: { note: newNote },
    });

    return res.json({ deadline: toDeadlineDTO(updated) });
  } catch (e) { next(e); }
});

// DELETE /api/folders/deadlines/:deadlineId
foldersRouter.delete('/deadlines/:deadlineId', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const deadlineId = Number(req.params.deadlineId);

    const dl = await prisma.deadline.findUnique({
      where: { id: deadlineId },
      include: { folder: true },
    });
    if (!dl || dl.folder.userId !== userId) {
      return res.status(404).json({ error: 'Deadline not found' });
    }

    await prisma.deadline.delete({ where: { id: deadlineId } });
    return res.status(204).end();
  } catch (e) { next(e); }
});
