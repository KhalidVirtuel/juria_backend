// src/routes/chat.js
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { authRequired } from '../middleware/auth.js';
// si tu as un ragAnswer opérationnel, décommente et utilise-le plus bas
// import { ragAnswer } from '../services/rag.js';

export const chatRouter = express.Router();
const prisma = new PrismaClient();

/* ---------- DTO helpers ---------- */
function toMessageDTO(m) {
  return {
    id: String(m.id),
    conversationId: String(m.conversationId),
    userId: String(m.userId),
    role: m.role, // 'USER' | 'ASSISTANT'
    content: m.content,
    createdAt: m.createdAt.toISOString(),
  };
}

function toConversationDTO(c, { withMessages = false } = {}) {
  const base = {
    id: String(c.id),
    userId: String(c.userId),
    title: c.title,
    folderId: c.folderId == null ? undefined : String(c.folderId),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString?.() ?? c.createdAt.toISOString(),
  };
  if (withMessages && Array.isArray(c.messages)) {
    return { ...base, messages: c.messages.map(toMessageDTO) };
  }
  return base;
}

/* ---------- Routes ---------- */

// GET /api/chat/conversations
// Optionnel: ?folderId=123 pour filtrer
chatRouter.get('/conversations', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const folderId = req.query.folderId ? Number(req.query.folderId) : undefined;

    const conversations = await prisma.conversation.findMany({
      where: {
        userId,
        ...(folderId ? { folderId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        messages: { orderBy: { createdAt: 'asc' } }, // ⬅️ important pour l’historique
      },
    });

    return res.json({
      conversations: conversations.map(c => toConversationDTO(c, { withMessages: true })),
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/chat/conversations/:id
chatRouter.get('/conversations/:id', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const id = Number(req.params.id);

    const c = await prisma.conversation.findFirst({
      where: { id, userId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!c) return res.status(404).json({ error: 'Conversation not found' });

    return res.json({ conversation: toConversationDTO(c, { withMessages: true }) });
  } catch (e) {
    next(e);
  }
});

// POST /api/chat/conversations
chatRouter.post('/conversations', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const { title = 'Nouvelle conversation', folderId } = req.body || {};

    const c = await prisma.conversation.create({
      data: {
        userId,
        title: String(title),
        folderId: folderId ? Number(folderId) : null,
      },
      include: { messages: true },
    });

    return res.json({ conversation: toConversationDTO(c, { withMessages: true }) });
  } catch (e) {
    next(e);
  }
});

// POST /api/chat/conversations/:id/messages
chatRouter.post('/conversations/:id/messages', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const id = Number(req.params.id);
    const { content } = req.body || {};
    if (!content) return res.status(400).json({ error: 'content required' });

    const conv = await prisma.conversation.findFirst({ where: { id, userId } });
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    // 1) message utilisateur
    const userMessage = await prisma.message.create({
      data: {
        conversationId: id,
        userId,
        role: 'USER',
        content: String(content),
      },
    });

    // 2) réponse assistant (placeholder). Remplace par ragAnswer si tu veux.
    // const { answer } = await ragAnswer({ question: content, metaFilter: {} });
    const answer = 'Réponse IA (placeholder)'; // <-- remplace par ton appel RAG/LLM

    const assistantMessage = await prisma.message.create({
      data: {
        conversationId: id,
        userId, // on associe au propriétaire
        role: 'ASSISTANT',
        content: answer,
      },
    });

    return res.json({
      userMessage: toMessageDTO(userMessage),
      assistantMessage: toMessageDTO(assistantMessage),
    });
  } catch (e) {
    next(e);
  }
});

// PATCH /api/chat/conversations/:id/move  (facultatif si ton front l’utilise)
chatRouter.patch('/conversations/:id/move', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const id = Number(req.params.id);
    const { folderId } = req.body || {};

    const conv = await prisma.conversation.findFirst({ where: { id, userId } });
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    const updated = await prisma.conversation.update({
      where: { id },
      data: { folderId: folderId ? Number(folderId) : null },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });

    return res.json({ conversation: toConversationDTO(updated, { withMessages: true }) });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/chat/conversations/:id
chatRouter.delete('/conversations/:id', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const id = Number(req.params.id);

    const conv = await prisma.conversation.findFirst({ where: { id, userId } });
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    await prisma.message.deleteMany({ where: { conversationId: id } });
    await prisma.conversation.delete({ where: { id } });
    return res.status(204).end();
  } catch (e) {
    next(e);
  }
});
