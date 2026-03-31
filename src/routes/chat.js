// src/routes/chat.js
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { authRequired } from '../middleware/auth.js';
import { ragAnswer } from '../services/rag.js';
import { generateConversationTitle } from '../services/titleGenerator.js';

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


import multer from 'multer';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Configuration Multer
const audioStorage = multer.memoryStorage();
const audioUpload = multer({ 
  storage: audioStorage,
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB max
});


// ✅ Convertir Markdown → HTML stylé (style Claude.ai)
function markdownToHTML(text) {
  if (!text) return text;
  
  let html = text;
  
  // Titres H1, H2, H3
  html = html.replace(/^### (.+)$/gm, '<h3 style="font-size:1em;font-weight:600;margin:12px 0 4px;">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 style="font-size:1.1em;font-weight:700;margin:14px 0 6px;">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 style="font-size:1.2em;font-weight:700;margin:16px 0 8px;">$1</h1>');
  
  // Gras et italique
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');
  
  // Code inline
  html = html.replace(/`([^`]+)`/g, '<code style="background:#f0f0f0;padding:1px 4px;border-radius:3px;font-family:monospace;font-size:0.9em;">$1</code>');
  
  // Listes numérotées
  html = html.replace(/^(\d+)\. (.+)$/gm, '<li style="margin:4px 0;">$2</li>');
  html = html.replace(/(<li[^>]*>.*<\/li>\n?)+/g, (match) => {
    return '<ol style="margin:8px 0;padding-left:24px;">' + match + '</ol>';
  });
  
  // Listes à puces
  html = html.replace(/^[-*•] (.+)$/gm, '<li style="margin:4px 0;">$1</li>');
  html = html.replace(/(<li[^>]*>.*<\/li>\n?)+/g, (match) => {
    if (match.includes('<ol')) return match;
    return '<ul style="margin:8px 0;padding-left:24px;">' + match + '</ul>';
  });
  
  // Séparateurs horizontaux
  html = html.replace(/^---+$/gm, '<hr style="border:none;border-top:1px solid #e5e7eb;margin:12px 0;">');
  
  // Blocs de code
  html = html.replace(/```([\s\S]*?)```/g, '<pre style="background:#f6f8fa;border:1px solid #e1e4e8;border-radius:6px;padding:12px;overflow-x:auto;font-family:monospace;font-size:0.85em;margin:8px 0;"><code>$1</code></pre>');

  // Sauts de ligne → <br> (seulement les doubles sauts)
  html = html.replace(/\n\n/g, '<br><br>');
  html = html.replace(/\n/g, '<br>');
  
  // Nettoyer les <br> inutiles autour des balises block
  html = html.replace(/(<br>)+(<\/?(h[1-6]|ul|ol|li|pre|hr)[^>]*>)/g, '$2');
  html = html.replace(/(<\/?(h[1-6]|ul|ol|li|pre|hr)[^>]*>)(<br>)+/g, '$1');
  
  return html.trim();
}


export const chatRouter = express.Router();
const prisma = new PrismaClient();

/* ---------------- Helpers (DTO) ---------------- */
async function makeTitleFromContent(text) {
  if (!text) return 'Nouvelle conversation';
  
  try {
    // ✅ Utiliser l'IA pour générer un titre intelligent
    const title = await generateConversationTitle(text);
    return title;
  } catch (error) {
    console.error('❌ Error generating title:', error);
    // Fallback : premiers 60 caractères
    const firstLine = String(text).split(/\r?\n/)[0].trim();
    const cleaned = firstLine.replace(/\s+/g, ' ');
    return cleaned.slice(0, 60) + '...' || 'Nouvelle conversation';
  }
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


// ✅ ROUTE 1 : Transcription audio → texte
/*chatRouter.post('/transcribe', authRequired, audioUpload.single('audio'), async (req, res, next) => {
  try {
    const userId = req.user.uid;
    
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    console.log(`[AUDIO] Transcribing audio for user ${userId}, size: ${req.file.size} bytes`);

    // Créer un File-like object pour Whisper
    const audioFile = new File([req.file.buffer], req.file.originalname, {
      type: req.file.mimetype
    });

    // Transcription avec Whisper
    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language: 'fr',
      response_format: 'json'
    });

    console.log(`[AUDIO] ✅ Transcription: "${transcription.text}"`);

    return res.json({
      text: transcription.text,
      language: 'fr'
    });

  } catch (error) {
    console.error('[AUDIO] Transcription error:', error);
    return res.status(500).json({ 
      error: error.message || 'Transcription failed' 
    });
  }
});*/

chatRouter.post('/transcribe', authRequired, audioUpload.single('audio'), async (req, res) => {
  try {
    console.log('🎤 [TRANSCRIBE] Request received');

    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    const audioSize = req.file.size;
    console.log('📦 [TRANSCRIBE] Audio file size:', audioSize, 'bytes');

    // ✅ NOUVEAU : Rejeter si fichier trop petit (< 5KB = probablement silence)
    if (audioSize < 5000) {
      console.log('⚠️ [TRANSCRIBE] Audio trop court, ignoré');
      return res.json({
        text: '',
        language: 'fr',
        ignored: true,
        reason: 'Audio trop court'
      });
    }

    // Créer un File-like object pour OpenAI
    const audioFile = {
      buffer: req.file.buffer,
      originalname: req.file.originalname || 'recording.webm',
      mimetype: req.file.mimetype || 'audio/webm'
    };

    const file = new File(
      [audioFile.buffer], 
      audioFile.originalname,
      { type: audioFile.mimetype }
    );

    console.log('🔄 [TRANSCRIBE] Calling OpenAI Whisper...');

    // Appel à Whisper
    const transcription = await openai.audio.transcriptions.create({
      file: file,
      model: 'whisper-1',
      language: 'fr',
      response_format: 'json'
    });

    const transcribedText = transcription.text.trim();
    console.log('✅ [TRANSCRIBE] Transcription complete:', transcribedText);

    // ✅ NOUVEAU : Liste de phrases parasites à filtrer
    const parasitePatterns = [
      /sous[\-\s]titres?\s*(réalisés?|crées?|faits?)/i,
      /amara\.org/i,
      /communauté d'amara/i,
      /bonne\s*appétit/i,
      /bon\s*appétit/i,
      /merci\s*de?\s*(votre\s*)?attention/i,
      /^\.+$/,  // Seulement des points
      /^\s*$/,  // Vide ou espaces
      /^[,\.!\?]+$/  // Seulement ponctuation
    ];

    // ✅ Vérifier si c'est un parasite
    const isParasite = parasitePatterns.some(pattern => pattern.test(transcribedText));

    if (isParasite) {
      console.log('🗑️ [TRANSCRIBE] Transcription parasite ignorée:', transcribedText);
      return res.json({
        text: '',
        language: 'fr',
        ignored: true,
        reason: 'Transcription parasite détectée'
      });
    }

    // ✅ Vérifier si trop court (< 3 caractères)
    if (transcribedText.length < 3) {
      console.log('🗑️ [TRANSCRIBE] Transcription trop courte ignorée:', transcribedText);
      return res.json({
        text: '',
        language: 'fr',
        ignored: true,
        reason: 'Transcription trop courte'
      });
    }

    // ✅ Tout est OK, retourner la transcription
    res.json({
      text: transcribedText,
      language: 'fr'
    });

  } catch (error) {
    console.error('❌ [TRANSCRIBE] Error:', error);
    res.status(500).json({ 
      error: 'Transcription failed',
      details: error.message 
    });
  }
});

// ✅ ROUTE 2 : Synthèse vocale texte → audio
chatRouter.post('/synthesize', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const { text, voice = 'nova' } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'No text provided' });
    }

    console.log(`[AUDIO] Synthesizing speech for user ${userId}, length: ${text.length} chars`);

    // Synthèse avec OpenAI TTS
    const mp3 = await openai.audio.speech.create({
      model: 'tts-1',
      voice: voice, // alloy, echo, fable, onyx, nova, shimmer
      input: text,
      speed: 1.0
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());

    console.log(`[AUDIO] ✅ Synthesis complete, size: ${buffer.length} bytes`);

    // Retourner l'audio en base64 pour faciliter le stockage
    return res.json({
      audio: buffer.toString('base64'),
      mimeType: 'audio/mpeg',
      voice: voice
    });

  } catch (error) {
    console.error('[AUDIO] Synthesis error:', error);
    return res.status(500).json({ 
      error: error.message || 'Synthesis failed' 
    });
  }
});

// ✅ STREAMING ENDPOINT - DOIT ÊTRE EN PREMIER

chatRouter.post('/conversations/:id/messages/stream', authRequired, async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const id = Number(req.params.id);
    const { content, folderId, isVoiceInput = false } = req.body || {}; // ✅ NOUVEAU
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
  const newTitle = await makeTitleFromContent(content); // ✅ Ajout de await
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
    let intention = 'general'; // ✅ NOUVEAU : Déclarer intention ici
    try {
      const metaFilter = {};
      
      const result = await ragAnswer({ 
        question: content, 
        metaFilter,
        messageHistory, 
      });
      
      console.log('[RAG] ✅ Answer received');
     // console.log(result);
      if (result.answer && typeof result.answer === 'string') {
        intention = result.intention || 'general'; // ✅ Mise à jour de la variable
        answerText = markdownToHTML(result.answer); // ✅ Markdown → HTML
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
      console.log(`[DOCUMENTS] ✅ Document created: ${created.id} - ${created.title}`);
    } catch (err) {
      console.error(`[Document Error]`, err.message);
    }
  }

  // ✅ NOUVEAU : Ajouter un message avec lien cliquable pour chaque document créé
  if (createdDocuments.length > 0) {
    let documentMessage = '';
    
    if (createdDocuments.length === 1) {
      const doc = createdDocuments[0];
      documentMessage = `📄 Le document **"${doc.title}"** a été ajouté à votre dossier.\n\n` +
                       `[👁️ Cliquez ici pour voir le document](#document-${doc.id})`;
    } else {
      documentMessage = `📄 ${createdDocuments.length} documents ont été ajoutés à votre dossier :\n\n`;
      createdDocuments.forEach(doc => {
        documentMessage += `• [👁️ ${doc.title}](#document-${doc.id})\n`;
      });
    }

    // Créer un message assistant avec les liens
    const linkMessage = await prisma.message.create({
      data: {
        conversationId: id,
        userId,
        role: 'ASSISTANT',
        content: documentMessage
      }
    });
    
    console.log(`[DOCUMENTS] ✅ Link message created: ${linkMessage.id}`);
  }
}

