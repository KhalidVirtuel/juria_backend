// src/services/titleGenerator.js
import Groq from 'groq-sdk';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

/**
 * Génère un titre court et pertinent pour une conversation
 * @param {string} firstMessage - Le premier message de l'utilisateur
 * @returns {Promise<string>} - Un titre court (5-8 mots)
 */
export async function generateConversationTitle(firstMessage) {
  // Fallback si le message est trop court
  if (!firstMessage || firstMessage.length < 10) {
    return 'Nouvelle conversation';
  }

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: `Tu es un assistant qui génère des titres courts et pertinents pour des conversations.
Règles :
- Maximum 8 mots
- Résume l'intention principale
- Sois précis et concis
- Pas de ponctuation finale
- Commence par un verbe d'action si possible

Exemples :
- "Je veux créer un contrat CDD pour un développeur" → "Création d'un contrat CDD"
- "Comment rédiger une lettre de démission conforme ?" → "Rédaction de lettre de démission"
- "Quels sont mes droits en cas de licenciement ?" → "Droits en cas de licenciement"
- "Je dois répondre à une mise en demeure" → "Réponse à mise en demeure"
- "Aide-moi à préparer mon dossier pour le tribunal" → "Préparation dossier tribunal"

Réponds UNIQUEMENT avec le titre, sans guillemets, sans ponctuation finale.`
        },
        {
          role: "user",
          content: `Génère un titre court pour cette question : "${firstMessage}"`
        }
      ],
      temperature: 0.3,
      max_tokens: 50,
    });

    const title = completion.choices[0]?.message?.content?.trim();
    
    if (title && title.length > 0 && title.length <= 100) {
      console.log(`📝 [TITLE] Generated: "${title}" from "${firstMessage.slice(0, 50)}..."`);
      return title;
    }

    // Fallback
    return makeTitleFromContent(firstMessage);
  } catch (error) {
    console.error('❌ [TITLE] Error generating title:', error.message);
    return makeTitleFromContent(firstMessage);
  }
}

/**
 * Fallback : Crée un titre simple depuis le contenu
 * @param {string} text 
 * @returns {string}
 */
function makeTitleFromContent(text) {
  if (!text) return 'Nouvelle conversation';
  const firstLine = String(text).split(/\r?\n/)[0].trim();
  const cleaned = firstLine.replace(/\s+/g, ' ');
  
  // Limiter à 60 caractères pour un titre plus court
  if (cleaned.length > 60) {
    return cleaned.slice(0, 60) + '...';
  }
  
  return cleaned || 'Nouvelle conversation';
}