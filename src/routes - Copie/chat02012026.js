// src/routes/chat.js
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { authRequired } from '../middleware/auth.js';
import { ragAnswer } from '../services/rag.js';

// ✅ AJOUTER CES IMPORTS EN HAUT DU FICHIER (après les imports existants)
import { 
  detectDocumentGeneration, 
  identifyDocumentType,
  DOCUMENT_TEMPLATES 
} from '../services/documentTemplates.js';
import {
  getOrCreateSession,
  updateSessionData,
  getNextRequiredField,
  extractValue,
  generateDocumentHTML,
  saveGeneratedDocument,
  completeSession,
  cancelSession,
  getActiveSession,
  isSessionComplete,
  getSummary
} from '../services/documentGenerationService.js';

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
    const { content, folderId } = req.body || {}; // ✅ Ajoute folderId
    console.log('🚀 [STREAM] New request for conversation', id);
    
    if (!content) {
      return res.status(400).json({ error: 'content required' });
    }

    console.log('🎬 [STREAM] Starting for conversation', id);

    // Setup SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Fonction pour envoyer une étape
    const sendStep = (step, message, details = null) => {
      const data = JSON.stringify({ type: 'step', step, message, details });
      console.log('📤 [STREAM] Sending:', data);
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

    const effectiveFolderId = folderId || conv.folderId;

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

    // ========================================
    // ✅ GÉNÉRATION DE DOCUMENTS CONVERSATIONNELLE
    // ========================================

    let activeSession = await getActiveSession(id);

    if (!activeSession && detectDocumentGeneration(content)) {
      const documentType = identifyDocumentType(content);
      
      if (!documentType) {
        const assistantMessage = await prisma.message.create({
          data: {
            conversationId: id,
            userId,
            role: 'ASSISTANT',
            content: "Je peux vous aider à créer un document juridique. Quel type de document souhaitez-vous créer ?\n\n" +
                     "📄 **Documents disponibles :**\n" +
                     "- **CDD** : Contrat à Durée Déterminée\n" +
                     "- **CDI** : Contrat à Durée Indéterminée\n" +
                     "- **Lettre de démission**\n\n" +
                     "Indiquez simplement le type de document."
          }
        });
        
        sendStep('complete', 'Réponse générée');
        res.write(`data: ${JSON.stringify({
          type: 'complete',
          userMessage: toMessageDTO(userMessage),
          assistantMessage: toMessageDTO(assistantMessage),
          timelineEvents: [],
          documents: []
        })}\n\n`);
        return res.end();
      }

      if (!effectiveFolderId) {
        const assistantMessage = await prisma.message.create({
          data: {
            conversationId: id,
            userId,
            role: 'ASSISTANT',
            content: "⚠️ Pour générer un document, sélectionnez d'abord un dossier."
          }
        });
        
        sendStep('complete', 'Réponse générée');
        res.write(`data: ${JSON.stringify({
          type: 'complete',
          userMessage: toMessageDTO(userMessage),
          assistantMessage: toMessageDTO(assistantMessage),
          timelineEvents: [],
          documents: []
        })}\n\n`);
        return res.end();
      }

      // Créer session
      activeSession = await getOrCreateSession(id, userId, parseInt(effectiveFolderId), documentType);

      const template = DOCUMENT_TEMPLATES[documentType];
      const firstField = template.fields[0];

      const assistantMessage = await prisma.message.create({
        data: {
          conversationId: id,
          userId,
          role: 'ASSISTANT',
          content: `✅ Parfait ! Je vais créer un **${template.name}**.\n\n` +
                   `**Question 1/${template.fields.filter(f => f.required).length}** : ${firstField.question}`
        }
      });

      sendStep('complete', 'Réponse générée');
      res.write(`data: ${JSON.stringify({
        type: 'complete',
        userMessage: toMessageDTO(userMessage),
        assistantMessage: toMessageDTO(assistantMessage),
        metadata: { collectingData: true },
        timelineEvents: [],
        documents: []
      })}\n\n`);
      return res.end();
    }

    // Si session active, collecter
    if (activeSession) {
      const template = DOCUMENT_TEMPLATES[activeSession.documentType];
      const currentField = getNextRequiredField(activeSession);

      if (currentField) {
        const value = extractValue(content, currentField.key);
        await updateSessionData(activeSession.id, currentField.key, value);

        activeSession = await getActiveSession(id);
        const nextField = getNextRequiredField(activeSession);

        if (nextField) {
          const collectedCount = Object.keys(activeSession.collectedData || {}).length;
          const totalRequired = template.fields.filter(f => f.required).length;

          const assistantMessage = await prisma.message.create({
            data: {
              conversationId: id,
              userId,
              role: 'ASSISTANT',
              content: `✅ Information enregistrée.\n\n` +
                       `**Question ${collectedCount + 1}/${totalRequired}** : ${nextField.question}`
            }
          });

          sendStep('complete', 'Réponse générée');
          res.write(`data: ${JSON.stringify({
            type: 'complete',
            userMessage: toMessageDTO(userMessage),
            assistantMessage: toMessageDTO(assistantMessage),
            metadata: { collectingData: true },
            timelineEvents: [],
            documents: []
          })}\n\n`);
          return res.end();
        } else {
          // GÉNÉRATION DU DOCUMENT
          const summary = getSummary(activeSession);
          const htmlContent = generateDocumentHTML(activeSession.documentType, activeSession.collectedData);
          
          const generatedDoc = await prisma.genDoc.create({
            data: {
              userId,
              folderId: activeSession.folderId,
              conversationId: id,
              title: `${template.name}`,
              type: template.type.toUpperCase(),
              content: htmlContent,
            }
          });

          await completeSession(activeSession.id);

          const assistantMessage = await prisma.message.create({
            data: {
              conversationId: id,
              userId,
              role: 'ASSISTANT',
               content: `✅ **Document créé avec succès !**\n\n` +
             summary + `\n\n` +
             `📄 Le document - ${generatedDoc.title} - a été ajouté à votre dossier.\n\n` +
             `[Editer - ${generatedDoc.title} -](#document-${generatedDoc.id})` // ✅ AJOU

              /*content: `✅ **Document créé avec succès !**\n\n` +
                       summary + `\n\n` +
                       `📄 Le document **"${generatedDoc.title}"** a été ajouté à votre dossier.`*/
            }
          });

          sendStep('complete', 'Document créé avec succès');
          res.write(`data: ${JSON.stringify({
            type: 'complete',
            userMessage: toMessageDTO(userMessage),
            assistantMessage: toMessageDTO(assistantMessage),
            metadata: {
              documentGenerated: true,
              documentId: String(generatedDoc.id),
              documentTitle: generatedDoc.title
            },
            timelineEvents: [],
            documents: [{
              id: String(generatedDoc.id),
              folderId: String(generatedDoc.folderId),
              title: generatedDoc.title,
              type: generatedDoc.type,
              content: generatedDoc.content,
              createdAt: generatedDoc.createdAt.toISOString(),
              updatedAt: generatedDoc.updatedAt.toISOString(),
            }]
          })}\n\n`);
          return res.end();
        }
      }
    }

    // ========================================
    // LOGIQUE RAG NORMALE
    // ========================================
    
    const messageHistory = conv.messages.map(m => ({
      role: m.role === 'USER' ? 'user' : 'assistant',
      content: m.content,
    }));

    messageHistory.push({
      role: 'user',
      content: String(content),
    });

    let answerText = 'Réponse IA indisponible.';
    let timelineEvents = [];
    let documents = [];
    
    try {
      const metaFilter = {};
      
      const result = await ragAnswer({ 
        question: content, 
        metaFilter,
        messageHistory, 
      });
      
      if (result.answer && typeof result.answer === 'string') {
        answerText = result.answer;
        timelineEvents = result.timelineEvents || [];
        documents = result.documents || [];
      }
    } catch (err) {
      console.warn('[RAG error]', err);
    }

    const assistantMessage = await prisma.message.create({
      data: {
        conversationId: id,
        userId,
        role: 'ASSISTANT',
        content: answerText,
      },
    });

    // Enregistrement timelines
    const createdTimelineEvents = [];
    if (effectiveFolderId && timelineEvents && timelineEvents.length > 0) {
      for (const event of timelineEvents) {
        try {
          const created = await saveToTimeline(effectiveFolderId, userId, event, id);
          createdTimelineEvents.push(created);
        } catch (err) {
          console.error(`[Timeline Error]`, err.message);
        }
      }
    }

    // Enregistrement documents
    const createdDocuments = [];
    if (effectiveFolderId && documents && documents.length > 0) {
      for (const doc of documents) {
        try {
          const created = await prisma.genDoc.create({
            data: {
              userId,
              folderId: effectiveFolderId,
              conversationId: id,
              title: doc.title,
              type: doc.type.toUpperCase(),
              content: doc.content,
            }
          });
          createdDocuments.push(created);
        } catch (err) {
          console.error(`[Document Error]`, err.message);
        }
      }
    }

 await prisma.conversation.update({
      where: { id },
      data: { updatedAt: new Date() }
    });

    sendStep('complete', 'Réponse générée avec succès');

    res.write(`data: ${JSON.stringify({
      type: 'complete',
      userMessage: toMessageDTO(userMessage),
      aiMessage: toMessageDTO(assistantMessage),
      metadata: {
        documentGenerated: false
      },
      timelineEvents: createdTimelineEvents.map(t => ({
        id: String(t.id),
        title: t.title,
        description: t.description,
        type: t.type,
        date: t.date.toISOString(),
        folderId: String(t.folderId),
        createdAt: t.createdAt.toISOString()
      })),
      documents: createdDocuments.map(d => ({
        id: String(d.id),
        folderId: String(d.folderId),
        title: d.title,
        type: d.type,
        content: d.content,
        createdAt: d.createdAt.toISOString(),
        updatedAt: d.updatedAt.toISOString()
      }))
    })}\n\n`);

    return res.end();

  } catch (error) {
    console.error('❌ Chat error:', error);
    
    // ✅ En cas d'erreur, envoyer aussi en format SSE
    try {
      res.write(`data: ${JSON.stringify({
        type: 'error',
        error: error.message || 'Erreur serveur'
      })}\n\n`);
      return res.end();
    } catch (e) {
      // Si on ne peut plus écrire, c'est que la connexion est déjà fermée
      return;
    }
  }
});
/* ---------------- Routes ---------------- */
// GET /api/chat/documents/:id - Récupérer un document par ID
// GET /api/chat/documents/:id - Récupérer un document par ID
chatRouter.get('/documents/:id', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const id = parseInt(req.params.id);
    
    console.log(`[DOCUMENTS] Loading document ${id} for user ${userId}`);
    
    const document = await prisma.genDoc.findFirst({
      where: { id, userId }
    });
    
    if (!document) {
      console.log(`[DOCUMENTS] Document ${id} not found`);
      return res.status(404).json({ error: 'Document not found' });
    }
    
    console.log(`[DOCUMENTS] ✅ Document found: ${document.title}`);
    
    return res.json({
      id: String(document.id),
      folderId: String(document.folderId),
      title: document.title,
      type: document.type,
      content: document.content,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString()
    });
  } catch (e) {
    console.error('[DOCUMENTS] Error:', e);
    next(e);
  }
});