await prisma.conversation.update({
  where: { id },
  data: { updatedAt: new Date() }
});







// ✅ Synthèse vocale UNIQUEMENT si question vocale
let audioData = null;
if (isVoiceInput && answerText) { // ✅ MODIFIÉ : Conditionner sur isVoiceInput
  try {
    console.log('[AUDIO] 🎤 Voice input detected, generating speech response...');
    
    const mp3 = await openai.audio.speech.create({
      model: 'tts-1',
      voice: 'nova',
      input: answerText,
      speed: 1.0
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());
    audioData = {
      audio: buffer.toString('base64'),
      mimeType: 'audio/mpeg',
      voice: 'nova'
    };

    console.log(`[AUDIO] ✅ Speech generated, size: ${buffer.length} bytes`);
  } catch (audioError) {
    console.error('[AUDIO] Synthesis error:', audioError);
  }
}

sendStep('complete', 'Réponse générée avec succès');

res.write(`data: ${JSON.stringify({
  type: 'complete',
  userMessage: toMessageDTO(userMessage),
  aiMessage: toMessageDTO(assistantMessage),
  metadata: {
    documentGenerated: false,
    hasAudio: !!audioData, // ✅ NOUVEAU
    intention: intention      // ✅ NOUVEAU
  },
  audio: audioData, // ✅ NOUVEAU
  timelineEvents: createdTimelineEvents.map(t => ({
    id: String(t.id),
    // ... reste du code
  })),
  documents: createdDocuments.map(d => ({
    id: String(d.id),
    // ... reste du code
  }))
})}\n\n`);


  return res.end(); // ✅ AJOUTER ICI

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
        answerText = markdownToHTML(result.answer); // ✅ Markdown → HTML
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