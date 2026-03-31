// src/routes/chat.js
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { authRequired } from '../middleware/auth.js';
import { ragAnswer } from '../services/rag.js';

export const chatRouter = express.Router();
const prisma = new PrismaClient();



/**
 * Formate une date en français
 */
function formatDateFrench(date) {
  const mois = [
    'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'
  ];
  
  const d = new Date(date);
  const jour = d.getDate();
  const moisNom = mois[d.getMonth()];
  const annee = d.getFullYear();
  
  return `${jour} ${moisNom} ${annee}`;
}

/* ---------------- Helpers (DTO) ---------------- */

function makeTitleFromContent(text) {
  if (!text) return 'Nouvelle conversation';
  const firstLine = String(text).split(/\r?\n/)[0].trim();
  const cleaned = firstLine.replace(/\s+/g, ' ');
  return cleaned.slice(0, 80) || 'Nouvelle conversation';
}

function toMessageDTO(m) {
  return {
    id: String(m.id),
    conversationId: String(m.conversationId),
    userId: String(m.userId),
    role: m.role,
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
    updatedAt: (c.updatedAt?.toISOString?.() ?? c.createdAt.toISOString()),
  };
  if (withMessages && Array.isArray(c.messages)) {
    return { ...base, messages: c.messages.map(toMessageDTO) };
  }
  return base;
}

/* ---------------- Routes ---------------- */

// GET /api/chat/conversations?folderId=123 (optionnel)
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
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });

    return res.json({
      conversations: conversations.map(c => toConversationDTO(c, { withMessages: true })),
    });
  } catch (e) { next(e); }
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
  } catch (e) { next(e); }
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

    // 1) message USER
    const userMessage = await prisma.message.create({
      data: {
        conversationId: id,
        userId,
        role: 'USER',
        content: String(content),
      },
    });

    // 1bis) Si c'est le premier message, on renomme la conversation
    if (!conv.title || conv.title === 'Nouvelle conversation') {
      const newTitle = makeTitleFromContent(content);
      await prisma.conversation.update({
        where: { id },
        data: { title: newTitle },
      });
    }

    // 2) RAG → answer avec détection d'événements timeline
    let answerText = 'Réponse IA indisponible pour le moment.';
    let timelineEvents = [];
    
    try {
      const metaFilter = {
        userId,
        ...(conv.folderId ? { folderId: conv.folderId } : {}),
      };
      
      const result = await ragAnswer({ question: content, metaFilter });
      
      if (result.answer && typeof result.answer === 'string') {
        answerText = result.answer;
        timelineEvents = result.timelineEvents || [];
      }
    } catch (err) {
      console.warn('[RAG error]', err);
    }

    // 3) message ASSISTANT (persisté)
    const assistantMessage = await prisma.message.create({
      data: {
        conversationId: id,
        userId,
        role: 'ASSISTANT',
        content: answerText,
      },
    });

    // ✅ 4) ENREGISTREMENT DE TOUTES LES TIMELINES DÉTECTÉES
    const createdTimelineEvents = [];
    
    if (conv.folderId && timelineEvents && timelineEvents.length > 0) {
      console.log(`[Timeline] Tentative de création de ${timelineEvents.length} événements`);
      
      for (const event of timelineEvents) {
        try {
          const created = await saveToTimeline(conv.folderId, userId, event);
          createdTimelineEvents.push(created);
          console.log(`[Timeline Auto-Save] ✅ ${event.type} créé: ${event.title}`);
        } catch (err) {
          console.error(`[Timeline Auto-Save Error] ❌ ${event.type}:`, err.message);
          // Continue avec les autres événements même si un échoue
        }
      }
      
      console.log(`[Timeline] ${createdTimelineEvents.length}/${timelineEvents.length} événements créés avec succès`);
    } else {
      if (!conv.folderId) {
        console.log('[Timeline] Conversation non liée à un dossier, pas de timeline créée');
      }
      if (!timelineEvents || timelineEvents.length === 0) {
        console.log('[Timeline] Aucun événement détecté dans la réponse');
      }
    }

    return res.json({
      userMessage: {
        id: String(userMessage.id),
        conversationId: String(userMessage.conversationId),
        userId: String(userMessage.userId),
        role: userMessage.role,
        content: userMessage.content,
        createdAt: userMessage.createdAt.toISOString(),
      },
      assistantMessage: {
        id: String(assistantMessage.id),
        conversationId: String(assistantMessage.conversationId),
        userId: String(assistantMessage.userId),
        role: assistantMessage.role,
        content: assistantMessage.content,
        createdAt: assistantMessage.createdAt.toISOString(),
      },
      // ✅ Retourner TOUS les événements timeline créés
      timelineEvents: createdTimelineEvents.map(ev => ({
        id: String(ev.id),
        folderId: String(ev.folderId),
        title: ev.label,
        type: ev.type,
        description: ev.note ?? '',
        date: ev.date.toISOString(),
        createdAt: ev.createdAt.toISOString(),
      })),
    });
  } catch (e) { next(e); }
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

    // 1) message USER
    const userMessage = await prisma.message.create({
      data: {
        conversationId: id,
        userId,
        role: 'USER',
        content: String(content),
      },
    });

    // 1bis) Si c'est le premier message, on renomme la conversation
    if (!conv.title || conv.title === 'Nouvelle conversation') {
      const newTitle = makeTitleFromContent(content);
      await prisma.conversation.update({
        where: { id },
        data: { title: newTitle },
      });
    }

    // 2) RAG → answer avec détection d'événements timeline
    let answerText = 'Réponse IA indisponible pour le moment.';
    let timelineEvent = null;
    
    try {
      const metaFilter = {
        userId,
        ...(conv.folderId ? { folderId: conv.folderId } : {}),
      };
      
      const result = await ragAnswer({ question: content, metaFilter });
      
      if (result.answer && typeof result.answer === 'string') {
        answerText = result.answer;
        timelineEvent = result.timelineEvent;
      }
    } catch (err) {
      console.warn('[RAG error]', err);
    }

    // 3) message ASSISTANT (persisté)
    const assistantMessage = await prisma.message.create({
      data: {
        conversationId: id,
        userId,
        role: 'ASSISTANT',
        content: answerText,
      },
    });

    // ✅ 4) ENREGISTREMENT AUTOMATIQUE DANS LA TIMELINE
    let createdTimelineEvent = null;
    
    if (conv.folderId && timelineEvent) {
      try {
        createdTimelineEvent = await saveToTimeline(
          conv.folderId,
          userId,
          timelineEvent
        );
        console.log(`[Timeline Auto-Save] ${timelineEvent.type} créé: ${timelineEvent.title}`);
      } catch (err) {
        console.error('[Timeline Auto-Save Error]', err);
        // Ne pas bloquer la réponse si l'enregistrement timeline échoue
      }
    }

    return res.json({
      userMessage: {
        id: String(userMessage.id),
        conversationId: String(userMessage.conversationId),
        userId: String(userMessage.userId),
        role: userMessage.role,
        content: userMessage.content,
        createdAt: userMessage.createdAt.toISOString(),
      },
      assistantMessage: {
        id: String(assistantMessage.id),
        conversationId: String(assistantMessage.conversationId),
        userId: String(assistantMessage.userId),
        role: assistantMessage.role,
        content: assistantMessage.content,
        createdAt: assistantMessage.createdAt.toISOString(),
      },
      // ✅ Inclure l'événement timeline créé s'il existe
      timelineEvent: createdTimelineEvent ? {
        id: String(createdTimelineEvent.id),
        folderId: String(createdTimelineEvent.folderId),
        title: createdTimelineEvent.label,
        type: createdTimelineEvent.type,
        description: createdTimelineEvent.note ?? '',
        date: createdTimelineEvent.date.toISOString(),
        createdAt: createdTimelineEvent.createdAt.toISOString(),
      } : null,
    });
  } catch (e) { next(e); }
});