// PUT /api/folders/:folderId/documents/:documentId - Mettre à jour un document
chatRouter.put('/folders/:folderId/documents/:documentId', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const folderId = parseInt(req.params.folderId);
    const documentId = parseInt(req.params.documentId);
    const { title, type, content } = req.body;
    
    console.log(`[DOCUMENTS] Updating document ${documentId} in folder ${folderId}`);
    
    // Vérifier que le document appartient à l'utilisateur
    const document = await prisma.genDoc.findFirst({
      where: { 
        id: documentId,
        folderId,
        userId
      }
    });
    
    if (!document) {
      console.log(`[DOCUMENTS] Document ${documentId} not found or access denied`);
      return res.status(404).json({ error: 'Document not found' });
    }
    
    // Mettre à jour le document
    const updated = await prisma.genDoc.update({
      where: { id: documentId },
      data: {
        title: title || document.title,
        type: type || document.type,
        content: content || document.content,
        updatedAt: new Date()
      }
    });
    
    console.log(`[DOCUMENTS] ✅ Document updated: ${updated.title}`);
    
    return res.json({
      id: String(updated.id),
      folderId: String(updated.folderId),
      title: updated.title,
      type: updated.type,
      content: updated.content,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString()
    });
  } catch (e) {
    console.error('[DOCUMENTS] Update error:', e);
    next(e);
  }
});

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
/* ---------------- IGNORER CECI (ANCIEN*/
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





// ✅ 3. AJOUTER CETTE NOUVELLE ROUTE POUR ANNULER UNE GÉNÉRATION
chatRouter.post('/conversations/:id/cancel-generation', authRequired, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const userId = req.user.uid;

    const activeSession = await getActiveSession(id);

    if (!activeSession) {
      return res.status(404).json({ error: 'Aucune génération en cours' });
    }

    await cancelSession(activeSession.id);

    const assistantMessage = await prisma.message.create({
      data: {
        conversationId: id,
        userId,
        role: 'ASSISTANT',
        content: '❌ Génération de document annulée. Comment puis-je vous aider autrement ?'
      }
    });

    return res.json({ message: toMessageDTO(assistantMessage) });
  } catch (error) {
    console.error('❌ Cancel generation error:', error);
    return res.status(500).json({ error: error.message || 'Erreur serveur' });
  }
});