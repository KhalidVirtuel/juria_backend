// backend/src/services/documentGenerationService.js
import { PrismaClient } from '@prisma/client';
import { DOCUMENT_TEMPLATES } from './documentTemplates.js';

const prisma = new PrismaClient();

/**
 * Créer ou récupérer une session de génération de document
 */
export async function getOrCreateSession(conversationId, userId, folderId, documentType) {
  // Chercher une session existante en cours
  let session = await prisma.documentGenerationSession.findFirst({
    where: {
      conversationId,
      status: 'collecting'
    }
  });

  if (!session) {
    // Créer une nouvelle session
    const template = DOCUMENT_TEMPLATES[documentType];
    
    if (!template) {
      throw new Error(`Type de document inconnu: ${documentType}`);
    }

    session = await prisma.documentGenerationSession.create({
      data: {
        conversationId,
        userId,
        folderId,
        documentType,
        collectedData: {},
        requiredFields: template.fields.map(f => f.key),
        status: 'collecting'
      }
    });
  }

  return session;
}

/**
 * Mettre à jour les données collectées
 */
export async function updateSessionData(sessionId, fieldKey, value) {
  const session = await prisma.documentGenerationSession.findUnique({
    where: { id: sessionId }
  });

  if (!session) {
    throw new Error('Session non trouvée');
  }

  const collectedData = session.collectedData || {};
  collectedData[fieldKey] = value;

  return await prisma.documentGenerationSession.update({
    where: { id: sessionId },
    data: {
      collectedData,
      updatedAt: new Date()
    }
  });
}

/**
 * Obtenir le prochain champ requis à collecter
 */
export function getNextRequiredField(session) {
  const template = DOCUMENT_TEMPLATES[session.documentType];
  
  if (!template) {
    return null;
  }

  const collectedData = session.collectedData || {};
  
  // Trouver le premier champ requis non rempli
  for (const field of template.fields) {
    if (field.required && !collectedData[field.key]) {
      return field;
    }
  }

  // Tous les champs requis sont remplis
  return null;
}

/**
 * Extraire la valeur d'une réponse utilisateur
 */
export function extractValue(userMessage, fieldKey) {
  // Nettoyage basique
  let value = userMessage.trim();
  
  // Enlever les préfixes courants
  value = value.replace(/^(c'est |c est |il s'agit de |c'est le |c'est la )/i, '');
  
  // Pour les dates, valider le format
  if (fieldKey.includes('date')) {
    // Accepter formats: JJ/MM/AAAA, JJ-MM-AAAA, JJ.MM.AAAA
    const dateMatch = value.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
    if (dateMatch) {
      return `${dateMatch[1].padStart(2, '0')}/${dateMatch[2].padStart(2, '0')}/${dateMatch[3]}`;
    }
  }
  
  // Pour les montants, extraire le nombre
  if (fieldKey.includes('salaire') || fieldKey.includes('montant')) {
    const amountMatch = value.match(/(\d+(?:\s?\d{3})*(?:[.,]\d{2})?)/);
    if (amountMatch) {
      return amountMatch[1].replace(/\s/g, '');
    }
  }
  
  return value;
}

/**
 * Générer le document HTML à partir du template
 */
export function generateDocumentHTML(documentType, collectedData) {
  const template = DOCUMENT_TEMPLATES[documentType];
  
  if (!template || !template.template) {
    throw new Error(`Template non trouvé pour: ${documentType}`);
  }

  return template.template(collectedData);
}

/**
 * Sauvegarder le document généré dans la base de données
 */
export async function saveGeneratedDocument(folderId, documentType, content, collectedData) {
  const template = DOCUMENT_TEMPLATES[documentType];
  
  // Créer un titre descriptif
  let title = template.name;
  
  if (collectedData.salarie_nom) {
    title += ` - ${collectedData.salarie_nom}`;
  } else if (collectedData.employeur_nom) {
    title += ` - ${collectedData.employeur_nom}`;
  }

  const document = await prisma.generatedDocument.create({
    data: {
      folderId: parseInt(folderId),
      title,
      type: template.type,
      content,
      createdAt: new Date(),
      lastModified: new Date()
    }
  });

  return document;
}

/**
 * Terminer une session de génération
 */
export async function completeSession(sessionId) {
  return await prisma.documentGenerationSession.update({
    where: { id: sessionId },
    data: {
      status: 'completed',
      updatedAt: new Date()
    }
  });
}

/**
 * Annuler une session de génération
 */
export async function cancelSession(sessionId) {
  return await prisma.documentGenerationSession.update({
    where: { id: sessionId },
    data: {
      status: 'cancelled',
      updatedAt: new Date()
    }
  });
}

/**
 * Récupérer la session active pour une conversation
 */
export async function getActiveSession(conversationId) {
  return await prisma.documentGenerationSession.findFirst({
    where: {
      conversationId,
      status: 'collecting'
    }
  });
}

/**
 * Vérifier si tous les champs requis sont remplis
 */
export function isSessionComplete(session) {
  const nextField = getNextRequiredField(session);
  return nextField === null;
}

/**
 * Résumé des données collectées pour confirmation
 */
export function getSummary(session) {
  const template = DOCUMENT_TEMPLATES[session.documentType];
  const collectedData = session.collectedData || {};
  
  let summary = `📋 **Récapitulatif pour ${template.name}**\n\n`;
  
  for (const field of template.fields) {
    if (collectedData[field.key]) {
      // Enlever les préfixes de clé pour un affichage propre
      const label = field.question.replace(/^(Quel|Quelle|Quels|Quelles) (est|sont|est le|est la) /i, '');
      summary += `✅ ${label.replace('?', '')} : **${collectedData[field.key]}**\n`;
    }
  }
  
  return summary;
}