/**
 * ✅ Enregistre un événement dans la timeline
 */
async function saveToTimeline(folderId, userId, eventData) {
  const folder = await prisma.folder.findFirst({
    where: { id: folderId, userId },
  });
  
  if (!folder) {
    throw new Error('Folder not found or access denied');
  }

  const allowedTypes = ['FACT', 'PROCEDURE', 'HEARING', 'DEADLINE', 'EVENT'];
  if (!allowedTypes.includes(eventData.type)) {
    throw new Error(`Invalid timeline event type: ${eventData.type}`);
  }

  const eventDate = eventData.date || new Date();
  const MAX_NOTE_LENGTH = 1000000;
  let note = eventData.description || '';
  
  if (note.length > MAX_NOTE_LENGTH) {
    note = note.substring(0, MAX_NOTE_LENGTH - 3) + '...';
  }

  // ✅ Ajouter la date en français dans le titre
  let finalLabel = eventData.title.slice(0, 200);
  
  if (eventData.type === 'DEADLINE' || eventData.type === 'HEARING') {
    const dateFr = formatDateFrench(eventDate);
    finalLabel = `${finalLabel} - ${dateFr}`;
  }

  const timelineEvent = await prisma.timelineEvent.create({
    data: {
      folderId,
      label: finalLabel.slice(0, 255),
      type: eventData.type,
      note,
      date: eventDate,
    },
  });

  return timelineEvent;
}

// PATCH /api/chat/conversations/:id/move
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
  } catch (e) { next(e); }
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
  } catch (e) { next(e); }
});
