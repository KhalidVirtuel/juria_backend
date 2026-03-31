// src/routes/chat.js
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { authRequired } from '../middleware/auth.js';
import { ragAnswer } from '../services/rag.js';

const prisma = new PrismaClient();
export const chatRouter = express.Router();

// Utilitaire: mapper DB -> shape Frontend
function mapMessage(m) {
  return {
    id: String(m.id),
    conversationId: String(m.conversationId),
    userId: String(m.userId),
    role: (m.role || 'ASSISTANT').toUpperCase() === 'USER' ? 'USER' : 'ASSISTANT',
    content: m.content,
    createdAt: m.createdAt.toISOString(),
  };
}
function mapConversation(c) {
  return {
    id: String(c.id),
    userId: String(c.userId),
    title: c.title,
    folderId: c.folderId ? String(c.folderId) : undefined,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt ? c.updatedAt.toISOString() : c.createdAt.toISOString(),
    messages: c.messages ? c.messages.map(mapMessage) : undefined,
  };
}

// GET /api/chat/conversations?folderId=
chatRouter.get('/conversations', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const { folderId } = req.query;
    const where = { userId };
    if (folderId) where.folderId = Number(folderId);

    const rows = await prisma.conversation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: { id: true, userId: true, title: true, folderId: true, createdAt: true, updatedAt: true },
    });

    return res.json({ conversations: rows.map(mapConversation) });
  } catch (e) { next(e); }
});

// GET /api/chat/conversations/:id
chatRouter.get('/conversations/:id', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const id = Number(req.params.id);
    const conv = await prisma.conversation.findFirst({
      where: { id, userId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    return res.json({ conversation: mapConversation(conv) });
  } catch (e) { next(e); }
});

// POST /api/chat/conversations  { title, folderId? }
chatRouter.post('/conversations', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const { title, folderId } = req.body || {};
    const conv = await prisma.conversation.create({
      data: {
        userId,
        title: title || 'Nouvelle conversation',
        folderId: folderId ? Number(folderId) : null,
      },
      select: { id: true, userId: true, title: true, folderId: true, createdAt: true, updatedAt: true },
    });
    return res.json({ conversation: mapConversation(conv) });
  } catch (e) { next(e); }
});

// PATCH /api/chat/conversations/:id/move { folderId }
chatRouter.patch('/conversations/:id/move', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const id = Number(req.params.id);
    const { folderId } = req.body || {};
    const conv = await prisma.conversation.update({
      where: { id },
      data: { folderId: folderId ? Number(folderId) : null },
      select: { id: true, userId: true, title: true, folderId: true, createdAt: true, updatedAt: true },
    });
    if (conv.userId !== userId) return res.status(403).json({ error: 'Forbidden' });
    return res.json({ conversation: mapConversation(conv) });
  } catch (e) { next(e); }
});

// DELETE /api/chat/conversations/:id
chatRouter.delete('/conversations/:id', authRequired, async (req, res, next) => {
  console.log('DELETE /api/chat/conversations/:id called');
  console.log('Params:', req.params);
  try {
    const userId = req.user.uid;
    const id = Number(req.params.id);
    const conv = await prisma.conversation.findUnique({ where: { id } });
    if (!conv || conv.userId !== userId) return res.status(404).json({ error: 'Conversation not found' });

    await prisma.message.deleteMany({ where: { conversationId: id } });
    await prisma.conversation.delete({ where: { id } });
    return res.status(204).end();
  } catch (e) { next(e); }
});

// POST /api/chat/conversations/:id/messages  { content }
chatRouter.post('/conversations/:id/messages', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const id = Number(req.params.id);
    const { content } = req.body || {};
    if (!content || !content.trim()) return res.status(400).json({ error: 'content required' });

    const conv = await prisma.conversation.findFirst({ where: { id, userId } });
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    const userMessage = await prisma.message.create({
      data: {
        conversationId: id,
        userId,
        role: 'USER',
        content,
      },
    });

    // RAG / LLM
    const { answer } = await ragAnswer({ question: content, metaFilter: { userId } });

    const assistantMessage = await prisma.message.create({
      data: {
        conversationId: id,
        userId,
        role: 'ASSISTANT',
        content: answer || '…',
      },
    });

    return res.json({
      userMessage: mapMessage(userMessage),
      assistantMessage: mapMessage(assistantMessage),
    });
  } catch (e) { next(e); }
});
