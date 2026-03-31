// src/routes/chat.js
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { authRequired } from '../middleware/auth.js';
import { ragAnswer } from '../services/rag.js';

export const chatRouter = express.Router();
const prisma = new PrismaClient();

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

async function saveToTimeline(folderId, userId, eventData, conversationId = null) {
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

  let finalLabel = eventData.title.slice(0, 200);
  
  if (eventData.type === 'DEADLINE' || eventData.type === 'HEARING') {
    const dateFr = formatDateFrench(eventDate);
    finalLabel = `${finalLabel} - ${dateFr}`;
  }

  const timelineEvent = await prisma.timelineEvent.create({
    data: {
      folderId,
      conversationId,
      label: finalLabel.slice(0, 255),
      type: eventData.type,
      note,
      date: eventDate,
    },
  });

  return timelineEvent;
}

async function saveDocument(folderId, userId, documentData, conversationId = null) {
  const folder = await prisma.folder.findFirst({
    where: { id: folderId, userId },
  });
  
  if (!folder) {
    throw new Error('Folder not found or access denied');
  }

  const allowedTypes = ['CONTRACT', 'CONCLUSION', 'NOTE', 'LETTER', 'REPORT'];
  if (!allowedTypes.includes(documentData.type)) {
    throw new Error(`Invalid document type: ${documentData.type}`);
  }

  const document = await prisma.genDoc.create({
    data: {
      userId,
      folderId,
      conversationId,
      title: documentData.title.slice(0, 255),
      type: documentData.type,
      content: documentData.content,
    },
  });

  return document;
}

/* ---------------- Routes ---------------- */

// ✅ STREAMING ENDPOINT - DOIT ÊTRE EN PREMIER
chatRouter.post('/conversations/:id/messages/stream', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const id = Number(req.params.id);
    const { content } = req.body || {};
    console.log('🚀 [STREAM] New request for conversation', id); // Debug
    if (!content) {
      return res.status(400).json({ error: 'content required' });
    }

    console.log('🎬 [STREAM] Starting for conversation', id); // Debug

    // Setup SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Fonction pour envoyer une étape
    const sendStep = (step, message, details = null) => {
      const data = JSON.stringify({ type: 'step', step, message, details });
      console.log('📤 [STREAM] Sending:', data); // Debug
      res.write(`data: ${data}\n\n`);
    };

    // Récupérer la conversation
    const conv = await prisma.conversation.findFirst({ 
      where: { id, userId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 30,
        }
      }
    });
    
    if (!conv) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Conversation not found' })}\n\n`);
      return res.end();
    }

    // Étape 1
    sendStep('saving_user', 'Enregistrement de votre question...');
    
    const userMessage = await prisma.message.create({
      data: {
        conversationId: id,
        userId,
        role: 'USER',
        content: String(content),
      },
    });

    if (!conv.title || conv.title === 'Nouvelle conversation') {
      const newTitle = makeTitleFromContent(content);
      await prisma.conversation.update({
        where: { id },
        data: { title: newTitle },
      });
    }

    // 🆕 RÉCUPÉRATION HISTORIQUE DU DOSSIER
    let folderHistory = [];
    
    if (conv.folderId) {
      console.log(`[CHAT] 📂 Récupération historique dossier ${conv.folderId}`);
      
      try {
        const folderConversations = await prisma.conversation.findMany({
          where: { 
            folderId: conv.folderId,
            userId: userId
          },
          include: {
            messages: {
              orderBy: { createdAt: 'asc' },
              select: { 
                role: true, 
                content: true 
              }
            }
          },
          orderBy: { createdAt: 'asc' }
        });

        folderHistory = folderConversations
          .flatMap(c => c.messages)
          .map(m => ({
            role: m.role === 'USER' ? 'user' : 'assistant',
            content: m.content
          }));

        console.log(`[CHAT] ✅ ${folderHistory.length} messages du dossier récupérés`);
        
      } catch (error) {
        console.error('[CHAT] ⚠️ Erreur historique dossier:', error);
      }
    }

    // Étape 2
    sendStep('searching', 'Recherche dans la base de connaissances juridiques...', 
      'Analyse de vos documents et jurisprudence');
    
    const messageHistory = conv.messages.map(m => ({
      role: m.role === 'USER' ? 'user' : 'assistant',
      content: m.content,
    }));
    messageHistory.push({ role: 'user', content: String(content) });

    let answerText = 'Réponse IA indisponible pour le moment.';
    let timelineEvents = [];
    let documents = [];
    let docsFound = 0;
    let intention = 'general';
    
    try {
    /*  const metaFilter = {
        userId,
        ...(conv.folderId ? { folderId: conv.folderId } : {}),
      };*/
const metaFilter = {}; // ✅ Pas de filtre

      console.log('[CHAT] 🔍 Appel RAG avec:', {
    question: content.substring(0, 50),
    metaFilter,
    historyLength: messageHistory.length
  });
            console.log('[CHAT] 🔍 Appel RAG avec:', 
        { question: content, metaFilter, messageHistory });
      const result = await ragAnswer({ 
        question: content, 
        metaFilter,
        messageHistory,
        folderHistory, 
      });
      
      if (result.answer && typeof result.answer === 'string') {
        answerText = result.answer;
        timelineEvents = result.timelineEvents || [];
        documents = result.documents || [];
        docsFound = result.documentsCount || 0;
        intention = result.intention || 'general';
      }

      // Étape 3
      if (docsFound > 0) {
        sendStep('documents_found', `${docsFound} document(s) pertinent(s) trouvé(s)`, 
          'Sources juridiques identifiées');
      } else {
        sendStep('no_documents', 'Utilisation des connaissances générales', 
          'Aucun document spécifique trouvé');
      }

    } catch (err) {
      console.warn('[RAG error]', err);
      sendStep('rag_error', 'Erreur lors de la recherche, utilisation du modèle de base');
    }

    // Étape 4
    sendStep('generating', 'Génération de la réponse juridique...', 
      'Analyse et rédaction en cours');

    const assistantMessage = await prisma.message.create({
      data: {
        conversationId: id,
        userId,
        role: 'ASSISTANT',
        content: answerText,
      },
    });

    // Étape 5
    const createdTimelineEvents = [];
    
    if (conv.folderId && timelineEvents && timelineEvents.length > 0) {
      sendStep('saving_timeline', `Création de ${timelineEvents.length} événement(s) timeline...`);
      
      for (const event of timelineEvents) {
        try {
          const created = await saveToTimeline(conv.folderId, userId, event, id);
          createdTimelineEvents.push(created);
        } catch (err) {
          console.error(`[Timeline Error]`, err.message);
        }
      }
    }

    // Étape 6
    const createdDocuments = [];
    
    if (conv.folderId && documents && documents.length > 0) {
      sendStep('saving_documents', `Création de ${documents.length} document(s)...`);
      
      for (const doc of documents) {
        try {
          const created = await saveDocument(conv.folderId, userId, doc, id);
          createdDocuments.push(created);
        } catch (err) {
          console.error(`[Document Error]`, err.message);
        }
      }
    }

    // Étape finale
    sendStep('complete', 'Réponse générée avec succès');
    
    res.write(`data: ${JSON.stringify({
      type: 'complete',
      userMessage: toMessageDTO(userMessage),
      assistantMessage: toMessageDTO(assistantMessage),
      intention: intention, // 🆕 Retourner l'intention
      timelineEvents: createdTimelineEvents.map(ev => ({
        id: String(ev.id),
        folderId: String(ev.folderId),
        title: ev.label,
        type: ev.type,
        description: ev.note ?? '',
        date: ev.date.toISOString(),
        createdAt: ev.createdAt.toISOString(),
      })),
      documents: createdDocuments.map(doc => ({
        id: String(doc.id),
        folderId: String(doc.folderId),
        title: doc.title,
        type: doc.type,
        content: doc.content,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
      })),
    })}\n\n`);
    
    console.log('✅ [STREAM] Complete'); // Debug
    res.end();
    
  } catch (error) {
    console.error('❌ [STREAM] Error:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
    res.end();
  }
});
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
    console.log('🚀 Fetching conversation', id); // Debug
    const c = await prisma.conversation.findFirst({
      where: { id, userId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!c) return res.status(404).json({ error: 'Conversation not found' });

    return res.json({ conversation: toConversationDTO(c, { withMessages: true }) });
  } catch (e) { next(e); }
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
  } catch (e) { next(e); }
});


// POST /api/chat/conversations/:id/messages
chatRouter.post('/conversations/:id/messages', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const id = Number(req.params.id);
    const { content } = req.body || {};
    if (!content) return res.status(400).json({ error: 'content required' });
    console.log('🚀 New message for conversation', id); // Debug
    // ✅ Récupérer la conversation AVEC l'historique des messages
    const conv = await prisma.conversation.findFirst({ 
      where: { id, userId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 30, // ✅ Garder les 30 derniers messages pour le contexte
        }
      }
    });
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

    // ✅ 2) Construire l'historique des messages pour le contexte
    const messageHistory = conv.messages.map(m => ({
      role: m.role === 'USER' ? 'user' : 'assistant',
      content: m.content,
    }));

    // Ajouter le nouveau message utilisateur à l'historique
    messageHistory.push({
      role: 'user',
      content: String(content),
    });

    // 3) RAG → answer avec historique
    let answerText = 'Réponse IA indisponible pour le moment.';
    let timelineEvents = [];
    let documents = [];
    
    try {
      /*const metaFilter = {
        userId,
        ...(conv.folderId ? { folderId: conv.folderId } : {}),
      };*/
      const metaFilter = {}; // ✅ Pas de filtre

      console.log('[CHAT] 🔍 Appel RAG avec:', {
    question: content.substring(0, 50),
    metaFilter,
    historyLength: messageHistory.length
  });
      // ✅ Passer l'historique des messages
      console.log('[CHAT] 🔍 Appel RAG avec:', 
        { question: content, metaFilter, messageHistory });
      const result = await ragAnswer({ 
        question: content, 
        metaFilter,
        messageHistory, 
      });
      
      console.log("RAG result:", result);
      if (result.answer && typeof result.answer === 'string') {
        answerText = result.answer;
        timelineEvents = result.timelineEvents || [];
        documents = result.documents || [];
      }
    } catch (err) {
      console.warn('[RAG error]', err);
    }

    // 4) message ASSISTANT (persisté)
    const assistantMessage = await prisma.message.create({
      data: {
        conversationId: id,
        userId,
        role: 'ASSISTANT',
        content: answerText,
      },
    });

    // 5) ENREGISTREMENT DES TIMELINES
    const createdTimelineEvents = [];
    
    if (conv.folderId && timelineEvents && timelineEvents.length > 0) {
      for (const event of timelineEvents) {
        try {
          const created = await saveToTimeline(conv.folderId, userId, event, id);
          createdTimelineEvents.push(created);
          console.log(`[Timeline Auto-Save] ✅ ${event.type} créé: ${event.title}`);
        } catch (err) {
          console.error(`[Timeline Auto-Save Error] ❌ ${event.type}:`, err.message);
        }
      }
    }

    // 6) ENREGISTREMENT DES DOCUMENTS
    const createdDocuments = [];
    
    if (conv.folderId && documents && documents.length > 0) {
      for (const doc of documents) {
        try {
          const created = await saveDocument(conv.folderId, userId, doc, id);
          createdDocuments.push(created);
          console.log(`[Document Auto-Save] ✅ ${doc.type} créé: ${doc.title}`);
        } catch (err) {
          console.error(`[Document Auto-Save Error] ❌ ${doc.type}:`, err.message);
        }
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
      timelineEvents: createdTimelineEvents.map(ev => ({
        id: String(ev.id),
        folderId: String(ev.folderId),
        title: ev.label,
        type: ev.type,
        description: ev.note ?? '',
        date: ev.date.toISOString(),
        createdAt: ev.createdAt.toISOString(),
      })),
      documents: createdDocuments.map(doc => ({
        id: String(doc.id),
        folderId: String(doc.folderId),
        title: doc.title,
        type: doc.type,
        content: doc.content,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
      })),
    });
  } catch (e) { next(e); }
});

// PATCH /api/chat/conversations/:id/move
chatRouter.patch('/conversations/:id/move', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const id = Number(req.params.id);
    const { folderId } = req.body || {};

    const conv = await prisma.conversation.findFirst({ where: { id, userId } });
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    if (folderId) {
      const folder = await prisma.folder.findFirst({
        where: { id: Number(folderId), userId },
      });
      if (!folder) {
        return res.status(404).json({ error: 'Folder not found' });
      }
    }

    // ✅ Déplacer les timelines
    if (folderId && conv.folderId !== Number(folderId)) {
      const movedTimelines = await prisma.timelineEvent.updateMany({
        where: { conversationId: id },
        data: { folderId: Number(folderId) },
      });
      console.log(`[Timeline] ${movedTimelines.count} timeline(s) déplacée(s)`);
      
      // ✅ Nouveau : Déplacer les documents générés
      const movedDocs = await prisma.genDoc.updateMany({
        where: { conversationId: id },
        data: { folderId: Number(folderId) },
      });
      console.log(`[Documents] ${movedDocs.count} document(s) déplacé(s)`);
    }

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

    // ✅ Supprimer les timelines liées
    const deletedTimelines = await prisma.timelineEvent.deleteMany({
      where: { conversationId: id },
    });
    console.log(`[Timeline] ${deletedTimelines.count} timeline(s) supprimée(s)`);

    // ✅ Nouveau : Supprimer les documents générés liés
    const deletedDocs = await prisma.genDoc.deleteMany({
      where: { conversationId: id },
    });
    console.log(`[Documents] ${deletedDocs.count} document(s) supprimé(s)`);

    // Supprimer les messages
    await prisma.message.deleteMany({ where: { conversationId: id } });
    
    // Supprimer la conversation
    await prisma.conversation.delete({ where: { id } });
    
    return res.status(204).end();
  } catch (e) { next(e); }
});




// 🧪 ROUTE DE TEST - À SUPPRIMER APRÈS DEBUG
chatRouter.post('/test-rag', authRequired, async (req, res) => {
  try {
    const { question } = req.body;
    
    console.log('[TEST-RAG] Question:', question);
    
    const result = await ragAnswer({
      question: question || "Qui prépare le projet du budget des juridictions financières ?",
      metaFilter: {},
      messageHistory: [],
      folderHistory: null
    });
    
    console.log('[TEST-RAG] Résultat:', {
      documentsCount: result.documentsCount,
      intention: result.intention,
      answerLength: result.answer?.length,
      contextLength: result.context?.length
    });
    
    return res.json({
      ok: true,
      question,
      answer: result.answer,
      documentsCount: result.documentsCount,
      intention: result.intention,
      context: result.context?.substring(0, 500), // Premiers 500 chars
      fullResult: result
    });
    
  } catch (error) {
    console.error('[TEST-RAG] Erreur:', error);
    return res.status(500).json({
      ok: false,
      error: error.message,
      stack: error.stack
    });
  }
});